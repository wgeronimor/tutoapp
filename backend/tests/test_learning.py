import json
from datetime import timedelta
from uuid import uuid4

import pytest
from app.config import ROOT
from app.db import Activity, Attempt, Memory, Review, StudySession, now
from app.learning import number
from app.schemas import Exercise
from sqlalchemy import func, select


@pytest.mark.parametrize(
    "n,expected",
    [
        (1, "un"),
        (21, "vingt et un"),
        (70, "soixante-dix"),
        (71, "soixante et onze"),
        (80, "quatre-vingts"),
        (81, "quatre-vingt-un"),
        (90, "quatre-vingt-dix"),
        (91, "quatre-vingt-onze"),
        (100, "cent"),
        (101, "cent un"),
        (200, "deux cents"),
        (201, "deux cent un"),
        (280, "deux cent quatre-vingts"),
        (300, "trois cents"),
        (500, "cinq cents"),
    ],
)
def test_numbers(n, expected):
    assert number(n) == expected


def start(client, day=1):
    r = client.post(f"/api/days/{day}/start")
    assert r.status_code == 200, r.text
    return r.json()


def payload(s, a, response, id=None, **extra):
    return {
        "id": id or str(uuid4()),
        "session_id": s["id"],
        "activity_id": a["id"],
        "response": response,
        **extra,
    }


def phrase(client, db, day=1):
    s = start(client, day)
    a = next(a for a in s["activities"] if a["mode"] == "exact")
    ref = db.get(Activity, a["id"]).data["accepted"][0]
    return s, a, ref


def test_all_content_and_daily_budget():
    data = json.loads((ROOT / "content/course-v1.json").read_text())
    assert len(data["days"]) == 28
    for d in data["days"]:
        assert sum(a["minutes"] for a in d["activities"]) == 120
        assert {a["skill"] for a in d["activities"]} == {
            "reading",
            "listening",
            "writing",
            "speaking",
        }
        assert len([a for a in d["activities"] if ":phrase-" in a["key"]]) == 5
        for a in d["activities"]:
            Exercise.model_validate(a)
    exam = json.loads((ROOT / "content/assessments-v1.json").read_text())
    assert len(exam["weeks"]) == 4
    for w in exam["weeks"]:
        assert len([a for a in w["activities"] if a["mode"] == "choice"]) == 10
        for a in w["activities"]:
            Exercise.model_validate(a)


def test_idempotency_and_conflict(client, db):
    s, a, ref = phrase(client, db)
    p = payload(s, a, ref)
    first = client.post("/api/attempts", json=p)
    assert first.status_code == 200, first.text
    repeated = client.post("/api/attempts", json=p)
    assert repeated.json()["id"] == first.json()["id"]
    assert db.scalar(select(func.count()).select_from(Attempt)) == 1
    assert db.scalar(select(func.count()).select_from(Review)) == 1
    changed = client.post("/api/attempts", json={**p, "response": "autre réponse"})
    assert changed.status_code == 409


def test_attempt_survives_reopening_and_target_change(client, db):
    s, a, ref = phrase(client, db)
    r = client.post("/api/attempts", json=payload(s, a, ref))
    assert r.json()["result"]["target"] == 70
    cfg = client.get("/api/settings").json()
    cfg["target"] = 90
    assert client.put("/api/settings", json=cfg).status_code == 200
    again = start(client)
    assert again["id"] == s["id"]
    assert (
        next(x for x in again["activities"] if x["id"] == a["id"])["attempt"]["result"]["target"]
        == 70
    )
    new = client.post("/api/attempts", json=payload(s, a, ref)).json()
    assert new["result"]["target"] == 90


def test_error_schedules_review_and_priorities(client, db):
    s, a, _ = phrase(client, db)
    r = client.post("/api/attempts", json=payload(s, a, "Je suis perdu."))
    assert r.status_code == 200
    mem = db.scalar(select(Memory))
    assert mem.evidence["errors"] == 1 and mem.due > now()
    assert client.get("/api/progress").json()["priorities"][0]["attempt_id"] == r.json()["id"]
    mem.due = now() - timedelta(seconds=1)
    db.commit()
    review = client.post("/api/reviews/start").json()
    assert db.get(Activity, a["id"]).data["item"] in [x["item"] for x in review["activities"]]
    assert sum(x["minutes"] for x in review["activities"]) <= 30
    assert review["source"] == "review"


def test_aids_and_retention_need_delayed_recovery(client, db):
    s, a, ref = phrase(client, db)
    client.post("/api/attempts", json=payload(s, a, ref, hint=True, plays=2))
    m = db.scalar(select(Memory))
    assert m.evidence["autonomous"] == 0
    client.post("/api/attempts", json=payload(s, a, ref))
    db.expire_all()
    m = db.scalar(select(Memory))
    assert not m.evidence["learned"]
    # Two immediate successes do not manufacture retention.
    client.post("/api/attempts", json=payload(s, a, ref))
    db.expire_all()
    m = db.scalar(select(Memory))
    assert len(m.evidence["success_dates"]) == 1
    m.evidence = {
        **m.evidence,
        "success_dates": [(now() - timedelta(days=2)).isoformat()],
    }
    db.commit()
    client.post("/api/attempts", json=payload(s, a, ref))
    db.expire_all()
    assert db.scalar(select(Memory)).evidence["learned"]


