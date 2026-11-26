"""Restore an export to a NEW database and NEW media folder; never overwrite a course."""

import argparse
import json
import os
import subprocess
import tarfile
import tempfile
from pathlib import Path

parser = argparse.ArgumentParser(description="Recuperar Tuto en una base y carpeta nuevas")
parser.add_argument("archive", type=Path)
parser.add_argument("--database", required=True)
parser.add_argument("--media", type=Path, required=True)
args = parser.parse_args()
if not args.database.replace("_", "").isalnum():
    parser.error("Nombre de base no válido")
if args.media.exists():
    parser.error("La carpeta de destino ya existe; elige una nueva")
with tempfile.TemporaryDirectory() as tmp:
    with tarfile.open(args.archive) as source:
        source.extractall(tmp, filter="data")
    manifest = json.loads((Path(tmp) / "manifest.json").read_text())
    if manifest["format"] != 1:
        raise ValueError("Formato no compatible")
    subprocess.run(["createdb", "-w", "-O", "postgres", args.database], check=True)
    subprocess.run(
        [
            "pg_restore",
            "-h",
            "127.0.0.1",
            "-U",
            "postgres",
            "-d",
            args.database,
            "--exit-on-error",
            str(Path(tmp) / "database.dump"),
        ],
        check=True,
        env={**os.environ, "PGPASSWORD": ""},
    )
    import shutil

    media = Path(tmp) / "media"
    if media.exists():
        shutil.copytree(media, args.media)
    else:
        args.media.mkdir(parents=True)
print(
    "Recuperación completada. Configura DATABASE_URL y DATA_DIR con los destinos nuevos antes de iniciar."
)
