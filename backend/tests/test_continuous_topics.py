from copy import deepcopy

import pytest
from app import continuous_topics as topics
from app.db import Activity, Attempt, Media, Proposal, StudySession, uid
from app.jobs import run_job
from app.schemas import ContentCheck
from sqlalchemy import func, select


def proposal(client, db, topic="Días de la semana", modalities=None):
    response = client.post(
        "/api/proposals",
        json={
            "topic": topic,
            "continuous": True,
            "entry_count": 4,
            "preferences": {
                "modalities": modalities or ["writing", "speaking", "reading", "listening"]
            },
        },
    )
    assert response.status_code == 200, response.text
    job_id = response.json()["job_id"]
    run_job(job_id)
    job = client.get("/api/jobs/" + job_id).json()
    assert job["status"] == "completed", job
    return client.get("/api/proposals/" + job["result"]["proposal_id"]).json()


def begin(client, p, entries=None):
    r = client.post(
        "/api/proposals/" + p["id"] + "/start-continuous",
        json={"entries": entries or p["entries"], "modalities": p["preferences"]["modalities"]},
    )
    assert r.status_code == 200, r.text
    return r.json()


def save(client, db, s):
    a = db.get(Activity, s["activity"]["id"]).data
    body = {
        "id": uid(),
        "session_id": s["id"],
        "activity_id": s["activity"]["id"],
        "response": a["reference"] if a["mode"] == "speak" else a["accepted"][0],
    }
    if a["mode"] == "speak":
        m = Media(
            kind="recording",
            path=uid() + ".webm",
            info={"text": a["reference"], "no_speech": False},
        )
        db.add(m)
        db.commit()
        body.update(media_id=m.id, number_recognition_check=True)
    r = client.post("/api/attempts", json=body)
    assert r.status_code == 200, r.text
    return r.json(), body


@pytest.mark.parametrize(
    "topic,size",
    [("Meses del año", 12), ("Días de la semana", 7), ("Meses y días de la semana", 19)],
)
def test_full_catalogs_prepared_history_and_frozen_start(client, db, topic, size):
    p = proposal(client, db, topic)
    assert len(p["entries"]) == size
    hist = client.get("/api/practice-history?kind=continuous").json()
    assert hist["total"] == 1
    assert hist["items"][0]["status"] == "prepared" and hist["items"][0]["proposal_id"] == p["id"]
    assert client.get("/api/practice-history?kind=fixed").json()["total"] == 0
    assert db.scalar(select(func.count()).select_from(StudySession)) == 0
    edited = deepcopy(p["entries"])
    edited[0]["spanish"] = "significado revisado"
    s = begin(client, p, edited)
    assert s["topic"] is True and s["maximum"] == size and len(s["modes"]) == 5
    assert begin(client, p, edited)["id"] == s["id"]
    assert client.post("/api/proposals/" + p["id"] + "/start").status_code == 422
    assert (
        client.post(
            "/api/proposals/" + p["id"] + "/start-continuous",
            json={"entries": p["entries"], "modalities": p["preferences"]["modalities"]},
        ).status_code
        == 422
    )
    q = client.get("/api/proposals/" + p["id"]).json()
    assert q["entries"] == p["entries"] and q["session_entries"] == edited
    assert client.get(f"/api/number-practice/{s['id']}").status_code == 200
    assert (
        client.patch(
            f"/api/number-practice/{s['id']}/formats", json={"mode": "write", "formats": ["digits"]}
        ).status_code
        == 404
    )


def test_each_type_covers_complete_catalog_before_repeat_and_preserves_attempts(client, db):
    p = proposal(client, db)
    s = begin(client, p)
    sid = s["id"]
    saved_snapshots = {}
    for mode in ["write", "read", "listen", "dictation", "speak"]:
        values = []
        for _ in range(15):
            r = client.post(f"/api/number-practice/{sid}/next", json={"mode": mode})
            assert r.status_code == 200, r.text
            s = r.json()
            a = db.get(Activity, s["activity"]["id"])
            values.append(a.data["reference"])
            saved, body = save(client, db, s)
            assert saved["result"]["score"] == 100
            assert client.post("/api/attempts", json=body).json()["id"] == saved["id"]
            assert client.post("/api/attempts", json={**body, "id": uid()}).status_code == 409
            saved_snapshots[saved["id"]] = deepcopy(db.get(Attempt, saved["id"]).result)
        assert len(set(values[:7])) == len(set(values[7:14])) == 7
        assert all(a != b for a, b in zip(values, values[1:]))
    snap = client.get(f"/api/number-practice/{sid}").json()
    assert snap["accuracy"]["attempts"] == 75 and snap["accuracy"]["percent"] == 100
    hist = client.get("/api/practice-history?kind=continuous").json()["items"][0]
    assert (
        hist["types_practiced"] == 5
        and hist["types_percent"] == 100
        and hist["coverage_label"] == "expresiones"
        and hist["range_percent"] == 100
    )
    assert all(db.get(Attempt, k).result == v for k, v in saved_snapshots.items())


