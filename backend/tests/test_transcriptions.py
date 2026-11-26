from uuid import uuid4

from app.db import Activity, Attempt, Job, Media
from app.transcriptions import append_run, runs
from sqlalchemy import select


def recorded(client, db, text="Bonjour, je m'appelle Wilson."):
    s = client.post("/api/days/1/start").json()
    a = next(x for x in s["activities"] if x["mode"] == "speak")
    m = Media(
        path="recordings/test.webm", kind="recording", info={"text": text, "no_speech": False}
    )
    db.add(m)
    db.commit()
    return (
        s,
        a,
        m,
        {
            "id": str(uuid4()),
            "session_id": s["id"],
            "activity_id": a["id"],
            "media_id": m.id,
            "response": text,
        },
    )


def test_cannot_substitute_typed_text_for_asr(client, db):
    _, _, m, p = recorded(client, db, "Bonjour, James Paul Wilson.")
    response = client.post("/api/attempts", json={**p, "response": "Bonjour, je m'appelle Wilson."})
    assert response.status_code == 422
    db.refresh(m)
    assert m.info["text"] == "Bonjour, James Paul Wilson."
    assert db.scalar(select(Attempt)) is None
    saved = client.post("/api/attempts", json=p)
    assert saved.status_code == 200
    assert saved.json()["evidence"]["raw_transcription"] == p["response"]
    assert saved.json()["transcription"] == p["response"]


def test_new_readings_append_and_keep_original_immutable(client, db):
    _, _, m, p = recorded(client, db, "James Paul Wilson.")
    first = dict(m.info)
    r = append_run(
        m,
        {
            "text": "Je m'appelle Wilson.",
            "model": "whisper",
            "revision": "pinned",
            "pipeline": "v2",
        },
    )
    db.commit()
    db.refresh(m)
    assert m.info["text"] == first["text"]
    assert runs(m)[0]["text"] == first["text"] and runs(m)[1]["text"] == r["text"]
    assert client.get("/api/media/" + m.id + "/transcriptions").json()[1]["model"] == "whisper"
    # An actual alternative can be selected by identifier, never supplied as arbitrary text.
    ok = client.post(
        "/api/attempts", json={**p, "transcription_run_id": r["id"], "response": r["text"]}
    )
    assert ok.status_code == 200
    assert ok.json()["evidence"]["recognizer"] == "whisper"
    assert (
        client.post(
            "/api/attempts", json={**p, "id": str(uuid4()), "transcription_run_id": "invented"}
        ).status_code
        == 409
    )


def test_saved_review_and_feedback_routes_are_read_only(client, db):
    _, _, m, p = recorded(client, db)
    saved = client.post("/api/attempts", json=p).json()
    before = client.get("/api/sessions/" + p["session_id"]).json()
    for status in ("matches", "mismatch", "unsure"):
        assert (
            client.post(
                "/api/attempts/" + saved["id"] + "/transcript-review", json={"status": status}
            ).status_code
            == 409
        )
    assert client.post("/api/attempts/" + saved["id"] + "/advice").status_code == 409
    assert client.post("/api/media/" + m.id + "/retranscribe").status_code == 409
    assert client.get("/api/sessions/" + p["session_id"]).json() == before


def test_legacy_edited_response_and_bad_feedback_remain_traceable(client, db):
    s, a, m, p = recorded(client, db, "Jemma Pell Wilson.")
    old = Attempt(
        id=str(uuid4()),
        session_id=s["id"],
        activity_id=a["id"],
        media_id=m.id,
        response="Je m'appelle Wilson.",
        evidence={},
        result={
            "score": None,
            "advice": {
                "feedback": "La pronunciación es adecuada.",
                "corrected": "Je m'appelle Wilson.",
            },
        },
    )
    db.add(old)
    db.commit()
    entry = client.get("/api/sessions/" + s["id"]).json()["activities"]
    item = next(x for x in entry if x["id"] == a["id"])["attempt"]
    assert item["transcription"] == "Jemma Pell Wilson."
    assert item["response"] == old.response and item["legacy_response_differs"]
    assert item["advice_unverified"]
    reviewed = client.post(
        "/api/attempts/" + old.id + "/transcript-review", json={"status": "matches"}
    )
    assert reviewed.status_code == 409
    db.refresh(old)
    assert old.response == "Je m'appelle Wilson."
    assert "transcript_review" not in old.evidence


def test_text_model_cannot_claim_pronunciation(monkeypatch):
    import app.evaluation as evaluation
    import pytest

    monkeypatch.setattr(
        evaluation,
        "ollama",
        lambda schema, system, payload: schema(
            corrected=payload["response"],
            feedback="Tu pronunciación es perfecta.",
            next_action="Continúa.",
            has_error=False,
        ),
    )
    with pytest.raises(ValueError):
        evaluation.evaluate_text({"prompt": "Présente-toi", "reference": ""}, "Bonjour.", True)


def test_recording_measurement_is_not_a_pronunciation_grade(tmp_path):
    import array
    import wave

    from app.speech_signal import measurements

    path = tmp_path / "quiet.wav"
    with wave.open(str(path), "wb") as file:
        file.setnchannels(1)
        file.setsampwidth(2)
        file.setframerate(16000)
        file.writeframes(array.array("h", [100, -100] * 8000).tobytes())
    metrics, _ = measurements(path)
    assert metrics["rms_dbfs"] < -40
    assert metrics["duration_seconds"] == 1
    assert "score" not in metrics


