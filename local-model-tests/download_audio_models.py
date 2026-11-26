"""Cache the two agreed public audio models and record exact revisions."""

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from huggingface_hub import snapshot_download


ROOT = Path(__file__).resolve().parent
MODELS = [
    {
        "role": "asr",
        "repo_id": "mlx-community/Qwen3-ASR-0.6B-8bit",
        "revision": "89e96d92ba34aca20b3e29fb10cc284097d1219f",
        "allow_patterns": ["*.json", "*.txt", "*.safetensors"],
    },
    {
        "role": "tts",
        "repo_id": "mlx-community/Kokoro-82M-bf16",
        "revision": "a71e4d38b236d968966a2002c4c895dbd12b1c3c",
        "allow_patterns": ["config.json", "kokoro-v1_0.safetensors", "voices/*.safetensors"],
    },
]


def download(spec):
    print("Downloading", spec["repo_id"], flush=True)
    path = snapshot_download(
        repo_id=spec["repo_id"],
        revision=spec["revision"],
        allow_patterns=spec["allow_patterns"],
        max_workers=4,
    )
    print("Downloaded", spec["repo_id"], flush=True)
    return {**spec, "path": path}


if __name__ == "__main__":
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(download, MODELS))
    (ROOT / "audio-models.json").write_text(json.dumps(results, indent=2) + "\n")
