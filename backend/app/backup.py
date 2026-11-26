import json
import os
import subprocess
import tarfile
import tempfile
import threading
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.engine import make_url

from .config import ROOT, config
from .db import engine

export_lock = threading.Lock()


def export_archive():
    folder = config.data_dir / "exports"
    folder.mkdir(exist_ok=True)
    from .db import uid

    output = folder / (uid() + ".tar.gz")
    url = make_url(config.database_url)
    with (
        export_lock,
        tempfile.TemporaryDirectory() as tmp,
        engine.connect().execution_options(isolation_level="REPEATABLE READ") as conn,
    ):
        with conn.begin():
            snapshot = conn.scalar(text("SELECT pg_export_snapshot()"))
            dump = Path(tmp) / "database.dump"
            subprocess.run(
                [
                    "pg_dump",
                    "-h",
                    url.host or "127.0.0.1",
                    "-p",
                    str(url.port or 5432),
                    "-U",
                    url.username,
                    "-d",
                    url.database,
                    "-Fc",
                    "--snapshot",
                    snapshot,
                    "-f",
                    str(dump),
                ],
                check=True,
                capture_output=True,
                env={**os.environ, "PGPASSWORD": url.password or ""},
            )
            media = list(conn.execute(text("SELECT path, info FROM media")).all())
            with tarfile.open(output, "w:gz") as archive:
                archive.add(dump, arcname="database.dump")
                for path, info in media:
                    if info.get("deleted"):
                        continue
                    related = {
                        path,
                        info.get("normalized"),
                        *(r.get("normalized") for r in info.get("transcription_runs", [])),
                    }
                    for relative in related:
                        if relative:
                            source = (config.data_dir / relative).resolve()
                            if config.data_dir.resolve() not in source.parents:
                                raise ValueError("Ruta de media inválida")
                            if not source.is_file():
                                raise ValueError("Falta un archivo asociado: " + relative)
                            archive.add(source, arcname="media/" + relative)
                manifest = Path(tmp) / "manifest.json"
                manifest.write_text(
                    json.dumps(
                        {
                            "format": 1,
                            "version": json.loads((ROOT / "package.json").read_text())["version"],
                            "database": url.database,
                            "postgres_snapshot": snapshot,
                            "restore": "python scripts/restore.py ARCHIVO --database NUEVA_BASE --media NUEVA_CARPETA",
                        },
                        ensure_ascii=False,
                    )
                )
                archive.add(manifest, arcname="manifest.json")
    return output
