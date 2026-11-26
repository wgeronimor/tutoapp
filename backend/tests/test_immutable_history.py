import hashlib
import time
from copy import deepcopy
from uuid import uuid4

import pytest
from app.analyses import AnalysisRequest, create, get
from app.config import config
from app.db import Attempt, Job, Media
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError


def start(client, mode="open"):
    s = client.post("/api/days/1/start").json()
    a = next(x for x in s["activities"] if x["mode"] == mode)
    return s, a


def wait(id):
    for _ in range(200):
        value = get(id)
        if value["status"] in ("completed", "failed"):
            return value
        time.sleep(0.01)
    raise AssertionError("La comparación no terminó")


def fake_advice(activity, response, recorded=False):
    return {
        "corrected": response,
        "feedback": "El mensaje es comprensible.",
        "next_action": "Prueba otro contexto.",
        "has_error": False,
        "source": "Modelo de prueba",
        "score": None,
        "input_text": response,
        "input_basis": "recognizer_transcript_confirmed_by_learner"
        if recorded
        else "written_response",
        "acoustic_evaluation": False,
    }


def test_history_comparison_changes_no_rows_or_audio(client, db, monkeypatch):
    import app.analyses as analyses

    s, a = start(client, "speak")
    file = config.data_dir / "voice.webm"
    file.write_bytes(b"original audio bytes")
    m = Media(
        path="voice.webm", kind="recording", info={"text": "Texto original.", "no_speech": False}
    )
    db.add(m)
    db.commit()
    payload = {
        "id": str(uuid4()),
        "session_id": s["id"],
        "activity_id": a["id"],
        "media_id": m.id,
        "response": "Texto original.",
    }
    saved = client.post("/api/attempts", json=payload).json()
    attempt = db.get(Attempt, saved["id"])
    before = (deepcopy(attempt.result), deepcopy(attempt.evidence), deepcopy(m.info))
    sha = hashlib.sha256(file.read_bytes()).hexdigest()

    def recognize(path):
        assert path != file and path.read_bytes() == file.read_bytes()
        return {
            "text": "Nueva lectura.",
            "model": "modelo actual",
            "revision": "revision-nueva",
            "alternatives": [],
            "normalized": "temporal.wav",
        }

    monkeypatch.setattr(analyses, "transcribe", recognize)
    monkeypatch.setattr(analyses, "evaluate_text", fake_advice)
    request = client.post("/api/analyses", json={"mode": "history", "attempt_id": attempt.id})
    assert request.status_code == 200
    id = request.json()["analysis_id"]
    value = wait(id)
    assert (
        value["status"] == "completed"
        and value["result"]["recognition"]["text"] == "Nueva lectura."
    )
    assert not value["result"]["saveable"]
    db.refresh(attempt)
    db.refresh(m)
    assert (attempt.result, attempt.evidence, m.info) == before and hashlib.sha256(
        file.read_bytes()
    ).hexdigest() == sha
    assert db.scalar(select(func.count()).select_from(Attempt)) == 1
    assert db.scalar(select(func.count()).select_from(Job)) == 0
    assert not list((config.data_dir / "temporary-analyses").iterdir())
    assert (
        client.post(
            "/api/attempts", json={**payload, "id": str(uuid4()), "evaluation_id": id}
        ).status_code
        == 409
    )


