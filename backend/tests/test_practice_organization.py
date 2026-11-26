from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy

import pytest
from app.db import (
    Activity,
    Attempt,
    PracticeOrganization,
    Proposal,
    RemovedProposal,
    Session,
    StudySession,
)
from app.practice_organization import organize, remove_proposal
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError
from test_continuous_topics import begin, proposal
from test_number_practice import start, submit
from test_practice_history import history
from test_topics_backup import make_proposal


def change(client, id, action, status=200):
    response = client.patch(f"/api/practice-history/{id}", json={"action": action})
    assert response.status_code == status, response.text
    return response.json()


def test_pins_global_cap_order_and_pages_across_both_kinds(client, db):
    fixed = make_proposal(db)
    fixed_session = client.post(f"/api/proposals/{fixed.id}/start").json()
    sessions = [fixed_session] + [start(client)[0] for _ in range(10)]
    for s in sessions[:10]:
        change(client, s["id"], "pin")
    change(client, sessions[10]["id"], "pin", 409)
    change(client, sessions[0]["id"], "pin")  # idempotent
    page = history(client, limit=2)
    assert len(page["pins"]) == page["pin_limit"] == 10
    assert [p["session_id"] for p in page["pins"]] == [s["id"] for s in sessions[:10]]
    assert [r["session_id"] for r in page["items"]] == [s["id"] for s in sessions[1:3]]
    assert history(client, "fixed")["items"][0]["pin_order"] == 1
    change(client, sessions[1]["id"], "up")  # swaps with fixed pin from another menu
    assert history(client, "fixed")["items"][0]["pin_order"] == 2
    change(client, sessions[1]["id"], "down")
    change(client, sessions[0]["id"], "unpin")
    change(client, sessions[10]["id"], "pin")
    assert [p["position"] for p in history(client)["pins"]] == list(range(1, 11))
    assert history(client, offset=9)["items"][0]["session_id"] == sessions[10]["id"]
    assert db.scalar(select(func.count()).select_from(Attempt)) == 0


@pytest.mark.parametrize("kind", ["fixed", "continuous", "topic"])
def test_hide_restore_keeps_attempts_activities_stats_and_session(client, db, kind):
    if kind == "fixed":
        p = make_proposal(db)
        s = client.post(f"/api/proposals/{p.id}/start").json()
        a = s["activities"][0]
        client.post(
            "/api/attempts",
            json={
                "id": "immutable-history-attempt",
                "session_id": s["id"],
                "activity_id": a["id"],
                "response": db.get(Activity, a["id"]).data["accepted"][0],
            },
        )
    elif kind == "topic":
        s = begin(client, proposal(client, db))
    else:
        s, _ = start(client)
        submit(client, db, s)
    history_kind = "fixed" if kind == "fixed" else "continuous"
    session = db.get(StudySession, s["id"])
    original = (deepcopy(session.state), deepcopy(session.activity_ids), session.title)
    attempts = {
        a.id: (a.response, deepcopy(a.result), deepcopy(a.evidence))
        for a in db.scalars(select(Attempt))
    }
    old = history(client, history_kind)["items"][0]
    change(client, s["id"], "pin")
    change(client, s["id"], "hide")
    assert history(client, history_kind)["total"] == 0
    shown = history(client, history_kind, show_inactive=True)
    assert shown["total"] == 1 and shown["pins"] == []
    row = shown["items"][0]
    assert row["hidden"] and row["pin_order"] is None
    for key in ["attempts", "rounds", "seconds", "accuracy", "completion_percent", "types_percent"]:
        assert row[key] == old[key]
    change(client, s["id"], "pin", 409)
    change(client, s["id"], "show")
    row = history(client, history_kind)["items"][0]
    assert row["session_id"] == s["id"] and not row["hidden"] and row["pin_order"] is None
    db.refresh(session)
    assert (session.state, session.activity_ids, session.title) == original
    for a in db.scalars(select(Attempt)):
        assert (a.response, a.result, a.evidence) == attempts[a.id]