def test_saving_without_transcription_avoids_model_job(client, db):
    from app.config import config
    from app.db import Job

    response = client.post(
        "/api/recordings",
        files={"file": ("take.webm", b"test local recording", "audio/webm")},
        data={"transcribe": "false"},
    )
    assert response.status_code == 200 and response.json()["job_id"] is None
    assert db.scalar(select(Job)) is None
    mid = response.json()["media_id"]
    m = db.get(Media, mid)
    s = client.post("/api/days/1/start").json()
    a = next(x for x in s["activities"] if x["mode"] == "speak")
    payload = {
        "id": str(uuid4()),
        "session_id": s["id"],
        "activity_id": a["id"],
        "media_id": mid,
        "response": "",
    }
    assert (
        client.post("/api/attempts", json={**payload, "response": "invented words"}).status_code
        == 422
    )
    saved = client.post("/api/attempts", json=payload)
    assert saved.status_code == 200
    assert saved.json()["evidence"]["transcription_status"] == "not_requested"
    assert client.post("/api/recordings/" + mid + "/discard").status_code == 409
    assert (config.data_dir / m.path).exists()


def test_discard_removes_only_unsaved_recording_and_all_derivatives(client, db):
    from app.config import config

    response = client.post(
        "/api/recordings",
        files={"file": ("take.webm", b"preview", "audio/webm")},
        data={"transcribe": "false"},
    )
    mid = response.json()["media_id"]
    m = db.get(Media, mid)
    from pathlib import Path

    derivative = Path(m.path).with_suffix(".asr-v2.pcm.wav")
    (config.data_dir / derivative).write_bytes(b"converted")
    assert client.post("/api/recordings/" + mid + "/discard").status_code == 200
    db.refresh(m)
    assert m.info["discarded"] and m.info["deleted"]
    assert not (config.data_dir / m.path).exists() and not (config.data_dir / derivative).exists()
    assert client.post("/api/recordings/" + mid + "/discard").status_code == 200
    assert client.get("/api/media/" + mid).status_code == 410


def test_audio_preference_persists_without_overwriting_other_settings(client):
    before = client.get("/api/settings").json()
    after = client.patch("/api/settings/audio", json={"auto_transcribe": False}).json()
    assert after["auto_transcribe"] is False
    for key, value in before.items():
        if key != "auto_transcribe":
            assert after[key] == value
    assert client.get("/api/settings").json()["auto_transcribe"] is False


def test_review_preference_defaults_on_and_preserves_other_settings(client):
    before = client.get("/api/settings").json()
    assert before["auto_review"] is True
    after = client.patch("/api/settings/review", json={"auto_review": False}).json()
    assert after == {**before, "auto_review": False}
    assert client.get("/api/settings").json()["auto_review"] is False
    after["target"] = 90
    assert client.put("/api/settings", json=after).json()["auto_review"] is False
    client.patch("/api/settings/audio", json={"auto_transcribe": False})
    assert client.get("/api/settings").json()["auto_review"] is False
    assert client.patch("/api/settings/review", json={}).status_code == 422


def test_attempt_counts_and_filterable_history(client, db):
    s = client.post("/api/days/1/start").json()
    a = next(x for x in s["activities"] if x["mode"] == "exact")
    ref = db.get(Activity, a["id"]).data["accepted"][0]
    ids = []
    for response in ["incorrect", ref]:
        saved = client.post(
            "/api/attempts",
            json={
                "id": str(uuid4()),
                "session_id": s["id"],
                "activity_id": a["id"],
                "response": response,
            },
        ).json()
        ids.append(saved["id"])
    session = client.get("/api/sessions/" + s["id"]).json()
    assert session["attempt_count"] == 2
    activity = next(x for x in session["activities"] if x["id"] == a["id"])
    assert activity["attempt_count"] == 2
    history = client.get(
        "/api/attempt-history", params={"session_id": s["id"], "activity_id": a["id"], "limit": 1}
    ).json()
    assert history["total"] == 2 and len(history["items"]) == 1
    assert history["items"][0]["ai_review_status"] == "not_requested"
    next_page = client.get(
        "/api/attempt-history",
        params={"session_id": s["id"], "activity_id": a["id"], "limit": 1, "offset": 1},
    ).json()
    assert next_page["items"][0]["id"] != history["items"][0]["id"]
    assert client.get("/api/attempt-history", params={"skill": "speaking"}).json()["total"] == 0


def test_every_ai_review_is_visible_and_failures_are_distinct(client, db):
    s = client.post("/api/days/1/start").json()
    a = next(x for x in s["activities"] if x["mode"] == "open")
    saved = client.post(
        "/api/attempts",
        json={
            "id": str(uuid4()),
            "session_id": s["id"],
            "activity_id": a["id"],
            "response": "Bonjour.",
        },
    ).json()
    attempt = db.get(Attempt, saved["id"])
    results = [
        {"feedback": "Primer comentario.", "corrected": "Bonjour.", "source": "Modelo local"},
        {"feedback": "Segundo comentario.", "corrected": "Bonjour.", "source": "Modelo local"},
    ]
    for result in results:
        db.add(
            Job(
                kind="advice", status="completed", payload={"attempt_id": attempt.id}, result=result
            )
        )
    db.commit()
    row = client.get("/api/attempt-history").json()["items"][0]
    assert row["ai_review_status"] == "reviewed"
    assert [r["result"]["feedback"] for r in row["ai_reviews"]] == [
        "Primer comentario.",
        "Segundo comentario.",
    ]
    pending = Job(kind="advice", status="queued", payload={"attempt_id": attempt.id})
    db.add(pending)
    db.commit()
    assert client.get("/api/attempt-history").json()["items"][0]["ai_review_status"] == "pending"
    pending.status = "failed"
    pending.error = "Revisión descartada por incoherencia"
    db.commit()
    row = client.get("/api/attempt-history").json()["items"][0]
    assert row["ai_review_status"] == "failed" and len(row["ai_reviews"]) == 3
    assert row["ai_reviews"][-1]["error"] == "Revisión descartada por incoherencia"
