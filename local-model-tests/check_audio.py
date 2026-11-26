"""Generate French fixtures locally and test local speech recognition."""

import argparse
import gc
import json
import re
import time
import unicodedata
import wave
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "audio"
SENTENCES = [
    ("presentation", "Bonjour, je m'appelle Ana. J'habite au Canada et j'apprends le français."),
    ("directions", "Tournez à gauche, puis continuez tout droit. La gare est à droite."),
    ("nasal_vowels", "Un bon vin blanc et du pain, s'il vous plaît."),
    ("appointment", "Mon rendez-vous est mardi à quinze heures trente."),
    ("past", "Hier, je suis allée au marché. J'ai acheté des pommes et du fromage."),
    ("ungrammatical", "Je suis trente ans. J'habite à Canada."),
]


def model_location(role):
    models = json.loads((ROOT / "audio-models.json").read_text())
    return next(item["path"] for item in models if item["role"] == role)


def words(text):
    text = unicodedata.normalize("NFC", text).lower().replace("’", "'")
    return re.findall(r"\w+", text)


def edit_distance(reference, actual):
    row = list(range(len(actual) + 1))
    for index, token in enumerate(reference, 1):
        new = [index]
        for other_index, other_token in enumerate(actual, 1):
            new.append(min(new[-1] + 1, row[other_index] + 1,
                           row[other_index - 1] + (token != other_token)))
        row = new
    return row[-1]


def write_wav(path, audio, sample_rate):
    pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(pcm.tobytes())


def voiced_frames(path):
    import webrtcvad
    from scipy.signal import resample_poly

    with wave.open(str(path), "rb") as source:
        if source.getsampwidth() != 2 or source.getnchannels() != 1:
            raise ValueError("The test fixtures must be mono PCM16 WAV files")
        sample_rate = source.getframerate()
        audio = np.frombuffer(source.readframes(source.getnframes()), dtype="<i2").astype(np.float32)
    if sample_rate != 16000:
        from math import gcd

        factor = gcd(sample_rate, 16000)
        audio = resample_poly(audio, 16000 // factor, sample_rate // factor)
    pcm = np.clip(audio, -32768, 32767).astype("<i2").tobytes()
    frame_bytes = 480 * 2  # Thirty milliseconds of PCM16 at 16 kHz.
    detector = webrtcvad.Vad(2)
    return sum(
        detector.is_speech(pcm[offset:offset + frame_bytes], 16000)
        for offset in range(0, len(pcm) - frame_bytes + 1, frame_bytes)
    )


def synthesize():
    from mlx_audio.tts.utils import load_model

    OUTPUT.mkdir(exist_ok=True)
    started = time.perf_counter()
    model = load_model(model_location("tts"), model_type="kokoro")
    print(f"Kokoro loaded in {time.perf_counter() - started:.2f}s", flush=True)
    results = []
    for name, text in SENTENCES:
        started = time.perf_counter()
        segments = list(model.generate(text=text, voice="ff_siwis", lang_code="f", speed=1.0))
        audio = np.concatenate([np.asarray(segment.audio, dtype=np.float32) for segment in segments])
        sample_rate = int(segments[0].sample_rate)
        path = OUTPUT / f"{name}.wav"
        write_wav(path, audio, sample_rate)
        item = {
            "case": name,
            "text": text,
            "file": str(path),
            "duration_seconds": round(len(audio) / sample_rate, 3),
            "generation_seconds": round(time.perf_counter() - started, 3),
            "sample_rate": sample_rate,
            "peak": float(np.max(np.abs(audio))),
        }
        results.append(item)
        (ROOT / "tts-results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps(item, ensure_ascii=False), flush=True)
    write_wav(OUTPUT / "silence.wav", np.zeros(3 * 24000, dtype=np.float32), 24000)
    del model
    gc.collect()


def transcribe():
    from mlx_audio.stt import load

    started = time.perf_counter()
    model = load(model_location("asr"))
    print(f"ASR loaded in {time.perf_counter() - started:.2f}s", flush=True)
    results = []
    canadian = json.loads((ROOT / "canadian-reference.json").read_text())
    fixtures = SENTENCES + [("canadian", canadian["text"]), ("silence", "")]
    for name, text in fixtures:
        path = OUTPUT / f"{name}.wav"
        started = time.perf_counter()
        voice_count = voiced_frames(path)
        if voice_count >= 3:
            result = model.generate(str(path), language="French")
            actual = result.text.strip()
        else:
            actual = ""
        reference_tokens = words(text)
        actual_tokens = words(actual)
        distance = edit_distance(reference_tokens, actual_tokens)
        item = {
            "case": name,
            "reference": text,
            "transcription": actual,
            "seconds": round(time.perf_counter() - started, 3),
            "word_errors": distance,
            "reference_words": len(reference_tokens),
            "wer": round(distance / len(reference_tokens), 4) if reference_tokens else None,
            "silence_passed": not actual if name == "silence" else None,
            "input_kind": "synthetic_french" if text else "digital_silence",
            "voiced_frames": voice_count,
            "skipped_no_speech": voice_count < 3,
        }
        results.append(item)
        (ROOT / "asr-results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps(item, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", choices=["tts", "asr"])
    args = parser.parse_args()
    if args.stage == "tts":
        synthesize()
    else:
        transcribe()
