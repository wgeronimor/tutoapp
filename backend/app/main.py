import json
import math
import shutil
from contextlib import asynccontextmanager
from datetime import date, timedelta
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .analyses import AnalysisRequest
from .backup import export_archive, export_lock
from .config import ROOT, config
from .continuous_topics import StartCatalog
from .db import (
    Activity,
    Annotation,
    Attempt,
    ClassPlan,
    Job,
    Media,
    Memory,
    Session,
    Settings,
    StudySession,
    now,
    uid,
)
from .jobs import enqueue, start, stop
from .learning import (
    add_activity,
    grade,
    import_course,
    public_activity,
    settings,
    snapshot_session,
    update_memory,
)
from .number_practice import AnswerFormats, Mode, NextNumber, StartNumbers
from .schemas import AttemptInput, Exercise, ProposalInput
from .transcriptions import legacy_advice_unverified, runs, selected_run

COURSE = json.loads((ROOT / "content/course-v1.json").read_text())
VERSION = json.loads((ROOT / "package.json").read_text())["version"]


@asynccontextmanager
async def lifespan(app):
    with Session() as db:
        import_course(db)
    start()
    yield
    stop.set()


app = FastAPI(title="Tuto · Français", version=VERSION, lifespan=lifespan)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "testserver"])


@app.middleware("http")
async def local_access(request: Request, call_next):
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("origin")
        if origin and origin not in (
            str(request.base_url).rstrip("/"),
            "http://127.0.0.1:5173",
            "http://localhost:5173",
        ):
            return JSONResponse(
                {"detail": "Origen no autorizado para modificar datos locales"},
                status_code=403,
            )
    return await call_next(request)


def database():
    with Session() as db:
        yield db


def get_or_404(db, model, id):
    obj = db.get(model, id)
    if obj is None:
        raise HTTPException(404, "No se encontró el registro")
    return obj


def session_data(db, s):
    attempts = list(
        db.scalars(select(Attempt).where(Attempt.session_id == s.id).order_by(Attempt.created))
    )
    from collections import Counter

    counts = Counter(x.activity_id for x in attempts)
    from .number_practice import accuracy

    last = {x.activity_id: x for x in attempts}
    acts = [get_or_404(db, Activity, i) for i in s.activity_ids]
    results = [x.result["score"] for x in last.values() if x.result.get("score") is not None]
    return {
        "id": s.id,
        "title": s.title,
        "source": s.source,
        "state": s.state,
        "activities": [
            {
                **public_activity(a),
                "attempt_count": counts[a.id],
                "accuracy": accuracy([x for x in attempts if x.activity_id == a.id]),
                "attempt": attempt_data(last[a.id], db) if a.id in last else None,
            }
            for a in acts
        ],
        "attempt_count": len(attempts),
        "accuracy": accuracy(attempts),
        "done": sum(a.id in last for a in acts),
        "total": len(acts),
        "percent": round(sum(results) / len(results)) if results else None,
        "seconds": sum(x.evidence.get("seconds", 0) for x in attempts),
        "assessment": s.state.get("summaries", [None])[-1],
    }


def attempt_data(a, db=None):
    result = {
        "id": a.id,
        "session_id": a.session_id,
        "activity_id": a.activity_id,
        "response": a.response,
        "media_id": a.media_id,
        "media_deleted": bool(db and a.media_id and db.get(Media, a.media_id).info.get("deleted")),
        "evidence": a.evidence,
        "result": a.result,
        "created": a.created.isoformat(),
    }

    result["advice_unverified"] = legacy_advice_unverified(a)
    if db:
        session = db.get(StudySession, a.session_id)
        if session and session.source in ("numbers-continuous", "topics-continuous"):
            mode = db.get(Activity, a.activity_id).data["source"]["number_mode"]
            result["practice_url"] = f"/numbers/{session.id}?mode={mode}"
    if db:
        reviews = list(
            db.scalars(
                select(Job)
                .where(Job.kind == "advice", Job.payload["attempt_id"].astext == a.id)
                .order_by(Job.created)
            )
        )
        result["ai_reviews"] = [
            {
                "id": j.id,
                "status": j.status,
                "created": j.created.isoformat(),
                "result": j.result,
                "error": j.error,
                "unverified": bool(
                    a.media_id
                    and j.status == "completed"
                    and j.result.get("input_basis") != "recognizer_transcript_confirmed_by_learner"
                ),
            }
            for j in reviews
        ]
        if reviews:
            latest = result["ai_reviews"][-1]
            result["ai_review_status"] = (
                "unverified"
                if latest["unverified"]
                else {
                    "completed": "reviewed",
                    "failed": "failed",
                    "queued": "pending",
                    "running": "pending",
                }[latest["status"]]
            )
        else:
            result["ai_review_status"] = (
                "unverified"
                if result["advice_unverified"]
                else "reviewed"
                if a.result.get("advice")
                else "not_requested"
            )
        if not any(j.status == "completed" for j in reviews) and a.result.get("advice"):
            result["ai_reviews"] = [
                {
                    "id": "legacy:" + a.id,
                    "status": "completed",
                    "created": a.created.isoformat(),
                    "result": a.result["advice"],
                    "error": None,
                    "unverified": result["advice_unverified"],
                },
                *result["ai_reviews"],
            ]

    if db and a.media_id:
        media = db.get(Media, a.media_id)
        try:
            run = selected_run(media, a.evidence.get("transcription_run_id"))
        except ValueError:
            run = {}
        result["transcription"] = run.get("text", media.info.get("text", ""))
        result["recognizer"] = run.get("model", "")
        result["transcription_runs"] = runs(media)
        result["legacy_response_differs"] = (
            a.evidence.get("transcription_status") != "not_requested"
            and a.response != result["transcription"]
        )
    return result


def current_day(db):
    cfg = settings(db).data
    return max(
        1,
        (
            now().astimezone(ZoneInfo(cfg["timezone"])).date()
            - date.fromisoformat(cfg["start_date"])
        ).days
        + 1,
    )