def test_selected_skills_resumption_and_duplicate_catalog_are_validated(client, db):
    p = proposal(client, db, modalities=["listening", "reading"])
    duplicate = [p["entries"][0], p["entries"][0]]
    assert (
        client.post(
            "/api/proposals/" + p["id"] + "/start-continuous",
            json={"entries": duplicate, "modalities": ["reading"]},
        ).status_code
        == 422
    )
    assert db.scalar(select(func.count()).select_from(StudySession)) == 0
    s = begin(client, p)
    assert {m["id"] for m in s["modes"]} == {"read", "listen", "dictation"}
    assert (
        client.post(f"/api/number-practice/{s['id']}/next", json={"mode": "write"}).status_code
        == 404
    )
    old = s["activity"]["id"]
    assert (
        client.post(f"/api/number-practice/{s['id']}/next", json={"mode": s["mode"]}).json()[
            "activity"
        ]["id"]
        == old
    )
    assert (
        client.get("/api/practice-history?kind=continuous").json()["items"][0]["types_total"] == 3
    )


def test_arbitrary_topic_generated_and_independently_checked(client, db, monkeypatch):
    calls = []

    def fake(schema, system, payload):
        calls.append(schema)
        if schema is topics.Catalog:
            return topics.Catalog(
                title="Transportes",
                objective="Practicar transportes",
                tip="Usa los artículos.",
                entries=[
                    {"french": "le train", "spanish": "el tren"},
                    {"french": "le métro", "spanish": "el metro"},
                ],
            )
        return ContentCheck(valid=True, issue="")

    monkeypatch.setattr(topics, "ollama", fake)
    p = proposal(client, db, "Transportes urbanos")
    assert len(p["entries"]) == 2
    assert calls == [topics.Catalog, ContentCheck]
    s = begin(client, p)
    saved, _ = save(client, db, s)
    assert saved["result"]["score"] == 100


def test_speaking_preview_for_expression_is_unsaved_and_preserves_generated_text(client, db):
    p = proposal(client, db)
    s = begin(client, p)
    s = client.post(f"/api/number-practice/{s['id']}/next", json={"mode": "speak"}).json()
    a = db.get(Activity, s["activity"]["id"])
    m = Media(
        kind="recording", path="mardi.webm", info={"text": a.data["reference"], "no_speech": False}
    )
    db.add(m)
    db.commit()
    prev = client.post(
        f"/api/number-practice/{s['id']}/speech-preview",
        json={"activity_id": a.id, "media_id": m.id},
    )
    assert prev.status_code == 200, prev.text
    assert prev.json()["result"]["score"] == 100
    assert db.scalar(select(func.count()).select_from(Attempt)) == 0


def test_failed_review_is_corrected_once_without_silently_accepting_invalid_content(
    client, db, monkeypatch
):
    checks = 0

    def fake(schema, system, payload):
        nonlocal checks
        if schema is topics.Catalog:
            if checks:
                assert "review_issue" in payload and "previous_catalog" in payload
            return topics.Catalog(
                title="Cortesía",
                objective="Saludos",
                tip="Práctica",
                entries=[
                    {"french": "bonjour", "spanish": "hola"},
                    {"french": "au revoir", "spanish": "adiós"},
                ],
            )
        checks += 1
        return ContentCheck(
            valid=checks == 2, issue="Corregir una traducción" if checks == 1 else ""
        )

    monkeypatch.setattr(topics, "ollama", fake)
    p = proposal(client, db, "Cortesía")
    assert p["entries"][0]["french"] == "bonjour" and checks == 2


def test_invalid_content_never_becomes_a_saved_proposal(client, db, monkeypatch):
    def fake(schema, system, payload):
        if schema is topics.Catalog:
            return topics.Catalog(
                title="Saludos",
                objective="Revisión",
                tip="Práctica",
                entries=[
                    {"french": "bonjour", "spanish": "hola"},
                    {"french": "au revoir", "spanish": "adiós"},
                ],
            )
        return ContentCheck(valid=False, issue="Corregir contenido antes de usarlo")

    monkeypatch.setattr(topics, "ollama", fake)
    job = client.post(
        "/api/proposals", json={"topic": "Tema personalizado", "continuous": True}
    ).json()
    run_job(job["job_id"])
    value = client.get("/api/jobs/" + job["job_id"]).json()
    assert value["status"] == "failed" and "Corregir contenido" in value["error"]
    assert db.scalar(select(func.count()).select_from(Proposal)) == 0
    assert db.scalar(select(func.count()).select_from(StudySession)) == 0
    assert db.scalar(select(func.count()).select_from(Attempt)) == 0
