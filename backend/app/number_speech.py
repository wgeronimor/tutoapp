"""Read-only numeric feedback on an uncommitted recording; no learner confirmation implied."""

from sqlalchemy import select

from .db import Activity, Attempt, Media, StudySession
from .learning import settings
from .number_practice import grade_number
from .transcriptions import runs, selected_run


def preview(db, session_id, activity_id, media_id):
    session = db.get(StudySession, session_id)
    activity = db.get(Activity, activity_id)
    if (
        not session
        or session.source not in ("numbers-continuous", "topics-continuous")
        or not activity
        or session.state.get("active", {}).get("speak") != activity_id
        or activity.data.get("source", {}).get("number_mode") != "speak"
    ):
        raise ValueError("Selecciona la ronda oral actual de esta práctica")
    media = db.get(Media, media_id)
    if not media or media.kind != "recording" or media.info.get("deleted"):
        raise ValueError("La toma no está disponible; vuelve a grabar")
    if db.scalar(
        select(Attempt.id)
        .where(
            (Attempt.media_id == media.id)
            | ((Attempt.session_id == session_id) & (Attempt.activity_id == activity_id))
        )
        .limit(1)
    ):
        raise ValueError("El intento ya está guardado; continúa con el siguiente número")
    reading = selected_run(media)
    if (
        reading.get("needs_retry")
        or reading.get("no_speech")
        or not reading.get("text", "").strip()
    ):
        raise ValueError("No hay una transcripción fiable para validar; vuelve a grabar")
    from .continuous_topics import grade as grade_topic

    grader = grade_topic if session.source == "topics-continuous" else grade_number
    return {
        "transcription": reading["text"],
        "model": reading.get("model"),
        "revision": reading.get("revision"),
        "alternatives": runs(media)[1:],
        "needs_review": bool(reading.get("needs_review")),
        "result": grader(
            activity.data,
            reading["text"],
            settings(db).data["target"],
            {"number_recognition_check": True},
        ),
    }
