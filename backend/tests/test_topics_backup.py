import subprocess
import tarfile
from uuid import uuid4

from app.backup import export_archive
from app.config import ROOT, config
from app.db import Activity, Attempt, Media, Memory, Proposal, uid
from app.schemas import ProposalInput
from app.topics import build_topic
from sqlalchemy import func, select


def make_proposal(db, minimum=100, maximum=100, parent=None, instruction=""):
    pid = uid()
    r = ProposalInput(
        topic="Números",
        parent_id=parent,
        instruction=instruction,
        preferences={
            "minimum": minimum,
            "maximum": maximum,
            "minutes": 15,
            "modalities": ["writing"],
        },
    )
    data = build_topic(db, r, pid)
    p = Proposal(
        id=pid,
        parent_id=parent,
        topic=r.topic,
        instruction=r.instruction,
        preferences=data["preferences"],
        data=data,
    )
    db.add(p)
    db.commit()
    return p


def test_numeric_identity_100_across_ranges(client, db):
    for lo, hi in [(1, 100), (100, 500)]:
        # Force a one-element practice selected from either inclusive range.
        p = make_proposal(db)
        p.preferences = {**p.preferences, "minimum": lo, "maximum": hi}
        db.commit()
        s = client.post("/api/proposals/" + p.id + "/start").json()
        a = s["activities"][0]
        assert db.get(Activity, a["id"]).data["item"] == "fr:cardinal:100"
        r = client.post(
            "/api/attempts",
            json={
                "id": str(uuid4()),
                "session_id": s["id"],
                "activity_id": a["id"],
                "response": "cent",
            },
        )
        assert r.status_code == 200, r.text
    assert db.scalar(select(func.count()).select_from(Memory)) == 1
    assert db.scalar(select(Memory)).evidence["attempts"] == 2
    assert client.get("/api/progress").json()["numbers"] == 0


def test_ranges_and_normalized_forms(client, db):
    for n, response in [
        (21, "vingt-et-un"),
        (100, "100"),
        (200, "deux cents"),
        (280, "deux-cent-quatre-vingts"),
        (500, "cinq cents"),
    ]:
        p = make_proposal(db, n, n)
        s = client.post("/api/proposals/" + p.id + "/start").json()
        a = s["activities"][0]
        r = client.post(
            "/api/attempts",
            json={
                "id": str(uuid4()),
                "session_id": s["id"],
                "activity_id": a["id"],
                "response": response,
            },
        )
        assert r.json()["result"]["score"] == 100


def test_revision_keeps_preferences_and_past_attempts(client, db):
    p = make_proposal(db, 100, 105)
    s = client.post("/api/proposals/" + p.id + "/start").json()
    a = s["activities"][0]
    ref = db.get(Activity, a["id"]).data["accepted"][0]
    client.post(
        "/api/attempts",
        json={
            "id": str(uuid4()),
            "session_id": s["id"],
            "activity_id": a["id"],
            "response": ref,
        },
    )
    newer = make_proposal(db, 100, 105, parent=p.id, instruction="Solo escucha, solo 10 minutos")
    assert newer.preferences["minutes"] == 10 and newer.preferences["modalities"] == ["listening"]
    response = client.get("/api/proposals/" + newer.id).json()
    assert "accepted" not in str(response["activities"])
    original = client.get("/api/sessions/" + s["id"]).json()
    assert original["done"] == 1
    assert client.post("/api/proposals/" + p.id + "/start").json()["id"] == s["id"]


def test_saved_media_cannot_be_deleted_or_annotated(client, db):
    s = client.post("/api/days/1/start").json()
    a = next(x for x in s["activities"] if x["mode"] == "speak")
    path = config.data_dir / "recordings"
    path.mkdir(exist_ok=True)
    file = path / "sample.wav"
    file.write_bytes(b"fixture")
    m = Media(
        path="recordings/sample.wav",
        kind="recording",
        info={"text": "Bonjour !", "no_speech": False},
    )
    db.add(m)
    db.commit()
    r = client.post(
        "/api/attempts",
        json={
            "id": str(uuid4()),
            "session_id": s["id"],
            "activity_id": a["id"],
            "response": "Bonjour !",
            "media_id": m.id,
        },
    )
    assert r.status_code == 200
    assert (
        client.post(
            "/api/attempts/" + r.json()["id"] + "/notes",
            json={"text": "Commentaire", "origin": "Tutor"},
        ).status_code
        == 409
    )
    assert client.delete("/api/media/" + m.id).status_code == 409 and file.exists()
    assert client.get("/api/media/" + m.id).status_code == 200
    assert db.scalar(select(func.count()).select_from(Attempt)) == 1


