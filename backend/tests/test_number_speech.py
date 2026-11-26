from copy import deepcopy
from uuid import uuid4

import pytest
from app.config import config
from app.db import Activity, Attempt, Media, Memory, Review, Settings
from sqlalchemy import func, select
from test_number_practice import next_round, start


def draft(db, text="Dix.", **quality):
    path = config.data_dir / "recordings" / f"{uuid4()}.webm"
    path.parent.mkdir(exist_ok=True)
    path.write_bytes(b"draft-audio-fixture")
    media = Media(
        kind="recording",
        path=str(path.relative_to(config.data_dir)),
        info={
            "text": text,
            "no_speech": False,
            "needs_retry": False,
            "transcription_requested": True,
            **quality,
        },
    )
    db.add(media)
    db.commit()
    return media, path


def preview(client, s, m):
    return client.post(
        f"/api/number-practice/{s['id']}/speech-preview",
        json={"activity_id": s["activity"]["id"], "media_id": m.id},
    )


def body(s, m, text="Dix.", check=True):
    return {
        "id": str(uuid4()),
        "session_id": s["id"],
        "activity_id": s["activity"]["id"],
        "response": text,
        "media_id": m.id,
        "number_recognition_check": check,
        "transcript_matches": False,
    }


@pytest.mark.parametrize("number,text,score", [(10, "Dix.", 100), (10, "10", 100), (7, "Dix.", 0)])
def test_preview_has_no_history_and_continue_saves_same_automatic_result(
    client, db, number, text, score
):
    s, _ = start(client, number, number)
    s = next_round(client, s["id"], "speak")
    m, path = draft(db, text)
    activity = deepcopy(db.get(Activity, s["activity"]["id"]).data)
    count = db.scalar(select(func.count()).select_from(Memory))
    for _ in range(2):
        response = preview(client, s, m)
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["transcription"] == text and data["result"]["score"] == score
    assert db.scalar(select(func.count()).select_from(Attempt)) == 0
    assert db.scalar(select(func.count()).select_from(Review)) == 0
    assert db.scalar(select(func.count()).select_from(Memory)) == count
    assert db.get(Activity, s["activity"]["id"]).data == activity
    assert (
        client.get(f"/api/number-practice/{s['id']}?mode=speak").json()["activity"]["id"]
        == s["activity"]["id"]
    )
    payload = body(s, m, text)
    result = client.post("/api/attempts", json=payload)
    assert result.status_code == 200, result.text
    saved = result.json()
    assert saved["result"] == data["result"]
    assert saved["evidence"]["transcript_matches"] is False
    assert saved["evidence"]["number_recognition_check"] is True
    assert "transcript_review" not in saved["evidence"]
    assert "sin confirmación humana" in saved["result"]["method"]
    assert client.post("/api/attempts", json=payload).json()["id"] == saved["id"]
    assert preview(client, s, m).status_code == 422
    assert client.post(f"/api/recordings/{m.id}/discard").status_code == 409
    assert path.read_bytes() == b"draft-audio-fixture"
    assert db.scalar(select(func.count()).select_from(Attempt)) == 1
    assert (
        client.post(
            "/api/attempts", json={**payload, "number_recognition_check": False}
        ).status_code
        == 409
    )


def test_retry_discards_only_pending_audio_and_keeps_number_and_statistics(client, db):
    s, _ = start(client, 7, 10)
    s = next_round(client, s["id"], "speak")
    m, path = draft(db)
    assert preview(client, s, m).status_code == 200
    assert client.post(f"/api/recordings/{m.id}/discard").status_code == 200
    assert not path.exists()
    snapshot = client.get(f"/api/number-practice/{s['id']}?mode=speak").json()
    assert snapshot["activity"]["id"] == s["activity"]["id"]
    assert snapshot["accuracy"]["attempts"] == 0
    assert preview(client, s, m).status_code == 422
    m2, _ = draft(db)
    assert preview(client, s, m2).status_code == 200
    assert db.scalar(select(func.count()).select_from(Attempt)) == 0


@pytest.mark.parametrize("quality", [{"no_speech": True}, {"needs_retry": True}, {"text": ""}])
def test_unreliable_recognition_cannot_be_validated_or_counted_as_success(client, db, quality):
    s, _ = start(client, 10, 10)
    s = next_round(client, s["id"], "speak")
    m, _ = draft(db, **quality)
    assert preview(client, s, m).status_code == 422
    assert db.scalar(select(func.count()).select_from(Attempt)) == 0


def test_manual_mode_keeps_untranscribed_audio_unscored_and_rejects_forged_text(client, db):
    s, _ = start(client, 10, 10)
    s = next_round(client, s["id"], "speak")
    m = Media(kind="recording", path="pending.webm", info={"transcription_requested": False})
    db.add(m)
    db.commit()
    assert preview(client, s, m).status_code == 422
    assert client.post("/api/attempts", json=body(s, m, "10")).status_code == 422
    assert client.post("/api/attempts", json=body(s, m, "", True)).status_code == 422
    saved = client.post("/api/attempts", json=body(s, m, "", False))
    assert saved.status_code == 200, saved.text
    assert saved.json()["result"]["score"] is None


def test_validation_is_bound_to_recording_current_number_and_scope(client, db):
    s, _ = start(client)
    m, _ = draft(db)
    assert preview(client, s, m).status_code == 422  # writing, not speaking
    assert client.post("/api/attempts", json=body(s, m)).status_code == 422
    s = next_round(client, s["id"], "speak")
    assert client.post("/api/attempts", json=body(s, m, "sept")).status_code == 422
    m.info = {**m.info, "deleted": True}
    db.commit()
    assert preview(client, s, m).status_code == 422


def test_auto_validation_defaults_and_persists_independently(client, db):
    before = deepcopy(db.get(Settings, 1).data)
    assert "auto_validate_number_speech" not in before
    assert client.get("/api/settings").json()["auto_validate_number_speech"] is True
    cfg = client.patch(
        "/api/settings/number-speech", json={"auto_validate_number_speech": False}
    ).json()
    assert cfg["auto_validate_number_speech"] is False
    client.put("/api/settings", json={**cfg, "target": 80})
    cfg = client.get("/api/settings").json()
    assert cfg["auto_validate_number_speech"] is False and cfg["auto_advance_choices"] is True
    assert client.patch("/api/settings/number-speech", json={}).status_code == 422