def test_new_written_attempt_saves_evaluation_atomically_and_is_immutable(client, db, monkeypatch):
    import app.analyses as analyses

    monkeypatch.setattr(analyses, "evaluate_text", fake_advice)
    s, a = start(client)
    id = str(uuid4())
    data = {
        "mode": "draft",
        "draft_attempt_id": id,
        "session_id": s["id"],
        "activity_id": a["id"],
        "response": "Bonjour.",
    }
    token = create(AnalysisRequest(**data))
    assert wait(token)["status"] == "completed"
    payload = {
        "id": id,
        "session_id": s["id"],
        "activity_id": a["id"],
        "response": "Bonjour.",
        "evaluation_id": token,
    }
    assert (
        client.post("/api/attempts", json={**payload, "response": "Texte modifié."}).status_code
        == 409
    )
    saved = client.post("/api/attempts", json=payload)
    assert saved.status_code == 200, saved.text
    assert saved.json()["result"]["advice"]["feedback"] == "El mensaje es comprensible."
    assert client.post("/api/attempts", json=payload).status_code == 200
    assert db.scalar(select(func.count()).select_from(Job)) == 1
    assert client.post("/api/attempts/" + id + "/advice").status_code == 409
    assert client.post("/api/attempts/" + id + "/notes", json={"text": "cambio"}).status_code == 409
    assert client.post("/api/attempts", json={**payload, "id": str(uuid4())}).status_code == 409
    attempt = db.get(Attempt, id)
    with pytest.raises(DBAPIError):
        with db.begin_nested():
            db.execute(
                text("UPDATE attempts SET response=:response WHERE id=:id"),
                {"response": "rewrite", "id": id},
            )
    with pytest.raises(DBAPIError):
        with db.begin_nested():
            db.execute(text("DELETE FROM attempts WHERE id=:id"), {"id": id})
    db.refresh(attempt)
    assert attempt.response == "Bonjour."


def test_database_protects_saved_audio_activity_and_reviews(client, db):
    s, a = start(client, "speak")
    path = config.data_dir / "protected.webm"
    path.write_bytes(b"protected")
    media = Media(path=path.name, kind="recording", info={"text": "Bonjour.", "no_speech": False})
    db.add(media)
    db.commit()
    saved = client.post(
        "/api/attempts",
        json={
            "id": str(uuid4()),
            "session_id": s["id"],
            "activity_id": a["id"],
            "media_id": media.id,
            "response": "Bonjour.",
        },
    ).json()
    job = Job(
        kind="advice",
        status="completed",
        payload={"attempt_id": saved["id"]},
        result={"feedback": "original"},
    )
    db.add(job)
    db.commit()
    for sql, params in [
        (
            "UPDATE media SET info=jsonb_build_object('deleted', true) WHERE id=:id",
            {"id": media.id},
        ),
        ("DELETE FROM media WHERE id=:id", {"id": media.id}),
        ("UPDATE activities SET data='{}'::jsonb WHERE id=:id", {"id": a["id"]}),
        ("DELETE FROM activities WHERE id=:id", {"id": a["id"]}),
        ("UPDATE jobs SET result='{}'::jsonb WHERE id=:id", {"id": job.id}),
        ("DELETE FROM jobs WHERE id=:id", {"id": job.id}),
    ]:
        with pytest.raises(DBAPIError):
            with db.begin_nested():
                db.execute(text(sql), params)
    assert client.delete("/api/media/" + media.id).status_code == 409
    assert client.post("/api/recordings/" + media.id + "/discard").status_code == 409
    assert path.read_bytes() == b"protected"


def test_spoken_draft_evaluation_requires_unchanged_confirmation(client, db, monkeypatch):
    import app.analyses as analyses

    monkeypatch.setattr(analyses, "evaluate_text", fake_advice)
    s, a = start(client, "speak")
    media = Media(
        path="new-take.webm", kind="recording", info={"text": "Bonjour.", "no_speech": False}
    )
    db.add(media)
    db.commit()
    id = str(uuid4())
    request = {
        "mode": "draft",
        "draft_attempt_id": id,
        "session_id": s["id"],
        "activity_id": a["id"],
        "media_id": media.id,
        "response": "Bonjour.",
        "transcript_matches": True,
    }
    token = create(AnalysisRequest(**request))
    assert wait(token)["status"] == "completed"
    payload = {
        "id": id,
        "session_id": s["id"],
        "activity_id": a["id"],
        "media_id": media.id,
        "response": "Bonjour.",
        "evaluation_id": token,
    }
    assert client.post("/api/attempts", json=payload).status_code == 409
    response = client.post("/api/attempts", json={**payload, "transcript_matches": True})
    assert response.status_code == 200, response.text
    assert response.json()["evidence"]["transcript_review"]["status"] == "matches"
    assert response.json()["result"]["advice"]["input_text"] == "Bonjour."