@app.get("/api/health")
def health(db=Depends(database)):
    db.execute(text("SELECT 1"))
    import httpx

    try:
        response = httpx.get(config.ollama_url + "/api/tags", timeout=2)
        response.raise_for_status()
        ollama = any(m["name"] == config.ollama_model for m in response.json().get("models", []))
    except Exception:
        ollama = False
    models = json.loads((ROOT / "config/audio-models.json").read_text())
    return {
        "version": VERSION,
        "database": db.get_bind().url.database,
        "postgres": db.scalar(text("SHOW server_version")),
        "ollama": ollama,
        "audio": all(Path(x["path"]).exists() for x in models)
        and (ROOT / "local-model-tests/.venv/bin/python").exists(),
        "ffmpeg": bool(shutil.which("ffmpeg")),
    }


@app.get("/api/settings")
def get_settings(db=Depends(database)):
    return {
        "auto_review": True,
        "auto_advance_choices": True,
        "auto_advance_dictation": True,
        "auto_advance_writing": True,
        "auto_validate_number_speech": True,
        **settings(db).data,
    }


class SettingsInput(BaseModel):
    auto_advance_choices: bool = True
    auto_advance_dictation: bool = True
    auto_advance_writing: bool = True
    auto_validate_number_speech: bool = True
    auto_transcribe: bool = True
    auto_review: bool = True
    start_date: date
    timezone: str = "America/Vancouver"
    target: int = Field(default=70, ge=70, le=90)
    academy_unit: int = Field(default=0, ge=0, le=10)
    daily_minutes: int = Field(default=120, ge=15, le=240)


@app.put("/api/settings")
def put_settings(data: SettingsInput, db=Depends(database)):
    try:
        ZoneInfo(data.timezone)
    except Exception:
        raise HTTPException(422, "Zona horaria no válida")
    row = settings(db)
    row.data = data.model_dump(mode="json")
    db.commit()
    return row.data


class AudioSettings(BaseModel):
    auto_transcribe: bool = True


@app.patch("/api/settings/audio")
def audio_settings(value: AudioSettings, db=Depends(database)):
    row = db.scalar(select(Settings).where(Settings.id == 1).with_for_update())
    if row is None:
        row = settings(db)
    row.data = {**row.data, "auto_transcribe": value.auto_transcribe}
    db.commit()
    return get_settings(db)


class ReviewSettings(BaseModel):
    auto_review: bool


@app.patch("/api/settings/review")
def review_settings(value: ReviewSettings, db=Depends(database)):
    row = db.scalar(select(Settings).where(Settings.id == 1).with_for_update())
    if row is None:
        row = settings(db)
    row.data = {**row.data, "auto_review": value.auto_review}
    db.commit()
    return get_settings(db)


class PracticeSettings(BaseModel):
    auto_advance_choices: bool


@app.patch("/api/settings/practice")
def practice_settings(value: PracticeSettings, db=Depends(database)):
    row = db.scalar(select(Settings).where(Settings.id == 1).with_for_update())
    if row is None:
        row = settings(db)
    row.data = {**row.data, "auto_advance_choices": value.auto_advance_choices}
    db.commit()
    return get_settings(db)


class DictationSettings(BaseModel):
    auto_advance_dictation: bool


@app.patch("/api/settings/dictation")
def dictation_settings(value: DictationSettings, db=Depends(database)):
    row = db.scalar(select(Settings).where(Settings.id == 1).with_for_update())
    if row is None:
        row = settings(db)
    row.data = {**row.data, "auto_advance_dictation": value.auto_advance_dictation}
    db.commit()
    return get_settings(db)


class WritingSettings(BaseModel):
    auto_advance_writing: bool


@app.patch("/api/settings/writing")
def writing_settings(value: WritingSettings, db=Depends(database)):
    row = db.scalar(select(Settings).where(Settings.id == 1).with_for_update())
    if row is None:
        row = settings(db)
    row.data = {**row.data, "auto_advance_writing": value.auto_advance_writing}
    db.commit()
    return get_settings(db)


class NumberSpeechSettings(BaseModel):
    auto_validate_number_speech: bool


@app.patch("/api/settings/number-speech")
def number_speech_settings(value: NumberSpeechSettings, db=Depends(database)):
    row = db.scalar(select(Settings).where(Settings.id == 1).with_for_update())
    if row is None:
        row = settings(db)
    row.data = {**row.data, "auto_validate_number_speech": value.auto_validate_number_speech}
    db.commit()
    return get_settings(db)


class NumberSpeechPreview(BaseModel):
    activity_id: str
    media_id: str


@app.post("/api/number-practice/{id}/speech-preview")
def number_speech_preview(id: str, value: NumberSpeechPreview, db=Depends(database)):
    from .number_speech import preview

    try:
        return preview(db, id, value.activity_id, value.media_id)
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@app.get("/api/course")
def course(db=Depends(database)):
    sessions = {
        s.key: s for s in db.scalars(select(StudySession).where(StudySession.source == "course"))
    }
    days = []
    for d in COURSE["days"]:
        entry = {k: v for k, v in d.items() if k != "activities"}
        s = sessions.get("day:" + str(d["day"]))
        entry["session_id"] = s.id if s else None
        entry["done"] = (
            len(
                {
                    a.activity_id
                    for a in db.scalars(select(Attempt).where(Attempt.session_id == s.id))
                }
                & set(s.activity_ids)
            )
            if s
            else 0
        )
        scheduled = date.fromisoformat(settings(db).data["start_date"]) + timedelta(
            days=d["day"] - 1
        )
        entry["total"] = len(s.activity_ids) if s else (12 if scheduled.weekday() < 4 else 10)
        days.append(entry)
    return {
        "days": days,
        "current_day": current_day(db),
        "total_weeks": 39,
        "available_weeks": 4,
    }


