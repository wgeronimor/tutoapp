import os
import subprocess
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
os.environ["DATABASE_URL"] = "postgresql+psycopg://postgres@127.0.0.1:5432/tuto_test"
os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="tuto-tests-")
subprocess.run(
    [str(ROOT / ".venv/bin/alembic"), "upgrade", "head"],
    cwd=ROOT,
    check=True,
    env=os.environ,
)
from app.db import Base, Session, engine
from app.learning import import_course
from app.main import app
from fastapi.testclient import TestClient
from sqlalchemy import text


@pytest.fixture
def db():
    assert engine.url.database == "tuto_test"
    with engine.begin() as conn:
        conn.execute(
            text(
                "TRUNCATE "
                + ",".join('"' + t.name + '"' for t in Base.metadata.sorted_tables)
                + " CASCADE"
            )
        )
    with Session() as s:
        import_course(s)
        yield s


@pytest.fixture
def client(db):
    # No lifespan worker: jobs are exercised explicitly to keep fixtures deterministic.
    with TestClient(app, raise_server_exceptions=True) as c:
        from app.jobs import stop

        stop.set()
        yield c
