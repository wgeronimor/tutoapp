import threading

from pydantic import BaseModel
from sqlalchemy import select, update

from .audio import synthesize, transcribe
from .config import config
from .db import Activity, Attempt, Job, Media, Proposal, Session, uid
from .schemas import ProposalInput
from .topics import build_topic
from .transcriptions import append_run


class Advice(BaseModel):
    corrected: str
    feedback: str
    next_action: str
    has_error: bool


stop = threading.Event()


def enqueue(db, kind, payload):
    job = Job(kind=kind, payload=payload, status="queued")
    db.add(job)
    db.flush()
    return job


def run_job(job_id):
    with Session() as db:
        job = db.get(Job, job_id)
        try:
            payload = job.payload
            if job.kind == "audio":
                act = db.get(Activity, payload["activity_id"])
                if not act or not act.data["reference"]:
                    raise ValueError("No hay referencia para esta actividad")
                path = synthesize(act.data["reference"])
                media = db.scalar(
                    select(Media).where(Media.path == path, Media.kind == "reference")
                )
                if not media:
                    media = Media(
                        path=path,
                        kind="reference",
                        info={"voice": "ff_siwis", "origin": "Kokoro local"},
                    )
                    db.add(media)
                    db.flush()
                result = {"media_id": media.id, "url": "/api/media/" + media.id}
            elif job.kind == "proposal":
                request = ProposalInput.model_validate(payload)
                parent = None
                if request.parent_id:
                    parent = db.get(Proposal, request.parent_id)
                    from .db import RemovedProposal

                    if not parent or db.get(RemovedProposal, request.parent_id):
                        raise ValueError("No se encontró la propuesta anterior")
                pid = uid()
                if request.continuous:
                    from .continuous_topics import build

                    data = build(request, parent.data if parent else None)
                else:
                    data = build_topic(db, request, pid)
                proposal = Proposal(
                    id=pid,
                    parent_id=request.parent_id,
                    topic=request.topic,
                    instruction=request.instruction,
                    preferences=data["preferences"],
                    data=data,
                )
                db.add(proposal)
                result = {"proposal_id": pid}
            elif job.kind == "transcribe":
                media = db.get(Media, payload["media_id"])
                if not media or media.info.get("deleted"):
                    raise ValueError("La grabación ya no está disponible")
                if db.scalar(select(Attempt.id).where(Attempt.media_id == media.id).limit(1)):
                    raise ValueError("El audio ya está guardado; solo admite comparación temporal.")
                result = transcribe(config.data_dir / media.path)
                media = db.scalar(
                    select(Media)
                    .where(Media.id == media.id)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
                if media.info.get("deleted"):
                    from .recording_files import remove_files

                    remove_files(media)
                    raise ValueError("Toma descartada; no se conserva un nuevo reconocimiento.")
                if db.scalar(select(Attempt.id).where(Attempt.media_id == media.id).limit(1)):
                    raise ValueError(
                        "El intento se guardó durante el procesamiento; no se añade otra lectura."
                    )
                alternatives = result.pop("alternatives", [])
                run = append_run(media, result)
                alternative_runs = [
                    append_run(
                        media,
                        {
                            **alternative,
                            "original_sha256": result["original_sha256"],
                            "normalized": result["normalized"],
                            "normalized_sha256": result["normalized_sha256"],
                            "is_alternative": True,
                        },
                    )
                    for alternative in alternatives
                ]
                result = {
                    **result,
                    "media_id": media.id,
                    "transcription_run_id": run["id"],
                    "alternatives": alternative_runs,
                }
            elif job.kind == "advice":
                raise ValueError(
                    "No se modifica un intento guardado; utiliza una comparación temporal o un nuevo intento."
                )
            elif job.kind == "class_prepare":
                from .class_preparation import prepare

                result = prepare(db, payload)
            else:
                raise ValueError("Tipo de trabajo desconocido")
            job.result = result
            job.status = "completed"
            job.error = None
            db.commit()
        except Exception as exc:
            db.rollback()
            job = db.get(Job, job_id)
            if job.kind == "transcribe":
                discarded = db.get(Media, job.payload["media_id"])
                if discarded and discarded.info.get("deleted"):
                    from .recording_files import remove_files

                    remove_files(discarded)
            job.status = "failed"
            job.error = str(exc)[:2000]
            db.commit()


def worker():
    while not stop.is_set():
        with Session() as db:
            job = db.scalar(
                select(Job)
                .where(Job.status == "queued")
                .order_by(Job.payload["background"].astext.is_(None).desc(), Job.created)
                .limit(1)
                .with_for_update(skip_locked=True)
            )
            if job:
                job.status = "running"
                job_id = job.id
                db.commit()
            else:
                job_id = None
        if job_id:
            run_job(job_id)
        else:
            stop.wait(0.3)


def start():
    stop.clear()
    with Session() as db:
        # An interrupted job can be safely retried; no learner attempts are created by jobs.
        db.execute(update(Job).where(Job.status == "running").values(status="queued"))
        db.commit()
    thread = threading.Thread(target=worker, daemon=True, name="tuto-jobs")
    thread.start()
    return thread
