"""French IPA using the local phonemizer already installed for Kokoro."""

import json
import sys

from misaki.espeak import EspeakG2P
from phonemizer.separator import Separator

request = json.load(sys.stdin)
phonemizer = EspeakG2P("fr-fr")
ipa = phonemizer.backend.phonemize(
    [request["text"]], separator=Separator(phone="", word=" ", syllable="")
)[0]
print(json.dumps({"ipa": ipa}, ensure_ascii=False))
