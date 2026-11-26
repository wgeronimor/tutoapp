"""Remove only files belonging to a recording, including every derived recognition."""

from pathlib import Path

from .config import config


def remove_files(media):
    from sqlalchemy import select

    from .db import Attempt, Session

    with Session() as db:
        if media.kind != "recording" or db.scalar(
            select(Attempt.id).where(Attempt.media_id == media.id).limit(1)
        ):
            raise ValueError(
                "Los archivos guardados no se eliminan; solo se descartan tomas sin guardar."
            )
    original = Path(media.path)
    paths = {
        media.path,
        media.info.get("normalized"),
        str(original.with_suffix(".pcm.wav")),
        str(original.with_suffix(".asr-v2.pcm.wav")),
    }
    paths.update(r.get("normalized") for r in media.info.get("transcription_runs", []))
    for relative in paths:
        if not relative:
            continue
        path = (config.data_dir / relative).resolve()
        if config.data_dir.resolve() not in path.parents:
            raise ValueError("Ruta de grabación inválida")
        path.unlink(missing_ok=True)
