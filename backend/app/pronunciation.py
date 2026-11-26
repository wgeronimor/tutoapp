"""Reference pronunciation only; never a measurement of the student's voice."""

import json
import re
import subprocess
import unicodedata
from functools import lru_cache

from .config import ROOT

NUMBER_SOURCE = (
    "https://vitrinelinguistique.oqlf.gouv.qc.ca/23137/"
    "la-prononciation/prononciation-des-nombres/prononciation-de-six-et-dix"
)


def explain(text, raw_ipa):
    # Broad IPA: omit eSpeak's per-word stress and internal liaison markers.
    ipa = unicodedata.normalize("NFC", raw_ipa)
    ipa = re.sub(r"[ˈˌ^\-]", "", ipa)
    ipa = " ".join(ipa.split())
    if not ipa or not any(c.isalpha() for c in ipa):
        raise ValueError("No se pudo preparar la transcripción fonética de esta referencia")
    notes = []
    sources = []
    normalized = re.sub(r"[^\w\s]", "", text.lower()).strip()
    if normalized in ("dix", "10", "six", "6"):
        word = "dix" if normalized in ("dix", "10") else "six"
        notes.append(f"En «{word}» aislado, la x final suena /s/, sin /k/. No se pronuncia /ks/.")
    if re.search(r"\b(?:dix|six|10|6)\b", text, re.IGNORECASE):
        notes.append(
            "La pronunciación cambia con el contexto: dix /dis/ aislado; "
            "dix dollars /di dɔlaʁ/; dix ans /diz ɑ̃/. "
            "En estos dos últimos ejemplos, dix expresa una cantidad ante un nombre."
        )
        sources.append({"title": "OQLF · Pronunciación de six y dix", "url": NUMBER_SOURCE})
    if "ʁ" in ipa:
        notes.append("/ʁ/: r francesa, producida en la parte posterior de la boca.")
    if "ʒ" in ipa:
        notes.append("/ʒ/: sonido de je; parecido a /ʃ/, pero haciendo vibrar la voz.")
    if "ʃ" in ipa:
        notes.append("/ʃ/: sonido de ch en francés; se oye como sh, sin la t de la ch española.")
    if "y" in ipa:
        notes.append("/y/: coloca la lengua para decir i y redondea los labios para decir u.")
    if "u" in ipa:
        notes.append("/u/: sonido parecido a la u española; en francés suele escribirse ou.")
    if "ø" in ipa or "œ" in ipa:
        notes.append("/ø, œ/: vocales de labios redondeados, sin equivalente exacto en español.")
    if "ə" in ipa:
        notes.append("/ə/: vocal central y breve; algunas e pueden omitirse al hablar con fluidez.")
    if "ɛ" in ipa or "ɔ" in ipa:
        notes.append("/ɛ, ɔ/: vocales más abiertas que /e, o/.")
    if "̃" in unicodedata.normalize("NFD", ipa):
        notes.append(
            "La tilde sobre una vocal, como /ɑ̃/, indica nasalidad: "
            "deja salir aire por la nariz sin añadir una n o m final."
        )
    if any(c in ipa for c in ("j", "ɥ", "w")):
        notes.append(
            "/j, ɥ, w/: deslizamientos breves hacia la vocal siguiente; no añadas otra sílaba."
        )
    notes.append(
        "Se transcribe la referencia completa para tener en cuenta enlaces entre palabras. "
        "No se pronuncia cada letra escrita por separado."
    )
    return {
        "text": text,
        "ipa": ipa,
        "notes": notes,
        "sources": sources,
        "method": "AFI amplio · francés de referencia · eSpeak NG, mediante Misaki",
        "automatic": True,
        "version": "reference-ipa-v1",
    }


@lru_cache(maxsize=512)
def reference_guide(text):
    if not text.strip():
        raise ValueError("Esta actividad no tiene una referencia de audio")
    result = subprocess.run(
        [
            str(ROOT / "local-model-tests/.venv/bin/python"),
            str(ROOT / "scripts/phonetic_reference.py"),
        ],
        input=json.dumps({"text": text}, ensure_ascii=False),
        text=True,
        capture_output=True,
        timeout=30,
        check=True,
    )
    return explain(text, json.loads(result.stdout)["ipa"])