def test_silence_rejected_before_attempt(client, db):
    s = client.post("/api/days/1/start").json()
    a = next(x for x in s["activities"] if x["mode"] == "speak")
    m = Media(
        path="silence.wav",
        kind="recording",
        info={"text": "", "no_speech": True, "voiced_frames": 0},
    )
    db.add(m)
    db.commit()
    r = client.post(
        "/api/attempts",
        json={
            "id": str(uuid4()),
            "session_id": s["id"],
            "activity_id": a["id"],
            "response": "",
            "media_id": m.id,
        },
    )
    assert r.status_code == 422
    assert db.scalar(select(func.count()).select_from(Attempt)) == 0


def test_export_and_actual_restore(client, db, tmp_path):
    s = client.post("/api/days/1/start").json()
    a = next(x for x in s["activities"] if x["mode"] == "exact")
    ref = db.get(Activity, a["id"]).data["accepted"][0]
    saved = client.post(
        "/api/attempts",
        json={
            "id": str(uuid4()),
            "session_id": s["id"],
            "activity_id": a["id"],
            "response": ref,
        },
    ).json()
    path = config.data_dir / "recordings"
    path.mkdir(exist_ok=True)
    (path / "export.wav").write_bytes(b"test-media")
    m = Media(path="recordings/export.wav", kind="recording", info={"text": "bonjour"})
    db.add(m)
    db.commit()
    backup = export_archive()
    with tarfile.open(backup) as tar:
        assert "database.dump" in tar.getnames() and "media/recordings/export.wav" in tar.getnames()
    # A unique temporary target, never the learning database.
    target = "tuto_restore_test_" + uuid4().hex[:8]
    out = tmp_path / "restored-media"
    try:
        subprocess.run(
            [
                str(ROOT / ".venv/bin/python"),
                "scripts/restore.py",
                str(backup),
                "--database",
                target,
                "--media",
                str(out),
            ],
            cwd=ROOT,
            check=True,
            capture_output=True,
        )
        import psycopg

        with psycopg.connect(f"host=127.0.0.1 user=postgres dbname={target}") as conn:
            count = conn.execute(
                "SELECT count(*) FROM attempts WHERE id=%s", (saved["id"],)
            ).fetchone()[0]
            assert count == 1
            assert conn.execute("SELECT count(*) FROM reviews").fetchone()[0] == 1
        assert (out / "recordings/export.wav").read_bytes() == b"test-media"

    finally:
        subprocess.run(["dropdb", "-w", "--if-exists", target], check=True, capture_output=True)


def test_class_pdf_page_mapping_and_validation(client):
    import pytest
    from app.class_preparation import source_material

    source = source_material({"unit": 4, "pages": "59–62", "announcement": "Itinéraires"})
    assert source["printed_pages"] == [59, 60, 61, 62] and source["pdf_pages"] == [
        1,
        2,
        3,
        4,
    ]
    assert len(source["excerpt"]) > 1000
    with pytest.raises(ValueError):
        source_material({"unit": 4, "pages": "1–4"})
    client.put("/api/classes", json={"date": "2026-11-24", "unit": 4, "pages": "17–20"})
    assert client.post("/api/classes/2026-11-24/tailor").status_code == 422


def test_tailored_class_preserves_sources_and_rejects_stale_agenda(client, db, monkeypatch):
    import app.class_preparation as prep
    import pytest
    from app.db import ClassPlan, StudySession

    client.put(
        "/api/classes",
        json={
            "date": "2026-11-24",
            "unit": 4,
            "pages": "59–62",
            "announcement": "Demander le chemin",
        },
    )
    c = db.get(ClassPlan, "2026-11-24")
    rev = prep.revision(c.data)

    def model(schema, system, payload):
        if schema is prep.ContentCheck:
            return schema(valid=True, issue="")
        assert payload["printed_pages"] == [59, 60, 61, 62] and payload["excerpt"]
        return schema(
            title="Demander son chemin",
            objective="Preguntar y seguir una dirección",
            scenario="Dans la rue",
            tip="Pide que repitan si es necesario.",
            phrases=[
                {
                    "french": f"Je cherche la rue numéro {n}.",
                    "spanish": f"Busco la calle número {n}.",
                    "variant": "Où est la gare ?",
                }
                for n in range(1, 6)
            ],
        )

    monkeypatch.setattr(prep, "ollama", model)
    result = prep.prepare(db, {"class_id": c.id, "revision": rev})
    db.commit()
    session = db.get(StudySession, result["session_id"])
    assert len(session.activity_ids) == 5
    assert db.get(Activity, session.activity_ids[0]).data["source"]["printed_pages"] == [
        59,
        60,
        61,
        62,
    ]
    old_session = session.id
    c.data = {**c.data, "pages": "63–64"}
    db.commit()
    with pytest.raises(ValueError):
        prep.prepare(db, {"class_id": c.id, "revision": rev})
    assert db.get(StudySession, old_session) is not None