def test_immutable_activity_versions(client, db):
    s, a, ref = phrase(client, db)
    client.post("/api/attempts", json=payload(s, a, ref))
    old = db.get(Activity, a["id"])
    new = Activity(
        key=old.key,
        version="zz-test-new",
        data={**old.data, "accepted": ["Nouvelle phrase."]},
    )
    db.add(new)
    db.commit()
    resumed = client.get("/api/sessions/" + s["id"]).json()
    assert a["id"] in [x["id"] for x in resumed["activities"]]
    assert db.get(Activity, a["id"]).data["accepted"] == [ref]


def test_ten_question_score_targets(client, db):
    for target, correct, passed in [(70, 7, True), (90, 7, False), (90, 9, True)]:
        cfg = client.get("/api/settings").json()
        cfg["target"] = target
        client.put("/api/settings", json=cfg)
        s = client.post("/api/evaluations/1/start").json()
        acts = [x for x in s["activities"] if x["mode"] == "choice"]
        for i, a in enumerate(acts):
            data = db.get(Activity, a["id"]).data
            answer = (
                data["accepted"][0]
                if i < correct
                else next(x for x in data["options"] if x not in data["accepted"])
            )
            r = client.post("/api/attempts", json=payload(s, a, answer))
            assert r.status_code == 200, r.text
        r = client.get("/api/sessions/" + s["id"]).json()["assessment"]
        assert r["correct"] == correct and r["passed"] == passed and r["target"] == target
    db.expire_all()
    saved = db.get(StudySession, s["id"]).state["summaries"]
    assert any(x["target"] == 70 and x["percent"] == 70 for x in saved)


def test_invalid_and_foreign_requests(client, db):
    s, a, ref = phrase(client, db)
    other = start(client, 2)
    assert client.post("/api/attempts", json=payload(other, a, ref)).status_code == 422
    assert client.post("/api/attempts", json=payload(s, a, "")).status_code == 422
    assert (
        client.put(
            "/api/settings", json={**client.get("/api/settings").json(), "target": 99}
        ).status_code
        == 422
    )
    assert client.post("/api/days/29/start").status_code == 422
    assert (
        client.post("/api/days/1/start", headers={"Origin": "https://evil.example"}).status_code
        == 403
    )
    assert client.get("/api/health", headers={"Host": "evil.example"}).status_code == 400


def test_class_change_keeps_course_and_separate_states(client, db):
    s, a, ref = phrase(client, db)
    client.post("/api/attempts", json=payload(s, a, ref))
    c = {
        "date": "2026-11-23",
        "unit": 1,
        "pages": "17–20",
        "agenda": "Confirmada",
        "preparation": "Pendiente",
    }
    assert client.put("/api/classes", json=c).status_code == 200
    prep = client.post("/api/classes/2026-11-23/prepare").json()
    c["unit"] = 4
    c["pages"] = "59–61"
    client.put("/api/classes", json=c)
    changed = client.post("/api/classes/2026-11-23/prepare").json()
    assert changed["id"] != prep["id"]
    assert client.get("/api/sessions/" + s["id"]).json()["done"] == 1
    classes = client.get("/api/classes").json()
    assert classes[0]["agenda"] == "Confirmada" and classes[0]["preparation"] == "Pendiente"
    assert client.get("/api/pdfs/4").status_code == 200


def test_missing_days_redistribute_budget(client):
    cfg = client.get("/api/settings").json()
    cfg["start_date"] = "2026-01-01"
    client.put("/api/settings", json=cfg)
    result = client.get("/api/today").json()
    assert result["suggested_day"] == 1 and result["missed"]
    assert result["review_minutes"] + result["new_minutes"] == cfg["daily_minutes"]


def test_calendar_matches_real_weekdays_and_reduces_new_load(client, db):
    cfg = client.get("/api/settings").json()
    cfg["start_date"] = "2026-11-20"
    client.put("/api/settings", json=cfg)
    s = start(client, 1)
    assert not s["state"]["class_day"] and len(s["activities"]) == 10
    assert sum(a["minutes"] for a in s["activities"]) == 120
    assert client.get("/api/course").json()["days"][0]["total"] == 10
    # The following Monday receives the preview/review blocks even though it is relative day 4.
    monday = start(client, 4)
    assert monday["state"]["class_day"]
    assert [a["block"] for a in monday["activities"][:2]] == [
        "Antes de clase",
        "Después de clase",
    ]
    a = next(x for x in s["activities"] if x["mode"] == "exact")
    client.post("/api/attempts", json=payload(s, a, "incorrect"))
    mem = db.scalar(select(Memory))
    mem.due = now() - timedelta(seconds=1)
    db.commit()
    nxt = start(client, 2)
    assert sum(a["minutes"] for a in nxt["activities"]) == 117
