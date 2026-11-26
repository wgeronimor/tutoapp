"""Immutable recognizer outputs and explicit learner review, without manual replacement."""

from copy import deepcopy

from .db import now, uid

LEGACY_MODEL = "mlx-community/Qwen3-ASR-0.6B-8bit"
LEGACY_REVISION = "89e96d92ba34aca20b3e29fb10cc284097d1219f"


def runs(media):
    saved = deepcopy(media.info.get("transcription_runs", []))
    if not saved and "text" in media.info:
        saved = [
            {
                "id": "legacy:" + media.id,
                "text": media.info["text"],
                "model": media.info.get("model", LEGACY_MODEL),
                "revision": media.info.get("revision", LEGACY_REVISION),
                "pipeline": media.info.get("pipeline", "asr-v1"),
                "created": media.created.isoformat(),
                "legacy": True,
                "no_speech": media.info.get("no_speech", False),
                "needs_retry": media.info.get("needs_retry", False),
            }
        ]
    return saved


def append_run(media, result):
    history = runs(media)
    run = {"id": uid(), "created": now().isoformat(), **result}
    # The first output is immutable. Reprocessing only adds a new run.
    update = {"transcription_runs": [*history, run]}
    if "text" not in media.info:
        update = {**result, **update, "primary_run_id": run["id"]}
    media.info = {**media.info, **update}
    return run


def selected_run(media, id=None):
    history = runs(media)
    if not history:
        raise ValueError("Espera a que termine el reconocimiento")
    if id is None:
        return history[0]
    for run in history:
        if run["id"] == id:
            return run
    raise ValueError("El reconocimiento no pertenece a esta grabación")


def legacy_advice_unverified(attempt):
    advice = attempt.result.get("advice")
    return bool(
        attempt.media_id
        and advice
        and advice.get("input_basis") != "recognizer_transcript_confirmed_by_learner"
    )
