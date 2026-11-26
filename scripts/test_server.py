"""An isolated, reproducible browser-test server. Refuses learner databases."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.db import Base, engine
from sqlalchemy import text

assert engine.url.database == "tuto_browser_test", "Se requiere la base aislada tuto_browser_test"
import os
import subprocess

root = Path(__file__).resolve().parents[1]
subprocess.run(
    [str(root / ".venv/bin/alembic"), "upgrade", "head"], cwd=root, env=os.environ, check=True
)
with engine.begin() as connection:
    connection.execute(
        text(
            "TRUNCATE "
            + ",".join('"' + t.name + '"' for t in Base.metadata.sorted_tables)
            + " CASCADE"
        )
    )
import uvicorn

uvicorn.run("app.main:app", host="127.0.0.1", port=8766)
