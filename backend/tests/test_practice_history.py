from copy import deepcopy
from uuid import uuid4

import pytest
from app.db import Activity, Attempt, StudySession
from sqlalchemy import func, select
from test_number_practice import next_round, start, submit
from test_topics_backup import make_proposal


def history(client, kind="continuous", **params):
    r = client.get("/api/practice-history", params={"kind": kind, **params})
    assert r.status_code == 200, r.text
    return r.json()


def test_continuous_types_are_saved_participation_not_rounds_or_range(client, db):
    s, _ = start(client, 1, 3)
    sid = s["id"]
    for _ in range(6):
        submit(client, db, s)
        s = next_round(client, sid, "write")
    # Opening another type does not count as practicing it.
    reading = next_round(client, sid, "read")
    before = deepcopy(db.get(Attempt, db.scalar(select(Attempt.id))).result)
    row = history(client)["items"][0]
    assert row["rounds"] == row["attempts"] == 6
    assert (row["types_practiced"], row["types_total"], row["types_percent"]) == (1, 5, 20)
    assert row["numbers_seen"] == 3 and row["range_percent"] == 100
    assert row["completion_percent"] is None
    assert [m["rounds"] for m in row["types"]] == [6, 0, 0, 0, 0]
    assert all(m["url"] == f"/numbers/{sid}?mode={m['id']}" for m in row["types"])
    assert row["accuracy"]["percent"] == 100
    assert row["last_activity"] and row["created"] and row["started"]
    assert history(client)["timezone"] == "America/Vancouver"
    assert db.get(Attempt, db.scalar(select(Attempt.id))).result == before
    submit(client, db, reading)
    row = history(client)["items"][0]
    assert row["types_practiced"] == 2 and row["types_percent"] == 40
    assert row["rounds"] == 7


def test_fixed_prepared_started_repeated_and_completed_without_duplicate_session(client, db):
    p = make_proposal(db, 1, 3)
    row = history(client, "fixed")["items"][0]
    assert row["status"] == "prepared" and row["proposal_id"] == p.id
    assert row["session_id"] is None and row["completion_percent"] == 0
    assert db.scalar(select(func.count()).select_from(StudySession)) == 0
    s = client.post(f"/api/proposals/{p.id}/start").json()
    row = history(client, "fixed")["items"][0]
    assert row["status"] == "not_started" and row["practice_url"] == f"/session/{s['id']}"
    for i, a in enumerate(s["activities"]):
        for _ in range(2 if i == 0 else 1):
            r = client.post(
                "/api/attempts",
                json={
                    "id": str(uuid4()),
                    "session_id": s["id"],
                    "activity_id": a["id"],
                    "response": db.get(Activity, a["id"]).data["accepted"][0],
                },
            )
            assert r.status_code == 200, r.text
        row = history(client, "fixed")["items"][0]
        assert row["completed_activities"] == i + 1
        assert row["completion_percent"] == round(100 * (i + 1) / len(s["activities"]))
    assert row["status"] == "completed" and row["attempts"] == len(s["activities"]) + 1
    assert client.post(f"/api/proposals/{p.id}/start").json()["id"] == s["id"]
    assert db.scalar(select(func.count()).select_from(StudySession)) == 1


def test_pages_creation_order_and_empty_list_are_read_only(client, db):
    assert history(client)["total"] == 0
    assert history(client, "fixed")["total"] == 0
    sessions = [start(client)[0] for _ in range(3)]
    page = history(client, limit=2)
    assert page["total"] == 3 and [r["session_id"] for r in page["items"]] == [
        sessions[2]["id"],
        sessions[1]["id"],
    ]
    assert history(client, offset=2, limit=2)["items"][0]["session_id"] == sessions[0]["id"]
    assert history(client, offset=5)["items"] == []
    assert db.scalar(select(func.count()).select_from(Attempt)) == 0
    assert db.scalar(select(func.count()).select_from(StudySession)) == 3


@pytest.mark.parametrize("query", ["kind=invalid", "offset=-1", "limit=0", "limit=51"])
def test_history_rejects_invalid_page(client, query):
    assert client.get("/api/practice-history?" + query).status_code == 422
