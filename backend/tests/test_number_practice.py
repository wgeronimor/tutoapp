from copy import deepcopy
from types import SimpleNamespace
from uuid import uuid4

import pytest
from app.db import Activity, Attempt, Media
from app.learning import number
from app.number_practice import accuracy
from sqlalchemy import func, select


def start(client, lo=1, hi=10):
    payload = {"request_id": str(uuid4()), "minimum": lo, "maximum": hi}
    result = client.post("/api/number-practice", json=payload)
    assert result.status_code == 200, result.text
    return result.json(), payload


def submit(client, db, snapshot, answer=None, **kwargs):
    a = snapshot["activity"]
    data = db.get(Activity, a["id"]).data
    answer = (
        answer
        if answer is not None
        else (
            str(data["source"]["number"])
            if data["source"]["answer_format"] == "digits"
            else number(data["source"]["number"])
        )
    )
    payload = {
        "id": str(uuid4()),
        "session_id": snapshot["id"],
        "activity_id": a["id"],
        "response": answer,
        **kwargs,
    }
    result = client.post("/api/attempts", json=payload)
    assert result.status_code == 200, result.text
    return result.json(), payload


def next_round(client, id, mode):
    response = client.post(f"/api/number-practice/{id}/next", json={"mode": mode})
    assert response.status_code == 200, response.text
    return response.json()


def test_whole_range_before_repeat_both_directions_and_indefinite_rounds(client, db):
    s, _ = start(client, 1, 10)
    values = []
    formats = []
    for i in range(31):
        a = db.get(Activity, s["activity"]["id"])
        values.append(a.data["source"]["number"])
        formats.append(a.data["source"]["answer_format"])
        saved, _ = submit(client, db, s)
        assert saved["result"]["score"] == 100
        s = next_round(client, s["id"], "write")
    for batch in [values[:10], values[10:20], values[20:30]]:
        assert set(batch) == set(range(1, 11))
    assert all(a != b for a, b in zip(values, values[1:]))
    assert set(formats) == {"words", "digits"}
    assert s["accuracy"]["attempts"] == 31 and s["accuracy"]["percent"] == 100
    assert len(s["modes"]) == 5 and s["modes"][0]["seen"] == 10
    assert db.scalar(select(func.count()).select_from(Attempt)) == 31


def test_navigation_and_network_retries_preserve_round_and_single_saved_attempt(client, db):
    s, payload = start(client)
    assert (
        client.post("/api/number-practice", json=payload).json()["activity"]["id"]
        == s["activity"]["id"]
    )
    reading = next_round(client, s["id"], "read")
    again = next_round(client, s["id"], "write")
    assert again["activity"]["id"] == s["activity"]["id"]
    saved, body = submit(client, db, s)
    assert client.post("/api/attempts", json=body).json()["id"] == saved["id"]
    assert client.post("/api/attempts", json={**body, "id": str(uuid4())}).status_code == 409
    resumed = client.post("/api/number-practice", json=payload).json()
    assert resumed["activity"]["id"] == s["activity"]["id"]
    new = next_round(client, s["id"], "write")
    assert new["activity"]["id"] != s["activity"]["id"]
    assert next_round(client, s["id"], "write")["activity"]["id"] == new["activity"]["id"]
    assert next_round(client, s["id"], "read")["activity"]["id"] == reading["activity"]["id"]
    assert (
        client.get(f"/api/number-practice/{s['id']}?mode=write").json()["activity"]["id"]
        == new["activity"]["id"]
    )


def test_format_is_checked_and_all_choices_are_unique_and_inside_range(client, db):
    s, _ = start(client, 88, 100)
    for mode in ["read", "listen"]:
        formats = set()
        for _ in range(2):
            s = next_round(client, s["id"], mode)
            a = db.get(Activity, s["activity"]["id"]).data
            formats.add(a["source"]["answer_format"])
            assert len(a["options"]) == len(set(a["options"])) == 4
            assert a["accepted"][0] in a["options"]
            assert not s["activity"]["material"] if mode == "listen" else s["activity"]["material"]
            submit(client, db, s)
        assert formats == {"words", "digits"}
    for _ in range(2):
        s = next_round(client, s["id"], "write")
        a = db.get(Activity, s["activity"]["id"]).data
        wrong = (
            number(a["source"]["number"])
            if a["source"]["answer_format"] == "digits"
            else str(a["source"]["number"])
        )
        result, _ = submit(client, db, s, wrong)
        assert result["result"]["score"] == 0


def test_speaking_checks_confirmed_number_not_pronunciation_and_ignores_unscored(client, db):
    s, _ = start(client, 10, 10)
    for confirmed in [False, True]:
        s = next_round(client, s["id"], "speak")
        media = Media(
            kind="recording",
            path=str(uuid4()) + ".webm",
            info={"text": "10", "no_speech": False, "needs_retry": False},
        )
        db.add(media)
        db.commit()
        result, _ = submit(client, db, s, "10", media_id=media.id, transcript_matches=confirmed)
        assert result["result"]["score"] == (100 if confirmed else None)
        assert "sin nota de pronunciación" in result["result"]["method"]
    stats = client.get(f"/api/number-practice/{s['id']}").json()["accuracy"]
    assert stats == {"attempts": 2, "correct": 1, "evaluated": 1, "percent": 100, "color": "green"}


