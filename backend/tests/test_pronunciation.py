from copy import deepcopy

import pytest
from app.db import Activity, Job, Media
from app.pronunciation import reference_guide
from sqlalchemy import func, select


@pytest.mark.parametrize(
    "text,expected",
    [
        ("dix", "dis"),
        ("10", "dis"),
        ("six", "sis"),
        ("dix dollars", "di dɔlaʁ"),
        ("dix ans", "diz ɑ̃"),
        ("six euros", "siz øʁo"),
        ("les amis", "lez ami"),
    ],
)
def test_real_french_ipa_varies_with_context(text, expected):
    guide = reference_guide(text)
    assert guide["ipa"] == expected
    assert guide["text"] == text
    assert guide["automatic"] is True
    assert guide["notes"]


def test_guide_is_independent_of_saved_content_and_generated_audio(client, db):
    session = client.post("/api/days/1/start").json()
    activity = next(a for a in session["activities"] if a["mode"] == "exact")
    assert activity["has_audio"] is True and "reference" not in activity
    stored = db.get(Activity, activity["id"])
    original = deepcopy(stored.data)
    jobs = db.scalar(select(func.count()).select_from(Job))
    media = db.scalar(select(func.count()).select_from(Media))
    result = client.get(f"/api/activities/{activity['id']}/pronunciation")
    assert result.status_code == 200, result.text
    assert result.json()["text"] == original["reference"]
    assert "bɔ̃ʒuʁ" in result.json()["ipa"]
    assert all(c not in result.json()["ipa"] for c in ["ˈ", "ˌ", "^", "-"])
    db.refresh(stored)
    assert stored.data == original
    assert db.scalar(select(func.count()).select_from(Job)) == jobs
    assert db.scalar(select(func.count()).select_from(Media)) == media
    spontaneous = next(a for a in session["activities"] if a["key"].endswith(":speak"))
    assert spontaneous["has_audio"] is False
    assert client.get(f"/api/activities/{spontaneous['id']}/pronunciation").status_code == 422
    assert client.get("/api/activities/not-found/pronunciation").status_code == 404


def test_guide_failure_is_recoverable_without_changing_activity(client, db, monkeypatch):
    import app.pronunciation as pronunciation

    def fail(text):
        raise RuntimeError("Component unavailable")

    monkeypatch.setattr(pronunciation, "reference_guide", fail)
    session = client.post("/api/days/1/start").json()
    activity = session["activities"][0]
    original = deepcopy(db.get(Activity, activity["id"]).data)
    result = client.get(f"/api/activities/{activity['id']}/pronunciation")
    assert result.status_code == 503
    assert "reintentar" in result.json()["detail"]
    assert (
        client.get(f"/api/activities/{activity['id']}/transcript").json()["text"]
        == original["reference"]
    )
    db.expire_all()
    assert db.get(Activity, activity["id"]).data == original
