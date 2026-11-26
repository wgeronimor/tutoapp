"""Long-lived MLX worker. JSON lines only on stdout; package logs go to stderr."""

import json
import os
import sys
from pathlib import Path

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
ROOT = Path(__file__).resolve().parents[1]
MODELS = json.loads((ROOT / "config/audio-models.json").read_text())
sys.path.insert(0, str(ROOT / "backend"))
models = {}


def handle(data):
    import wave

    import numpy as np

    role = data["role"]
    from app.speech_signal import check

    info = next(x for x in MODELS if x["role"] == role)
    if role == "asr":
        quality = check(data["input"])
        provenance = {
            "model": info["repo_id"],
            "revision": info["revision"],
            "pipeline": "asr-v3-voiced-level",
            "reference_conditioning": False,
        }
        if quality["no_speech"] or quality["needs_retry"]:
            return {**quality, **provenance, "text": "", "alternatives": []}
    if role not in models:
        if role == "tts":
            from mlx_audio.tts.utils import load_model

            models[role] = load_model(info["path"], model_type="kokoro")
        else:
            from mlx_audio.stt import load

            models[role] = load(info["path"])
    if role == "tts":
        segments = list(
            models[role].generate(text=data["text"], voice="ff_siwis", lang_code="f", speed=1.0)
        )
        audio = np.concatenate([np.asarray(x.audio, dtype=np.float32) for x in segments])
        rate = int(segments[0].sample_rate)
        with wave.open(data["output"], "wb") as f:
            f.setnchannels(1)
            f.setsampwidth(2)
            f.setframerate(rate)
            f.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())
        return {
            "seconds": len(audio) / rate,
            "voice": "ff_siwis",
            "model": "Kokoro-82M-bf16",
            "sample_rate": rate,
        }
    primary = models[role].generate(
        data["input"],
        language="fr",
        temperature=0.0,
        condition_on_previous_text=False,
        verbose=None,
    )
    secondary_info = next(x for x in MODELS if x["role"] == "asr_secondary")
    if "asr_secondary" not in models:
        from mlx_audio.stt import load

        models["asr_secondary"] = load(secondary_info["path"])
    other = models["asr_secondary"].generate(
        data["input"], language="French", temperature=0.0, max_tokens=1024
    )
    import re
    import unicodedata

    def normalized(text):
        return " ".join(re.findall(r"\w+", unicodedata.normalize("NFC", text).lower()))

    first = primary.text.strip()
    second = other.text.strip()
    return {
        **quality,
        **provenance,
        "text": first,
        "agreement": "matched" if normalized(first) == normalized(second) else "different",
        "needs_review": normalized(first) != normalized(second),
        "alternatives": [
            {
                "text": second,
                "model": secondary_info["repo_id"],
                "revision": secondary_info["revision"],
                "pipeline": "asr-v3-secondary",
                "reference_conditioning": False,
                **quality,
            }
        ],
    }


for line in sys.stdin:
    try:
        data = json.loads(line)
        from contextlib import redirect_stdout

        with redirect_stdout(sys.stderr):
            result = handle(data)
        print(json.dumps({"result": result}, ensure_ascii=False), flush=True)
    except Exception as e:
        print(json.dumps({"error": str(e)}), flush=True)
