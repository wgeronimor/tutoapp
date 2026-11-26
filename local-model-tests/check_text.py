"""Exercise local French corrections through Ollama and retain real outputs."""

import argparse
import json
import re
import time
import unicodedata
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CASES = [
    ("age", "Je suis trente ans.", True, "J'ai trente ans."),
    ("country", "J'habite à Canada.", True, "J'habite au Canada."),
    ("agreement", "Nous est étudiants.", True, "Nous sommes étudiants."),
    ("valid_sentence", "Je parle espagnol.", False, "Je parle espagnol."),
    ("valid_location", "J'habite au Canada.", False, "J'habite au Canada."),
    ("valid_feminine", "Je suis étudiante.", False, "Je suis étudiante."),
]
HOLDOUT_CASES = [
    ("new_age_valid", "Elle a vingt ans.", False, "Elle a vingt ans."),
    ("new_country_valid", "Tu habites au Canada.", False, "Tu habites au Canada."),
    ("new_plural_error", "Vous est professeur.", True, "Vous êtes professeur."),
    ("new_city_valid", "Il habite à Paris.", False, "Il habite à Paris."),
    ("new_age_error", "Il est vingt ans.", True, "Il a vingt ans."),
    ("new_plural_valid", "Nous habitons au Canada.", False, "Nous habitons au Canada."),
    ("new_combination", "Je suis étudiant et je parle espagnol.", False,
     "Je suis étudiant et je parle espagnol."),
    ("new_elision", "Je habite au Canada.", True, "J'habite au Canada."),
]


def normalize(text):
    text = unicodedata.normalize("NFC", text).lower().replace("’", "'")
    return re.sub(r"[^\w]+", " ", text).strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("model", choices=["qwen3:4b", "qwen3:8b"])
    parser.add_argument("--profile", choices=["baseline", "guided"], default="baseline")
    parser.add_argument("--suite", choices=["initial", "holdout"], default="initial")
    args = parser.parse_args()
    results = []
    instruction = (
        "Eres un tutor de francés A1. Evalúa solo la gramática de la frase. "
        "Conserva el género y el significado. Una oración correcta debe "
        "conservarse. Devuelve JSON con has_error (boolean), correction "
        "(francés) y explanation (explicación breve en español)."
    )
    if args.profile == "guided":
        instruction += (
            "\nReglas de referencia para este bloque A1: la edad se expresa con avoir "
            "(j'ai ... ans); con Canada se usa au Canada; con ciudades se usa à "
            "(à Paris). Être en presente: je suis, tu es, il/elle est, nous sommes, "
            "vous êtes, ils/elles sont. El verbo concuerda en persona y número "
            "con el sujeto. El adjetivo o nombre de profesión puede marcar género. "
            "Usa estas reglas y explica en español solamente la regla pertinente. "
            "has_error significa existe un error gramatical: si la frase es "
            "correcta debes devolver false. Revisa que bandera, corrección y "
            "explicación sean coherentes antes de responder. Prefiere la "
            "corrección mínima y habitual para un principiante.\n"
            "Ejemplo correcto: Tu parles français. => "
            '{"has_error":false,"correction":"Tu parles français.",'
            '"explanation":"La frase es correcta."}\n'
            "Ejemplo con error: Elle sont médecin. => "
            '{"has_error":true,"correction":"Elle est médecin.",'
            '"explanation":"Con elle, être se conjuga est."}'
        )
    cases = CASES if args.suite == "initial" else HOLDOUT_CASES
    for name, sentence, expected_error, expected_correction in cases:
        payload = {
            "model": args.model,
            "stream": False,
            "think": False,
            "format": "json",
            "keep_alive": "2m",
            "options": {"temperature": 0, "num_predict": 300, "num_ctx": 4096},
            "messages": [
                {
                    "role": "system",
                    "content": instruction,
                },
                {"role": "user", "content": sentence},
            ],
        }
        request = urllib.request.Request(
            "http://127.0.0.1:11434/api/chat",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
        )
        started = time.perf_counter()
        with urllib.request.urlopen(request, timeout=300) as response:
            result = json.load(response)
        elapsed = time.perf_counter() - started
        answer = json.loads(result["message"]["content"])
        passed = (
            answer.get("has_error") is expected_error
            and normalize(answer.get("correction", "")) == normalize(expected_correction)
        )
        item = {
            "case": name,
            "profile": args.profile,
            "suite": args.suite,
            "input": sentence,
            "expected_error": expected_error,
            "expected_correction": expected_correction,
            "answer": answer,
            "passed": passed,
            "seconds": round(elapsed, 3),
            "load_seconds": round(result.get("load_duration", 0) / 1e9, 3),
            "output_tokens": result.get("eval_count"),
        }
        results.append(item)
        suffix = "" if args.profile == "baseline" else "-guided"
        if args.suite == "holdout":
            suffix += "-holdout"
        output = ROOT / f"text-{args.model.replace(':', '-')}{suffix}.json"
        output.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps(item, ensure_ascii=False), flush=True)
    print(f"Passed {sum(item['passed'] for item in results)}/{len(results)}", flush=True)


if __name__ == "__main__":
    main()