@app.get("/api/today")
def today(db=Depends(database)):
    n = current_day(db)
    cfg = settings(db).data
    due = db.scalar(select(func.count()).select_from(Memory).where(Memory.due <= now()))
    completed = {
        s.key
        for s in db.scalars(select(StudySession).where(StudySession.source == "course"))
        if db.scalar(
            select(func.count(func.distinct(Attempt.activity_id))).where(Attempt.session_id == s.id)
        )
        >= len(s.activity_ids)
    }
    missed = [
        d["day"] for d in COURSE["days"] if d["day"] < n and "day:" + str(d["day"]) not in completed
    ]
    local_today = now().astimezone(ZoneInfo(cfg["timezone"])).date()
    studied = 0
    extra = 0
    for attempt in db.scalars(select(Attempt).where(Attempt.created >= now() - timedelta(days=2))):
        if attempt.created.astimezone(ZoneInfo(cfg["timezone"])).date() != local_today:
            continue
        session = db.get(StudySession, attempt.session_id)
        if session.state.get("time_mode") == "extra":
            extra += attempt.evidence.get("seconds", 0)
        else:
            studied += attempt.evidence.get("seconds", 0)
    nextday = min(missed) if missed else min(n, 28)
    # Due reviews and missed work replace new work rather than accumulating daily hours.
    return {
        "day": n,
        "suggested_day": nextday,
        "due": due,
        "missed": missed,
        "budget": cfg["daily_minutes"],
        "review_minutes": min(30, due * 3, cfg["daily_minutes"]),
        "new_minutes": max(0, cfg["daily_minutes"] - min(30, due * 3, cfg["daily_minutes"])),
        "week": math.ceil(n / 7),
        "studied_minutes": round(studied / 60),
        "extra_minutes": round(extra / 60),
        "remaining_minutes": max(0, cfg["daily_minutes"] - round(studied / 60)),
        "message": "Hay trabajo pendiente. Retoma la primera sesión incompleta; los repasos sustituyen parte del contenido nuevo."
        if missed
        else "Tu sesión está preparada. Avanza a tu ritmo y conserva cada intento.",
    }


def day_session(db, n):
    if not 1 <= n <= 28:
        raise HTTPException(
            422, "Las semanas 5–39 se ampliarán después de verificar la primera versión"
        )
    existing = db.scalar(select(StudySession).where(StudySession.key == "day:" + str(n)))
    if existing:
        return existing
    d = COURSE["days"][n - 1]
    cfg = settings(db).data
    scheduled = date.fromisoformat(cfg["start_date"]) + timedelta(days=n - 1)
    has_class = scheduled.weekday() < 4
    raw = [dict(a) for a in d["activities"]]
    core = [a for a in raw if a["block"] == "Programa propio"]
    core_minutes = [6, 6, 6, 6, 6, 10, 10, 15, 7, 8]
    for a, minutes in zip(core, core_minutes):
        a["minutes"] = minutes if has_class else minutes + 4
    if has_class:
        templates = [dict(a) for a in raw if a["block"] != "Programa propio"]
        if not templates:
            templates = [
                dict(a) for a in COURSE["days"][0]["activities"] if a["block"] != "Programa propio"
            ]
            for i, a in enumerate(templates):
                a["key"] = f"day-{n}:calendar-{i}"
                a["source"] = {
                    "unit": d["unit"],
                    "printed_page": UNIT_PAGES[d["unit"]],
                    "pdf_page": 1,
                    "relationship": "Alineación temática; calendario adaptado",
                }
                a["material"] = d["tip"]
                a["item"] = f"fr:objective:u{d['unit']}:class-{i}"
                a["reference"] = core[i]["reference"]
        raw = templates + core
    else:
        raw = core
    # Rescale the suggested load to the student's current daily availability.
    due = db.scalar(select(func.count()).select_from(Memory).where(Memory.due <= now()))
    budget = cfg["daily_minutes"] - min(30, due * 3, max(0, cfg["daily_minutes"] - len(raw)))
    remaining = budget
    for i, a in enumerate(raw):
        a["minutes"] = (
            remaining
            if i == len(raw) - 1
            else max(
                1,
                min(remaining - (len(raw) - i - 1), round(a["minutes"] * budget / 120)),
            )
        )
        remaining -= a["minutes"]
    acts = []
    import hashlib

    for data in raw:
        canonical = Exercise.model_validate(data).model_dump()
        from .learning import item_id

        if canonical["item"].startswith("fr:expression:"):
            canonical["item"] = item_id(canonical["reference"])
        version = (
            "calendar:"
            + hashlib.sha256(
                json.dumps(canonical, sort_keys=True, ensure_ascii=False).encode()
            ).hexdigest()[:16]
        )
        acts.append(add_activity(db, canonical, version))
    return snapshot_session(
        db,
        "day:" + str(n),
        d["title"],
        "course",
        acts,
        {
            "day": n,
            "week": d["week"],
            "date": scheduled.isoformat(),
            "class_day": has_class,
            "goal": d["goal"],
            "unit": d["unit"],
            "tip": d["tip"],
            "evaluation": d["evaluation"],
        },
    )


@app.post("/api/evaluations/{week}/start")
def start_evaluation(week: int, db=Depends(database)):
    if week not in (1, 2, 3, 4):
        raise HTTPException(422, "Evaluación disponible para semanas 1–4")
    course = json.loads((ROOT / "content/assessments-v1.json").read_text())
    row = course["weeks"][week - 1]
    acts = [add_activity(db, a, course["version"]) for a in row["activities"]]
    s = snapshot_session(
        db,
        "evaluation:" + str(week),
        row["title"],
        "evaluation",
        acts,
        {
            "week": week,
            "goal": "Control con material nuevo: sustituye la sesión de evaluación de esta semana. Dedica 80 minutos a las tareas y hasta 40 a corregir y transferir; conserva las cuatro destrezas.",
        },
    )
    db.commit()
    return session_data(db, s)


@app.post("/api/days/{n}/start")
def start_day(n: int, db=Depends(database)):
    s = day_session(db, n)
    db.commit()
    return session_data(db, s)


@app.get("/api/sessions/{id}")
def get_session(id: str, db=Depends(database)):
    return session_data(db, get_or_404(db, StudySession, id))


class SessionState(BaseModel):
    cursor: int = Field(ge=0)


@app.patch("/api/sessions/{id}")
def update_session(id: str, state: SessionState, db=Depends(database)):
    s = get_or_404(db, StudySession, id)
    if state.cursor >= len(s.activity_ids):
        raise HTTPException(422, "Actividad no válida")
    s.state = {**s.state, "cursor": state.cursor}
    db.commit()
    return {"saved": True}


@app.post("/api/analyses")
def create_analysis(data: AnalysisRequest):
    from .analyses import create

    try:
        return {"analysis_id": create(data)}
    except ValueError as exc:
        raise HTTPException(409, str(exc))


