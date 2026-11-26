import hashlib
import json
import os
import select
import subprocess
import threading

from .config import ROOT, config

_lock = threading.Lock()
_process = None
_log = None


def infer(payload):
    global _process, _log
    with _lock:
        if _process is None or _process.poll() is not None:
            _log = open(config.data_dir / "audio-worker.log", "a")
            _process = subprocess.Popen(
                [
                    str(ROOT / "local-model-tests/.venv/bin/python"),
                    str(ROOT / "scripts/audio_worker.py"),
                ],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=_log,
                text=True,
                bufsize=1,
                env={**os.environ, "PYTHONUNBUFFERED": "1"},
            )
        _process.stdin.write(json.dumps(payload, ensure_ascii=False) + "\n")
        _process.stdin.flush()
        ready, _, _ = select.select([_process.stdout], [], [], 240)
        if not ready:
            _process.kill()
            raise RuntimeError("El modelo de audio tardó demasiado; vuelve a intentarlo.")
        line = _process.stdout.readline()
        if not line:
            raise RuntimeError("El componente de audio se cerró. Consulta el registro de audio.")
        result = json.loads(line)
        if "error" in result:
            raise RuntimeError(result["error"])
        return result["result"]


def synthesize(text):
    key = hashlib.sha256(("kokoro:ff_siwis:1.0:" + text).encode()).hexdigest()
    folder = config.data_dir / "audio"
    folder.mkdir(exist_ok=True)
    path = folder / (key + ".wav")
    if not path.exists():
        temp = folder / (key + ".tmp.wav")
        infer({"role": "tts", "text": text, "output": str(temp)})
        temp.replace(path)
    return str(path.relative_to(config.data_dir))


def transcribe(path):
    normalized = path.with_suffix(".asr-v2.pcm.wav")
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-i",
            str(path),
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            str(normalized),
        ],
        check=True,
        capture_output=True,
        timeout=60,
    )
    result = infer({"role": "asr", "input": str(normalized)})
    return {
        **result,
        "normalized": str(normalized.relative_to(config.data_dir)),
        "original_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "normalized_sha256": hashlib.sha256(normalized.read_bytes()).hexdigest(),
    }