@pytest.mark.parametrize("continuous", [False, True])
def test_remove_only_prepared_proposal_and_cannot_reopen_regenerate_start(client, db, continuous):
    p = proposal(client, db) if continuous else {"id": make_proposal(db).id}
    id = p["id"]
    for action in ["pin", "hide", "show", "up"]:
        change(client, id, action, 404)
    assert client.delete("/api/proposals/" + id).status_code == 200
    assert client.delete("/api/proposals/" + id).status_code == 200
    assert (
        history(client, "continuous" if continuous else "fixed", show_inactive=True)["total"] == 0
    )
    assert client.get("/api/proposals/" + id).status_code == 404
    assert client.post("/api/proposals/" + id + "/start").status_code == 404
    assert (
        client.post(
            "/api/proposals/" + id + "/start-continuous",
            json={
                "entries": [
                    {"french": "un", "spanish": "uno"},
                    {"french": "deux", "spanish": "dos"},
                ],
                "modalities": ["writing"],
            },
        ).status_code
        == 404
    )
    assert (
        client.post("/api/proposals", json={"topic": "Meses", "parent_id": id}).status_code == 404
    )
    assert db.get(RemovedProposal, id)
    assert db.scalar(select(func.count()).select_from(StudySession)) == 0
    assert db.scalar(select(func.count()).select_from(PracticeOrganization)) == 0
    # DB guard also rejects bypassing the API to resurrect a removed draft.
    s, _ = start(client)
    with pytest.raises(DBAPIError), db.begin_nested():
        db.execute(
            text("UPDATE proposals SET session_id=:sid WHERE id=:id"), {"sid": s["id"], "id": id}
        )


def test_removal_preserves_descendants_and_started_practices_never_removable(client, db):
    ancestor = make_proposal(db)
    child = make_proposal(db, parent=ancestor.id)
    s = client.post(f"/api/proposals/{child.id}/start").json()
    assert client.delete("/api/proposals/" + ancestor.id).status_code == 200
    assert client.get("/api/proposals/" + child.id).json()["parent_id"] == ancestor.id
    assert client.get("/api/sessions/" + s["id"]).status_code == 200
    assert client.delete("/api/proposals/" + child.id).status_code == 409  # even zero attempts
    for statement in [
        "INSERT INTO removed_proposals (proposal_id,created) VALUES (:id,now())",
        "DELETE FROM proposals WHERE id=:id",
        "UPDATE proposals SET session_id=NULL WHERE id=:id",
    ]:
        with pytest.raises(DBAPIError), db.begin_nested():
            db.execute(text(statement), {"id": child.id})
    p = proposal(client, db)
    topic_session = begin(client, p)
    assert client.delete("/api/proposals/" + p["id"]).status_code == 409
    assert client.delete("/api/sessions/" + topic_session["id"]).status_code == 405
    assert client.delete("/api/number-practice/" + topic_session["id"]).status_code == 405


def test_concurrent_pin_limit_is_serialized(client, db):
    ids = [start(client)[0]["id"] for _ in range(12)]

    def pin(id):
        from fastapi import HTTPException

        with Session() as session:
            try:
                organize(session, id, "pin")
                return 200
            except HTTPException as exc:
                return exc.status_code

    with ThreadPoolExecutor(max_workers=6) as pool:
        statuses = list(pool.map(pin, ids))
    assert statuses.count(200) == 10 and statuses.count(409) == 2
    assert len(history(client)["pins"]) == 10


def test_remove_vs_start_locks_share_one_winner(client, db):
    p = make_proposal(db)
    # Explicit row lock reproduces another tab starting while removal is requested.
    with Session() as starter:
        locked = starter.scalar(select(Proposal).where(Proposal.id == p.id).with_for_update())
        s, _ = start(client)
        with ThreadPoolExecutor(max_workers=1) as pool:

            def remove():
                from fastapi import HTTPException

                with Session() as remover:
                    try:
                        remove_proposal(remover, p.id)
                    except HTTPException as exc:
                        return exc.status_code

            pending = pool.submit(remove)
            locked.session_id = s["id"]
            starter.commit()
            assert pending.result(timeout=10) == 409
    assert not db.get(RemovedProposal, p.id)


def test_organization_rejects_unknown_course_and_actions(client):
    change(client, "missing", "pin", 404)
    s = client.post("/api/days/1/start").json()
    change(client, s["id"], "pin", 404)
    change(client, s["id"], "invalid", 422)
