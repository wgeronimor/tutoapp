"""Measurements of PCM audio; these are recording checks, never pronunciation grades."""

import array
import math
import wave


def measurements(path):
    with wave.open(str(path), "rb") as source:
        if (
            source.getnchannels() != 1
            or source.getsampwidth() != 2
            or source.getframerate() != 16000
        ):
            raise ValueError("Se requiere PCM16 mono a 16 kHz")
        raw = source.readframes(source.getnframes())
    samples = array.array("h", raw)
    peak = max((abs(x) for x in samples), default=0) / 32768
    rms = math.sqrt(sum(x * x for x in samples) / max(1, len(samples))) / 32768
    return {
        "duration_seconds": round(len(samples) / 16000, 3),
        "peak_dbfs": round(20 * math.log10(max(peak, 1e-9)), 2),
        "rms_dbfs": round(20 * math.log10(max(rms, 1e-9)), 2),
        "clipped_fraction": sum(abs(x) >= 32760 for x in samples) / max(1, len(samples)),
    }, raw


def check(path):
    import webrtcvad

    metrics, pcm = measurements(path)
    detector = webrtcvad.Vad(2)
    frame = 960
    voiced = [
        pcm[i : i + frame]
        for i in range(0, len(pcm) - frame + 1, frame)
        if detector.is_speech(pcm[i : i + frame], 16000)
    ]
    count = len(voiced)
    samples = array.array("h", b"".join(voiced))
    rms = math.sqrt(sum(x * x for x in samples) / max(1, len(samples))) / 32768
    voiced_dbfs = round(20 * math.log10(max(rms, 1e-9)), 2) if count else None
    # Pauses must not turn an otherwise usable short word into "low signal".
    retry = count >= 3 and voiced_dbfs < -40
    return {
        **metrics,
        "voiced_frames": count,
        "voiced_seconds": round(count * 0.03, 3),
        "voiced_rms_dbfs": voiced_dbfs,
        "no_speech": count < 3,
        "needs_retry": retry,
        "quality_reason": "No se generó una transcripción: el volumen en los tramos de voz es demasiado bajo. Acerca el micrófono y vuelve a grabar."
        if retry
        else "No se detectó suficiente voz; vuelve a grabar."
        if count < 3
        else "",
    }
