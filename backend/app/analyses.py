"""Temporary model runs. History comparisons are never persisted or saveable."""

import json
import shutil
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import timedelta
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from .audio import transcribe
from .config import ROOT, config
from .db import Activity, Attempt, Media, Session, StudySession, now, uid
from .evaluation import evaluate_text
from .transcriptions import selected_run


class AnalysisRequest(BaseModel):
    mode: Literal["history", "draft"]
    attempt_id: str | None = None
    draft_attempt_id: str | None = None
    session_id: str | None = None
    activity_id: str | None = None
    response: str = Field(default="", max_length=10000)
    media_id: str | None = None
    transcription_run_id: str | None = None
    transcript_matches: bool = False


_lock = threading.RLock()
_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="tuto-preview")
_entries = {}


def _context(data):
    with Session() as db:
        if data.mode == "history":
            attempt = db.get(Attempt, data.attempt_id)
            if not attempt:
                raise ValueError("Intento no encontrado")
            activity = db.get(Activity, attempt.activity_id)
            media = db.get(Media, attempt.media_id) if attempt.media_id else None
            return {
                "mode": "history",
                "attempt_id": attempt.id,
                "activity_id": activity.id,
                "activity": deepcopy(activity.data),
                "response": attempt.response,
                "media_id": attempt.media_id,
                "media_path": media.path if media and not media.info.get("deleted") else None,
            }
        session = db.get(StudySession, data.session_id)
        activity = db.get(Activity, data.activity_id)
        if (
            not data.draft_attempt_id
            or not session
            or not activity
            or activity.id not in session.activity_ids
        ):
            raise ValueError("Selecciona una actividad y un borrador válido")
        if db.get(Attempt, data.draft_attempt_id):
            raise ValueError(
                "Este intento ya está guardado; usa comparación temporal desde el historial"
            )
        if activity.data["mode"] not in ("open", "speak"):
            raise ValueError("Esta actividad utiliza una clave revisada")
        media = db.get(Media, data.media_id) if data.media_id else None
        if activity.data["mode"] == "speak" and not media:
            raise ValueError("Elige una grabación antes de evaluar")
        if media:
            from sqlalchemy import select

            if media.info.get("deleted") or db.scalar(
                select(Attempt.id).where(Attempt.media_id == media.id).limit(1)
            ):
                raise ValueError("La toma está guardada o descartada; graba un nuevo intento")
            run = selected_run(media, data.transcription_run_id)
            if data.response != run["text"]:
                raise ValueError("No se admite sustituir la transcripción por texto manual")
            if not data.transcript_matches:
                raise ValueError("Confirma la lectura antes de solicitar el comentario textual")
        if not data.response.strip():
            raise ValueError("No hay texto para comentar")
        return {
            "mode": "draft",
            "draft_attempt_id": data.draft_attempt_id,
            "session_id": session.id,
            "activity_id": activity.id,
            "activity": deepcopy(activity.data),
            "response": data.response,
            "media_id": data.media_id,
            "transcription_run_id": run["id"] if media else None,
            "transcript_matches": data.transcript_matches,
        }


def create(data):
    context = _context(data)
    id = uid()
    with _lock:
        expired = [
            key
            for key, value in _entries.items()
            if now() - value["created"] > timedelta(hours=1)
            and value["status"] not in ("queued", "running")
        ]
        for key in expired:
            _entries.pop(key, None)
        if len(_entries) > 100:
            raise ValueError(
                "Hay demasiadas comparaciones temporales; vuelve a intentarlo más tarde"
            )
        _entries[id] = {
            "id": id,
            "created": now(),
            "status": "queued",
            "context": context,
            "result": {},
            "error": None,
        }
    _pool.submit(_run, id)
    return id


def _run(id):
    with _lock:
        _entries[id]["status"] = "running"
        context = deepcopy(_entries[id]["context"])
    try:
        result = {
            "temporary": True,
            "saveable": context["mode"] == "draft",
            "created": now().isoformat(),
            "mode": context["mode"],
            "models": [
                {k: v for k, v in item.items() if k in ("role", "repo_id", "revision")}
                for item in json.loads((ROOT / "config/audio-models.json").read_text())
            ],
        }
        response = context["response"]
        if context["mode"] == "history" and context["media_id"]:
            if not context["media_path"]:
                raise ValueError("No está disponible el audio original")
            folder = config.data_dir / "temporary-analyses"
            folder.mkdir(exist_ok=True)
            with tempfile.TemporaryDirectory(dir=folder) as temp:
                source = config.data_dir / context["media_path"]
                copy = Path(temp) / ("input" + source.suffix)
                shutil.copyfile(source, copy)
                reading = transcribe(copy)
                result["recognition"] = {
                    k: v for k, v in reading.items() if k not in ("normalized", "normalized_sha256")
                }
            response = reading["text"]
            result["recognition_unconfirmed"] = True
        if response.strip():
            try:
                result["advice"] = evaluate_text(
                    context["activity"], response, bool(context["media_id"])
                )
                if context["mode"] == "history" and context["media_id"]:
                    result["advice"]["input_basis"] = "unconfirmed_temporary_recognition"
            except Exception as exc:
                result["advice_error"] = str(exc)
        else:
            result["advice_error"] = (
                "No hay texto fiable para evaluar; conserva el original y realiza otra toma."
            )
        result["input_text"] = response
        with _lock:
            _entries[id].update(status="completed", result=result)
    except Exception as exc:
        with _lock:
            _entries[id].update(status="failed", error=str(exc))


def get(id):
    with _lock:
        entry = _entries.get(id)
        if not entry:
            raise ValueError("La comparación temporal ya no está disponible")
        return {
            "id": id,
            "status": entry["status"],
            "result": deepcopy(entry["result"]),
            "error": entry["error"],
        }


def snapshot(id, attempt, run_id=None):
    with _lock:
        entry = _entries.get(id)
        if not entry or entry["status"] != "completed":
            raise ValueError(
                "La evaluación previa no está disponible; vuelve a evaluarla o guarda sin IA"
            )
        c = entry["context"]
        if c["mode"] != "draft" or (
            c["draft_attempt_id"],
            c["session_id"],
            c["activity_id"],
            c["response"],
            c["media_id"],
        ) != (
            attempt.id,
            attempt.session_id,
            attempt.activity_id,
            attempt.response,
            attempt.media_id,
        ):
            raise ValueError(
                "Una comparación histórica no puede guardarse ni reemplazar un intento; evalúa el nuevo borrador"
            )
        if c["media_id"] and (
            not attempt.transcript_matches or c["transcription_run_id"] != run_id
        ):
            raise ValueError("La confirmación o lectura cambió; vuelve a evaluar el borrador")
        return deepcopy(entry["result"])
