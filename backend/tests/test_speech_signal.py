import array
import math
import wave

from app.speech_signal import check


def wav(tmp_path, name, speech_amplitude, silence_frames):
    path = tmp_path / name
    # Fixed signal and deterministic voice segmentation isolate the level calculation.
    voiced = [int(speech_amplitude * math.sin(2 * math.pi * 220 * i / 16000)) for i in range(4800)]
    samples = [0] * (480 * silence_frames) + voiced + [0] * (480 * silence_frames)
    with wave.open(str(path), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(16000)
        f.writeframes(array.array("h", samples).tobytes())
    return path


def fake_vad(monkeypatch):
    import sys
    from types import SimpleNamespace

    class Detector:
        def __init__(self, mode):
            pass

        def is_speech(self, pcm, rate):
            return any(array.array("h", pcm))

    monkeypatch.setitem(sys.modules, "webrtcvad", SimpleNamespace(Vad=Detector))


def test_pauses_do_not_reject_a_usable_short_word(tmp_path, monkeypatch):
    fake_vad(monkeypatch)
    compact = check(wav(tmp_path, "word.wav", 1000, 5))
    padded = check(wav(tmp_path, "padded.wav", 1000, 150))
    assert padded["rms_dbfs"] < -40
    assert compact["voiced_rms_dbfs"] == padded["voiced_rms_dbfs"]
    assert padded["voiced_seconds"] == 0.3
    assert not compact["needs_retry"] and not padded["needs_retry"]
    assert not padded["no_speech"]


def test_silence_and_faint_speech_still_reject_without_fabricated_text(tmp_path, monkeypatch):
    fake_vad(monkeypatch)
    silence = check(wav(tmp_path, "silence.wav", 0, 30))
    faint = check(wav(tmp_path, "faint.wav", 25, 30))
    assert silence["no_speech"] and silence["voiced_rms_dbfs"] is None
    assert faint["needs_retry"] and faint["voiced_rms_dbfs"] < -40
    assert "No se generó una transcripción" in faint["quality_reason"]