@app.get("/api/analyses/{id}")
def get_analysis(id: str):
    from .analyses import get

    try:
        return get(id)
    except ValueError as exc:
        raise HTTPException(404, str(exc))


@app.post("/api/attempts")
def submit_attempt(data: AttemptInput, db=Depends(database)):
    existing = db.get(Attempt, data.id)
    if existing:
        if (
            existing.session_id != data.session_id
            or existing.activity_id != data.activity_id
            or existing.response != data.response
            or existing.media_id != data.media_id
            or existing.evidence.get("number_recognition_check", False)
            != data.number_recognition_check
        ):
            raise HTTPException(409, "Este identificador ya corresponde a otro intento")
        return attempt_data(existing, db)
    s = get_or_404(db, StudySession, data.session_id)
    if s.source in ("numbers-continuous", "topics-continuous"):
        s = db.scalar(
            select(StudySession)
            .where(StudySession.id == s.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        previous = db.scalar(
            select(Attempt)
            .where(Attempt.session_id == s.id, Attempt.activity_id == data.activity_id)
            .limit(1)
        )
        if previous:
            if (
                previous.id == data.id
                and previous.response == data.response
                and previous.media_id == data.media_id
            ):
                return attempt_data(previous, db)
            raise HTTPException(
                409, "Esta ronda ya está guardada. Continúa con el siguiente número."
            )
    if data.activity_id not in s.activity_ids:
        raise HTTPException(422, "La actividad no pertenece a esta sesión")
    a = get_or_404(db, Activity, data.activity_id)
    if a.data["mode"] == "speak" and not data.media_id:
        raise HTTPException(422, "Graba una respuesta antes de guardar")
    if not data.response.strip() and not data.media_id:
        raise HTTPException(422, "Introduce tu respuesta")
    if data.media_id:
        media = db.scalar(select(Media).where(Media.id == data.media_id).with_for_update())
        if media is None:
            raise HTTPException(404, "Grabación no disponible")
        if media.kind != "recording" or media.info.get("deleted"):
            raise HTTPException(422, "Grabación no disponible")
        if db.scalar(select(Attempt.id).where(Attempt.media_id == media.id).limit(1)):
            raise HTTPException(
                409, "Esta grabación ya forma parte de un intento guardado; graba una toma nueva."
            )
        if media.info.get("no_speech"):
            raise HTTPException(422, "No se detectó voz. Vuelve a grabar.")
        if "text" not in media.info and media.info.get("transcription_requested") is False:
            if data.response or data.transcription_run_id:
                raise HTTPException(
                    422,
                    "No hay transcripción generada; no se admite texto manual en un intento oral.",
                )
            recognized = None
        else:
            try:
                recognized = selected_run(media, data.transcription_run_id)
            except ValueError as exc:
                raise HTTPException(422, str(exc))
            if recognized.get("needs_retry") or recognized.get("no_speech"):
                raise HTTPException(
                    422, "Esta toma necesita repetirse antes de usar su transcripción"
                )
            if data.response != recognized["text"]:
                raise HTTPException(
                    422,
                    "La transcripción del audio es de solo lectura. No se puede sustituir por texto manual.",
                )
    if data.number_recognition_check:
        if (
            s.source not in ("numbers-continuous", "topics-continuous")
            or a.data.get("source", {}).get("number_mode") != "speak"
            or not data.media_id
            or not recognized
        ):
            raise HTTPException(
                422, "La validación automática requiere una transcripción de esta ronda oral"
            )
    evidence = data.model_dump(exclude={"id", "session_id", "activity_id", "response", "media_id"})
    if data.media_id:
        evidence = {
            **evidence,
            "transcription_status": "available" if recognized else "not_requested",
            "transcription_run_id": recognized["id"] if recognized else None,
            "recognizer": recognized.get("model") if recognized else None,
            "recognizer_revision": recognized.get("revision") if recognized else None,
            "raw_transcription": recognized["text"] if recognized else None,
        }
    if data.media_id and data.transcript_matches:
        if not recognized:
            raise HTTPException(422, "No hay transcripción para confirmar")
        evidence = {
            **evidence,
            "transcript_review": {
                "status": "matches",
                "created": now().isoformat(),
                "transcription_run_id": recognized["id"],
            },
        }
    evaluation = None
    if data.evaluation_id:
        from .analyses import snapshot

        try:
            evaluation = snapshot(
                data.evaluation_id, data, recognized["id"] if data.media_id and recognized else None
            )
        except ValueError as exc:
            raise HTTPException(409, str(exc))
    cfg = settings(db).data
    result = grade(a, data.response, cfg["target"], evidence)
    if evaluation and evaluation.get("advice"):
        result = {**result, "advice": evaluation["advice"]}
    attempt = Attempt(
        id=data.id,
        session_id=s.id,
        activity_id=a.id,
        media_id=data.media_id,
        response=data.response,
        evidence=evidence,
        result=result,
        created=now(),
    )
    db.add(attempt)
    db.flush()
    if evaluation:
        db.add(
            Job(
                kind="advice",
                status="completed" if evaluation.get("advice") else "failed",
                payload={"attempt_id": attempt.id, "prepared_before_save": True},
                result=evaluation.get("advice", {}),
                error=evaluation.get("advice_error"),
            )
        )
    update_memory(db, attempt, a)
    if s.source in ("numbers-continuous", "topics-continuous"):
        db.commit()
        return attempt_data(attempt, db)
    all_attempts = list(
        db.scalars(select(Attempt).where(Attempt.session_id == s.id).order_by(Attempt.created))
    )
    latest = {x.activity_id: x for x in all_attempts}
    objective = [
        db.get(Activity, i)
        for i in s.activity_ids
        if db.get(Activity, i).data["mode"] in ("choice", "exact")
    ]
    if objective and all(x.id in latest for x in objective):
        correct = sum(latest[x.id].result.get("score") == 100 for x in objective)
        summary = {
            "correct": correct,
            "total": len(objective),
            "percent": round(100 * correct / len(objective)),
            "target": cfg["target"],
            "passed": 100 * correct / len(objective) >= cfg["target"],
            "method": "Aciertos / preguntas cerradas · v1",
            "attempt_ids": [latest[x.id].id for x in objective],
            "created": now().isoformat(),
        }
        s.state = {**s.state, "summaries": [*s.state.get("summaries", []), summary]}
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        other = db.get(Attempt, data.id)
        if (
            other
            and other.session_id == data.session_id
            and other.activity_id == data.activity_id
            and other.response == data.response
        ):
            return attempt_data(other, db)
        raise HTTPException(
            409,
            "El intento entró en conflicto; conserva tu respuesta y vuelve a guardar",
        )
    return attempt_data(attempt, db)


@app.post("/api/activities/{id}/audio")
def request_audio(id: str, db=Depends(database)):
    a = get_or_404(db, Activity, id)
    if not a.data["reference"]:
        raise HTTPException(422, "Esta actividad es espontánea; usa tu propia respuesta")
    old = db.scalar(
        select(Job)
        .where(
            Job.kind == "audio",
            Job.payload["activity_id"].astext == id,
            Job.status.in_(["queued", "running", "completed"]),
        )
        .order_by(Job.created.desc())
    )
    job = old or enqueue(db, "audio", {"activity_id": id})
    if old and old.status == "queued":
        old.payload = {"activity_id": id}
    db.commit()
    return {"job_id": job.id}


@app.post("/api/recordings")
async def upload_recording(
    file: UploadFile = File(...),
    transcribe_audio: bool = Form(default=True, alias="transcribe"),
    db=Depends(database),
):
    content = await file.read(30 * 1024 * 1024 + 1)
    if not content or len(content) > 30 * 1024 * 1024:
        raise HTTPException(413, "La grabación debe tener menos de 30 MB")
    suffix = {
        "audio/webm": ".webm",
        "audio/mp4": ".mp4",
        "audio/wav": ".wav",
        "audio/ogg": ".ogg",
        "audio/x-wav": ".wav",
    }.get((file.content_type or "").split(";")[0])
    if not suffix:
        raise HTTPException(422, "Formato de grabación no admitido")
    mid = uid()
    folder = config.data_dir / "recordings"
    folder.mkdir(exist_ok=True)
    path = folder / (mid + suffix)
    path.write_bytes(content)
    media = Media(
        id=mid,
        path=str(path.relative_to(config.data_dir)),
        kind="recording",
        info={
            "mime": file.content_type,
            "bytes": len(content),
            "transcription_requested": transcribe_audio,
        },
    )
    db.add(media)
    job = enqueue(db, "transcribe", {"media_id": mid}) if transcribe_audio else None
    db.commit()
    return {"media_id": mid, "job_id": job.id if job else None}


@app.get("/api/recordings")
def recordings(db=Depends(database)):
    return [
        {
            "id": m.id,
            "created": m.created.isoformat(),
            "info": m.info,
            "linked": bool(db.scalar(select(Attempt.id).where(Attempt.media_id == m.id).limit(1))),
        }
        for m in db.scalars(
            select(Media).where(Media.kind == "recording").order_by(Media.created.desc()).limit(200)
        )
    ]


@app.get("/api/media/{id}")
def get_media(id: str, db=Depends(database)):
    media = get_or_404(db, Media, id)
    if media.info.get("deleted"):
        raise HTTPException(410, "Grabación eliminada")
    path = (config.data_dir / media.path).resolve()
    if config.data_dir.resolve() not in path.parents or not path.exists():
        raise HTTPException(404, "Archivo no disponible")
    return FileResponse(path)


@app.post("/api/recordings/{id}/discard")
def discard_pending_recording(id: str, db=Depends(database)):
    from .recording_files import remove_files

    with export_lock:
        media = db.scalar(select(Media).where(Media.id == id).with_for_update())
        if not media or media.kind != "recording":
            raise HTTPException(404, "Toma no disponible")
        if db.scalar(select(Attempt.id).where(Attempt.media_id == id).limit(1)):
            raise HTTPException(
                409, "La grabación ya está guardada con un intento; se conserva en el historial."
            )
        media.info = {
            **media.info,
            "deleted": True,
            "discarded": True,
            "deleted_at": now().isoformat(),
        }
        db.commit()
        remove_files(media)
    return {"discarded": True}


@app.delete("/api/media/{id}")
def delete_media(id: str, db=Depends(database)):
    from .recording_files import remove_files

    with export_lock:
        media = db.scalar(select(Media).where(Media.id == id).with_for_update())
        if not media:
            raise HTTPException(404, "Grabación no disponible")
        if media.kind != "recording":
            raise HTTPException(422, "Solo se pueden eliminar las grabaciones personales")
        if db.scalar(select(Attempt.id).where(Attempt.media_id == id).limit(1)):
            raise HTTPException(409, "La grabación está guardada y no puede eliminarse.")
        media.info = {**media.info, "deleted": True, "deleted_at": now().isoformat()}
        db.commit()
        remove_files(media)
    return {"deleted": True}


@app.get("/api/activities/{id}/transcript")
def transcript(id: str, db=Depends(database)):
    a = get_or_404(db, Activity, id)
    return {"text": a.data["reference"]}


@app.get("/api/activities/{id}/pronunciation")
def pronunciation(id: str, db=Depends(database)):
    from .pronunciation import reference_guide

    a = get_or_404(db, Activity, id)
    if not a.data.get("reference", "").strip():
        raise HTTPException(422, "Esta actividad no tiene una referencia de audio")
    try:
        return reference_guide(a.data["reference"])
    except Exception:
        raise HTTPException(
            503,
            "No se pudo preparar la guía de pronunciación. Puedes escuchar el audio y reintentar.",
        ) from None


@app.get("/api/jobs/{id}")
def job_status(id: str, db=Depends(database)):
    job = get_or_404(db, Job, id)
    return {
        "id": job.id,
        "kind": job.kind,
        "status": job.status,
        "result": job.result,
        "error": job.error,
    }


@app.get("/api/practice-history")
def practice_history(
    kind: Literal["fixed", "continuous"] = "fixed",
    offset: int = 0,
    limit: int = 20,
    show_inactive: bool = False,
    db=Depends(database),
):
    from .practice_history import listing

    if offset < 0 or not 1 <= limit <= 50:
        raise HTTPException(422, "Página no válida")
    return listing(db, kind, offset, limit, show_inactive)


class PracticeOrganizationInput(BaseModel):
    action: Literal["pin", "unpin", "up", "down", "hide", "show"]


@app.patch("/api/practice-history/{id}")
def organize_practice(id: str, data: PracticeOrganizationInput, db=Depends(database)):
    from .practice_organization import organize

    return organize(db, id, data.action)


@app.delete("/api/proposals/{id}")
def remove_practice_proposal(id: str, db=Depends(database)):
    from .practice_organization import remove_proposal

    return remove_proposal(db, id)


@app.post("/api/number-practice")
def start_number_practice(data: StartNumbers, db=Depends(database)):
    from .number_practice import next_draw, snapshot, start

    try:
        session = start(db, data)
        if not session.state["active"]:
            next_draw(db, session, "write")
        db.commit()
        return snapshot(db, session, serialize_attempt=attempt_data)
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@app.get("/api/number-practice")
def list_number_practice(db=Depends(database)):
    return [
        {"id": s.id, "title": s.title, "created": s.created.isoformat()}
        for s in db.scalars(
            select(StudySession)
            .where(StudySession.source == "numbers-continuous")
            .order_by(StudySession.created.desc())
            .limit(12)
        )
    ]


@app.get("/api/number-practice/{id}")
def get_number_practice(id: str, mode: Mode | None = None, db=Depends(database)):
    from .number_practice import snapshot

    session = get_or_404(db, StudySession, id)
    if session.source not in ("numbers-continuous", "topics-continuous"):
        raise HTTPException(404, "No se encontró esta práctica continua")
    return snapshot(db, session, mode, attempt_data)


@app.post("/api/number-practice/{id}/next")
def next_number_practice(id: str, data: NextNumber, db=Depends(database)):
    from .number_practice import get_session, next_draw, snapshot

    try:
        session = get_session(db, id)
        next_draw(db, session, data.mode)
        db.commit()
        return snapshot(db, session, data.mode, attempt_data)
    except ValueError as exc:
        raise HTTPException(404, str(exc))


@app.patch("/api/number-practice/{id}/formats")
def update_number_formats(id: str, data: AnswerFormats, db=Depends(database)):
    from .number_practice import get_session, set_formats, snapshot

    try:
        session = get_session(db, id)
        set_formats(session, data)
        db.commit()
        return snapshot(db, session, data.mode, attempt_data)
    except ValueError as exc:
        raise HTTPException(404, str(exc))


@app.post("/api/proposals")
def request_proposal(data: ProposalInput, db=Depends(database)):
    if data.parent_id:
        from .practice_organization import active_proposal

        active_proposal(db, data.parent_id)
    job = enqueue(db, "proposal", data.model_dump())
    db.commit()
    return {"job_id": job.id}


@app.get("/api/proposals/{id}")
def get_proposal(id: str, db=Depends(database)):
    from .practice_organization import active_proposal

    p = active_proposal(db, id)
    session = db.get(StudySession, p.session_id) if p.session_id else None
    return {
        "session_entries": session.state.get("entries") if session else None,
        "session_modalities": session.state.get("modalities") if session else None,
        "id": p.id,
        "parent_id": p.parent_id,
        "topic": p.topic,
        "instruction": p.instruction,
        "session_id": p.session_id,
        **{k: v for k, v in p.data.items() if k != "activities"},
        "activities": [
            {"title": a["title"], "skill": a["skill"], "prompt": a["prompt"]}
            for a in p.data["activities"]
        ],
    }


@app.post("/api/proposals/{id}/start-continuous")
def start_continuous_proposal(id: str, value: StartCatalog, db=Depends(database)):
    from .continuous_topics import start
    from .number_practice import snapshot
    from .practice_organization import active_proposal

    proposal = active_proposal(db, id, lock=True)
    try:
        session = start(db, proposal, value)
        db.commit()
        return snapshot(db, session, serialize_attempt=attempt_data)
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@app.post("/api/proposals/{id}/start")
def start_proposal(id: str, db=Depends(database)):
    from .practice_organization import active_proposal

    p = active_proposal(db, id, lock=True)
    if p.data.get("kind") == "continuous":
        raise HTTPException(422, "Esta propuesta se inicia como práctica continua")
    if p.session_id:
        return session_data(db, db.get(StudySession, p.session_id))
    acts = [add_activity(db, x, "proposal:" + id) for x in p.data["activities"]]
    s = snapshot_session(
        db,
        "proposal:" + id,
        p.data["title"],
        "topic",
        acts,
        {
            "proposal_id": id,
            "goal": p.data["objective"],
            "minutes": p.data["minutes"],
            "time_mode": p.preferences.get("time_mode", "daily"),
        },
    )
    p.session_id = s.id
    db.commit()
    return session_data(db, s)


@app.get("/api/memory")
def memory(db=Depends(database)):
    return [
        {
            "id": m.id,
            "item": m.item,
            "skill": m.skill,
            "label": m.label,
            "due": m.due.isoformat(),
            "evidence": m.evidence,
        }
        for m in db.scalars(select(Memory).order_by(Memory.due))
    ]


@app.post("/api/reviews/start")
def start_review(db=Depends(database)):
    limit = max(1, min(10, settings(db).data["daily_minutes"] // 3))
    rows = list(
        db.scalars(select(Memory).where(Memory.due <= now()).order_by(Memory.due).limit(limit))
    )
    if not rows:
        raise HTTPException(409, "No hay repasos vencidos. Puedes practicar un tema.")
    acts = []
    for m in rows:
        original = get_or_404(db, Activity, m.evidence["activity_id"])
        data = {
            **original.data,
            "key": "review:" + m.id,
            "minutes": 3,
            "block": "Repaso de memoria",
        }
        import hashlib

        version = (
            "review:"
            + hashlib.sha256(
                json.dumps(data, sort_keys=True, ensure_ascii=False).encode()
            ).hexdigest()[:16]
        )
        acts.append(add_activity(db, data, version))
    s = snapshot_session(
        db,
        "review:" + uid(),
        "Repasos de hoy",
        "review",
        acts,
        {
            "goal": "Recuperar sin ayudas los elementos que necesitan refuerzo",
            "budget_minutes": len(acts) * 3,
        },
    )
    db.commit()
    return session_data(db, s)


@app.get("/api/history")
def history(db=Depends(database)):
    attempts = list(db.scalars(select(Attempt).order_by(Attempt.created.desc()).limit(300)))
    return [
        {
            "session_id": s.id,
            "title": s.title,
            "source": s.source,
            "practice_url": f"/numbers/{s.id}"
            if s.source in ("numbers-continuous", "topics-continuous")
            else f"/session/{s.id}",
            "created": s.created.isoformat(),
            "state": s.state,
        }
        for s in db.scalars(select(StudySession).order_by(StudySession.created.desc()))
    ], [
        dict(
            attempt_data(a, db),
            title=db.get(Activity, a.activity_id).data["title"],
            skill=db.get(Activity, a.activity_id).data["skill"],
            annotations=[
                {"text": x.text, "origin": x.origin}
                for x in db.scalars(select(Annotation).where(Annotation.attempt_id == a.id))
            ],
        )
        for a in attempts
    ]


@app.get("/api/attempt-history")
def attempt_history(
    session_id: str | None = None,
    activity_id: str | None = None,
    skill: str | None = None,
    offset: int = 0,
    limit: int = 50,
    db=Depends(database),
):
    if offset < 0 or limit < 1 or limit > 200:
        raise HTTPException(422, "Página no válida")
    query = select(Attempt).join(Activity, Attempt.activity_id == Activity.id)
    if session_id:
        query = query.where(Attempt.session_id == session_id)
    if activity_id:
        query = query.where(Attempt.activity_id == activity_id)
    if skill and skill != "all":
        if skill not in ("reading", "listening", "writing", "speaking"):
            raise HTTPException(422, "Destreza no válida")
        query = query.where(Activity.data["skill"].astext == skill)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = list(db.scalars(query.order_by(Attempt.created.desc()).offset(offset).limit(limit)))
    items = []
    for a in rows:
        activity = db.get(Activity, a.activity_id)
        items.append(
            {
                **attempt_data(a, db),
                "title": activity.data["title"],
                "skill": activity.data["skill"],
                "session_title": db.get(StudySession, a.session_id).title,
                "annotations": [
                    {"text": n.text, "origin": n.origin}
                    for n in db.scalars(select(Annotation).where(Annotation.attempt_id == a.id))
                ],
            }
        )
    return {"total": total, "items": items, "offset": offset, "limit": limit}


class TranscriptReview(BaseModel):
    model_config = {"extra": "forbid"}
    transcription_run_id: str | None = None
    status: Literal["matches", "mismatch", "unsure"]


@app.post("/api/attempts/{id}/transcript-review")
def transcript_review(id: str, review: TranscriptReview, db=Depends(database)):
    get_or_404(db, Attempt, id)
    raise HTTPException(
        409,
        "El intento guardado es definitivo. Revisa la transcripción antes de guardar un nuevo intento.",
    )


@app.post("/api/media/{id}/retranscribe")
def retranscribe(id: str, db=Depends(database)):
    m = get_or_404(db, Media, id)
    if m.kind != "recording" or m.info.get("deleted"):
        raise HTTPException(422, "Grabación no disponible")
    if db.scalar(select(Attempt.id).where(Attempt.media_id == id).limit(1)):
        raise HTTPException(
            409, "El audio guardado no se modifica. Usa comparación temporal desde el historial."
        )
    job = enqueue(db, "transcribe", {"media_id": id})
    db.commit()
    return {"job_id": job.id}


@app.get("/api/media/{id}/transcriptions")
def transcription_history(id: str, db=Depends(database)):
    m = get_or_404(db, Media, id)
    if m.kind != "recording":
        raise HTTPException(422, "Este archivo es una referencia")
    return runs(m)


@app.post("/api/attempts/{id}/advice")
def advice(id: str, db=Depends(database)):
    get_or_404(db, Attempt, id)
    raise HTTPException(
        409,
        "No se añaden ni reemplazan comentarios en un intento guardado. Usa comparación temporal o haz un nuevo intento.",
    )


class NoteInput(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    origin: Literal["Estudiante", "Tutor"] = "Estudiante"


@app.post("/api/attempts/{id}/notes")
def annotate(id: str, note: NoteInput, db=Depends(database)):
    get_or_404(db, Attempt, id)
    raise HTTPException(
        409, "El historial guardado es de solo lectura; una nueva revisión requiere otro intento."
    )


@app.get("/api/progress")
def progress(db=Depends(database)):
    attempts = list(db.scalars(select(Attempt).order_by(Attempt.created)))
    mem = list(db.scalars(select(Memory)))
    skills = {
        s: {"attempts": 0, "correct": 0, "evaluable": 0, "seconds": 0}
        for s in ["reading", "listening", "writing", "speaking"]
    }
    for a in attempts:
        sk = db.get(Activity, a.activity_id).data["skill"]
        b = skills[sk]
        b["attempts"] += 1
        b["seconds"] += a.evidence["seconds"]
        if a.result.get("score") is not None:
            b["evaluable"] += 1
            b["correct"] += a.result["score"] == 100
    learned = {m.item for m in mem if m.evidence.get("learned")}
    difficulties = sorted(
        (m for m in mem if m.evidence["errors"]),
        key=lambda m: m.evidence["errors"],
        reverse=True,
    )[:2]
    samples = {}
    for key, day in [("initial", 1), ("week4", 27)]:
        s = db.scalar(select(StudySession).where(StudySession.key == "day:" + str(day)))
        samples[key] = [attempt_data(a) for a in attempts if s and a.session_id == s.id]
    return {
        "skills": skills,
        "practiced": len({m.item for m in mem}),
        "learned": len(learned),
        "numbers": len({x for x in learned if x.startswith("fr:cardinal:")}),
        "expressions": len({x for x in learned if x.startswith("fr:expression:")}),
        "priorities": [
            {
                "label": m.label,
                "skill": m.skill,
                "errors": m.evidence["errors"],
                "attempt_id": m.evidence["last_attempt"],
            }
            for m in difficulties
        ],
        "samples": samples,
        "total_seconds": sum(a.evidence["seconds"] for a in attempts),
        "retention_note": "Aprendido: recuperaciones autónomas correctas en al menos dos fechas separadas por 24 horas; evidencia por destreza.",
    }


UNIT_PAGES = [11, 17, 31, 45, 59, 73, 87, 101, 115, 129, 143]
UNIT_PHRASES = {
    0: ("Bonjour !", "Comment ça s’écrit ?", "Vous pouvez répéter ?"),
    1: ("Je m’appelle Wilson.", "J’habite au Canada.", "Je parle espagnol."),
    2: ("Voici ma famille.", "J’habite dans un appartement.", "J’aime la musique."),
    3: ("Je voudrais du pain.", "Combien ça coûte ?", "L’addition, s’il vous plaît."),
    4: ("Où est la gare ?", "Tournez à gauche.", "Allez tout droit."),
    5: ("Je cherche une veste.", "Il fait froid.", "Je vais sortir demain."),
    6: ("Je me lève à sept heures.", "Quelle heure est-il ?", "On va au cinéma ?"),
    7: (
        "Il y a une fuite.",
        "J’ai appelé le propriétaire.",
        "Pouvez-vous réparer la porte ?",
    ),
    8: ("J’ai mal à la tête.", "Vous devez vous reposer.", "J’ai fait du sport."),
    9: (
        "Je voudrais réserver une chambre.",
        "Je suis allé à Québec.",
        "Cet hôtel est moins cher.",
    ),
    10: (
        "Je cherche un emploi.",
        "Je travaille en équipe.",
        "Je peux vous envoyer mon CV.",
    ),
}


class ClassInput(BaseModel):
    date: date
    unit: int = Field(ge=0, le=10)
    pages: str = Field(default="", max_length=200)
    announcement: str = Field(default="", max_length=4000)
    agenda: Literal["Estimada", "Confirmada", "Vista en clase"] = "Estimada"
    preparation: Literal["Pendiente", "Preparada", "Necesita refuerzo"] = "Pendiente"
    difficulty: str = Field(default="", max_length=2000)
    minutes: int = Field(default=0, ge=0, le=240)


@app.get("/api/classes")
def classes(db=Depends(database)):
    return [
        {"id": c.id, **c.data} for c in db.scalars(select(ClassPlan).order_by(ClassPlan.id.desc()))
    ]


@app.put("/api/classes")
def save_class(data: ClassInput, db=Depends(database)):
    id = data.date.isoformat()
    c = db.get(ClassPlan, id)
    if not c:
        c = ClassPlan(id=id, data={})
        db.add(c)
    c.data = data.model_dump(mode="json")
    db.commit()
    return {"id": c.id, **c.data}


@app.post("/api/classes/{id}/tailor")
def tailored_class(id: str, db=Depends(database)):
    from .class_preparation import revision, source_material

    c = get_or_404(db, ClassPlan, id)
    try:
        source_material(c.data)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    current_revision = revision(c.data)
    existing = db.scalar(
        select(StudySession).where(
            StudySession.key == "class-tailored:" + id + ":" + current_revision
        )
    )
    if existing:
        return {"session_id": existing.id}
    job = enqueue(db, "class_prepare", {"class_id": id, "revision": current_revision})
    db.commit()
    return {"job_id": job.id}


@app.post("/api/classes/{id}/prepare")
def prepare_class(id: str, db=Depends(database)):
    c = get_or_404(db, ClassPlan, id)
    u = c.data["unit"]
    phrases = UNIT_PHRASES[u]
    version = (
        __import__("hashlib").sha256(json.dumps(c.data, sort_keys=True).encode()).hexdigest()[:12]
    )
    acts = []
    for i, fr in enumerate(phrases):
        acts.append(
            add_activity(
                db,
                Exercise(
                    key=f"class:{id}:{version}:{i}",
                    title=f"Preparar U{u} · expresión {i + 1}",
                    skill="speaking" if i == 2 else "writing",
                    mode="speak" if i == 2 else "exact",
                    prompt="Escucha y recupera la expresión de memoria. Después cambia un dato y formula una pregunta para clase.",
                    reference=fr,
                    accepted=[fr] if i != 2 else [],
                    item=__import__("app.learning", fromlist=["item_id"]).item_id(fr),
                    explanation="Referencia: " + fr,
                    source={
                        "unit": u,
                        "printed_page": UNIT_PAGES[u],
                        "pdf_page": 1,
                        "relationship": "Expresiones originales alineadas; páginas solicitadas: "
                        + c.data["pages"],
                    },
                    minutes=8,
                ).model_dump(),
                "class:" + version,
            )
        )
    s = snapshot_session(
        db,
        "class:" + id + ":" + version,
        "Preparación de clase · U" + str(u),
        "class",
        acts,
        {
            "class_id": id,
            "agenda": c.data["agenda"],
            "goal": "Ensaya expresiones, pregunta por lo que no entiendas y revisa las páginas anunciadas.",
        },
    )
    c.data = {**c.data, "session_id": s.id}
    db.commit()
    return session_data(db, s)


@app.get("/api/pdfs/{unit}")
def pdf(unit: int):
    if unit < 0 or unit > 10:
        raise HTTPException(404)
    files = list(
        (ROOT / "pdf_classes/french-class-A1-level").glob(f"{UNIT_PAGES[unit]}_Unit_*.pdf")
    )
    if not files:
        raise HTTPException(404)
    return FileResponse(files[0], media_type="application/pdf")


@app.post("/api/export")
def export():
    return FileResponse(
        export_archive(), filename="tuto-export.tar.gz", media_type="application/gzip"
    )


# API routes take precedence; the built React app is served from the same local origin.
if (ROOT / "frontend/dist").exists():
    app.mount("/assets", StaticFiles(directory=ROOT / "frontend/dist/assets"), name="assets")


@app.get("/{path:path}")
def frontend(path: str):
    if path.startswith("api/"):
        raise HTTPException(404, "Ruta no encontrada")
    index = ROOT / "frontend/dist/index.html"
    if index.exists():
        return FileResponse(index)
    return JSONResponse(
        {"detail": "Compila la interfaz con pnpm --dir frontend build"}, status_code=503
    )