@pytest.mark.parametrize(
    "correct,total,color",
    [
        (0, 2, "red"),
        (6, 10, "red"),
        (7, 10, "yellow"),
        (17, 20, "yellow"),
        (43, 50, "green"),
        (1, 1, "green"),
    ],
)
def test_accuracy_thresholds_and_denominator(correct, total, color):
    values = [
        SimpleNamespace(result={"score": 100 if i < correct else 0}) for i in range(total)
    ] + [SimpleNamespace(result={"score": None})]
    stats = accuracy(values)
    assert (
        stats["attempts"] == total + 1 and stats["evaluated"] == total and stats["color"] == color
    )


def test_fixed_sessions_remain_unchanged_and_ranges_are_validated(client, db):
    fixed = client.post("/api/days/1/start").json()
    original = deepcopy(db.get(Activity, fixed["activities"][0]["id"]).data)
    s, _ = start(client)
    submit(client, db, s)
    db.expire_all()
    assert db.get(Activity, fixed["activities"][0]["id"]).data == original
    for lo, hi in [(10, 1), (0, 10), (1, 501)]:
        assert (
            client.post(
                "/api/number-practice",
                json={"request_id": str(uuid4()), "minimum": lo, "maximum": hi},
            ).status_code
            == 422
        )


def test_format_defaults_legacy_compatibility_and_rejected_empty_configuration(client, db):
    from app.db import StudySession

    s, _ = start(client)
    session = db.get(StudySession, s["id"])
    assert "answer_formats" not in session.state
    assert s["answer_formats"] == {
        m: ["words", "digits"] for m in ["write", "listen", "read", "dictation"]
    }
    for values in [[], ["words", "words"], ["invalid"], ["words", "digits", "words"]]:
        assert (
            client.patch(
                f"/api/number-practice/{s['id']}/formats", json={"mode": "write", "formats": values}
            ).status_code
            == 422
        )
    assert (
        client.patch(
            f"/api/number-practice/{s['id']}/formats", json={"mode": "speak", "formats": ["words"]}
        ).status_code
        == 422
    )
    db.refresh(session)
    assert "answer_formats" not in session.state


@pytest.mark.parametrize("mode", ["write", "read", "listen", "dictation"])
@pytest.mark.parametrize("selected", ["words", "digits"])
def test_selected_format_controls_next_draw_without_mutating_current_round(
    client, db, mode, selected
):
    s, _ = start(client)
    s = next_round(client, s["id"], mode)
    current = db.get(Activity, s["activity"]["id"])
    original = deepcopy(current.data)
    result = client.patch(
        f"/api/number-practice/{s['id']}/formats", json={"mode": mode, "formats": [selected]}
    )
    assert result.status_code == 200, result.text
    assert result.json()["activity"]["id"] == current.id
    db.refresh(current)
    assert current.data == original
    submit(client, db, s)
    for _ in range(5):
        s = next_round(client, s["id"], mode)
        assert s["activity"]["source"]["answer_format"] == selected
        assert s["answer_formats"][mode] == [selected]
        submit(client, db, s)
    reloaded = client.get(f"/api/number-practice/{s['id']}").json()
    assert reloaded["answer_formats"][mode] == [selected]
    for other, formats in reloaded["answer_formats"].items():
        if other != mode:
            assert formats == ["words", "digits"]


def test_reenabling_both_formats_and_idempotent_updates_preserve_balanced_mix(client, db):
    s, _ = start(client)
    path = f"/api/number-practice/{s['id']}/formats"
    assert client.patch(path, json={"mode": "write", "formats": ["words"]}).status_code == 200
    submit(client, db, s)
    s = next_round(client, s["id"], "write")
    assert s["activity"]["source"]["answer_format"] == "words"
    submit(client, db, s)
    assert (
        client.patch(path, json={"mode": "write", "formats": ["digits", "words"]}).status_code
        == 200
    )
    seen = []
    for _ in range(2):
        s = next_round(client, s["id"], "write")
        seen.append(s["activity"]["source"]["answer_format"])
        submit(client, db, s)
        assert (
            client.patch(path, json={"mode": "write", "formats": ["words", "digits"]}).status_code
            == 200
        )
    assert set(seen) == {"words", "digits"}


@pytest.mark.parametrize("mode", ["write", "dictation"])
@pytest.mark.parametrize("fmt,correct,other", [("digits", "3", "trois"), ("words", "trois", "3")])
def test_feedback_distinguishes_correct_number_from_wrong_format(
    client, db, mode, fmt, correct, other
):
    s, _ = start(client, 3, 3)
    # For writing, the initial frozen question may already have a format.
    if mode == "write":
        submit(client, db, s)
    response = client.patch(
        f"/api/number-practice/{s['id']}/formats", json={"mode": mode, "formats": [fmt]}
    )
    assert response.status_code == 200
    s = next_round(client, s["id"], mode)
    before = deepcopy(db.get(Activity, s["activity"]["id"]).data)
    result, _ = submit(client, db, s, other)
    grade = result["result"]
    assert grade["score"] == 0 and grade["format_mismatch"] is True
    assert "Identificaste el número correcto" in grade["feedback"]
    assert ("pedía cifras" if fmt == "digits" else "pedía letras francesas") in grade["feedback"]
    assert f"se esperaba «{correct}»" in grade["feedback"]
    assert grade["accepted"] == [correct]
    assert db.get(Activity, s["activity"]["id"]).data == before
    s = next_round(client, s["id"], mode)
    correct_result, _ = submit(client, db, s, correct)
    assert correct_result["result"]["score"] == 100
    assert correct_result["result"]["format_mismatch"] is False
    s = next_round(client, s["id"], mode)
    wrong, _ = submit(client, db, s, "4" if fmt == "digits" else "quatre")
    assert wrong["result"]["score"] == 0
    assert wrong["result"]["format_mismatch"] is False
    assert "Respuesta esperada" in wrong["result"]["feedback"]
