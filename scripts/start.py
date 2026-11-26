"""Start or open the local app without changing learner data."""

import os
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)
URL = "http://127.0.0.1:8765"
try:
    with urllib.request.urlopen(URL + "/api/health", timeout=2) as response:
        if "version" in response.read().decode():
            webbrowser.open(URL)
            sys.exit(0)
except Exception:
    pass
python = ROOT / ".venv/bin/python"
if not python.exists():
    sys.exit("Falta preparar el entorno. Consulta README.md.")
subprocess.run([str(ROOT / ".venv/bin/alembic"), "upgrade", "head"], check=True)
if not (ROOT / "frontend/dist/index.html").exists():
    subprocess.run(["pnpm", "--dir", "frontend", "build"], check=True)
folder = ROOT / ".runtime"
folder.mkdir(exist_ok=True)
with (folder / "server.log").open("a") as log:
    proc = subprocess.Popen(
        [
            str(python),
            "-m",
            "uvicorn",
            "app.main:app",
            "--app-dir",
            "backend",
            "--host",
            "127.0.0.1",
            "--port",
            "8765",
        ],
        stdout=log,
        stderr=log,
        start_new_session=True,
    )
(folder / "server.pid").write_text(str(proc.pid))
for _ in range(60):
    try:
        with urllib.request.urlopen(URL + "/api/health", timeout=2):
            pass
        webbrowser.open(URL)
        print("Tuto está disponible en " + URL)
        break
    except Exception:
        time.sleep(0.5)
else:
    sys.exit("No se pudo iniciar. Consulta .runtime/server.log y comprueba PostgreSQL.")
