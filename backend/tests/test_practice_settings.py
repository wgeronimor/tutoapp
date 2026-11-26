from copy import deepcopy

from app.db import Settings


def test_auto_advance_defaults_for_existing_settings_without_changing_them(client, db):
    original = deepcopy(db.get(Settings, 1).data)
    assert "auto_advance_choices" not in original
    assert client.get("/api/settings").json()["auto_advance_choices"] is True
    assert db.get(Settings, 1).data == original


def test_practice_setting_persists_and_preserves_other_preferences(client, db):
    before = client.get("/api/settings").json()
    for enabled in [False, True, False]:
        result = client.patch("/api/settings/practice", json={"auto_advance_choices": enabled})
        assert result.status_code == 200
        assert result.json() == {**before, "auto_advance_choices": enabled}
        assert client.get("/api/settings").json()["auto_advance_choices"] is enabled
    # The general settings screen also preserves this preference.
    cfg = client.get("/api/settings").json()
    result = client.put("/api/settings", json={**cfg, "target": 80})
    assert result.json()["auto_advance_choices"] is False
    assert client.get("/api/settings").json()["target"] == 80
    assert client.patch("/api/settings/practice", json={}).status_code == 422
    assert client.get("/api/settings").json()["auto_advance_choices"] is False


def test_dictation_advance_is_independent_and_survives_other_settings(client, db):
    original = deepcopy(db.get(Settings, 1).data)
    before = client.get("/api/settings").json()
    assert before["auto_advance_dictation"] is True
    assert "auto_advance_dictation" not in original
    for value in [False, True, False]:
        response = client.patch("/api/settings/dictation", json={"auto_advance_dictation": value})
        assert response.status_code == 200
        assert response.json() == {**before, "auto_advance_dictation": value}
    client.patch("/api/settings/practice", json={"auto_advance_choices": False})
    cfg = client.get("/api/settings").json()
    assert cfg["auto_advance_dictation"] is False and cfg["auto_advance_choices"] is False
    client.put("/api/settings", json={**cfg, "target": 80})
    cfg = client.get("/api/settings").json()
    assert cfg["auto_advance_dictation"] is False and cfg["target"] == 80
    assert client.patch("/api/settings/dictation", json={}).status_code == 422
    assert client.get("/api/settings").json()["auto_advance_dictation"] is False


def test_writing_auto_advance_defaults_and_remembers_independent_preference(client, db):
    original = deepcopy(db.get(Settings, 1).data)
    before = client.get("/api/settings").json()
    assert before["auto_advance_writing"] is True
    assert "auto_advance_writing" not in original
    response = client.patch("/api/settings/writing", json={"auto_advance_writing": False})
    assert response.status_code == 200
    assert response.json() == {**before, "auto_advance_writing": False}
    client.patch("/api/settings/dictation", json={"auto_advance_dictation": False})
    cfg = client.get("/api/settings").json()
    assert cfg["auto_advance_writing"] is False
    assert cfg["auto_advance_choices"] is True and cfg["auto_advance_dictation"] is False
    client.put("/api/settings", json={**cfg, "target": 80})
    assert client.get("/api/settings").json()["auto_advance_writing"] is False
    assert client.patch("/api/settings/writing", json={}).status_code == 422
