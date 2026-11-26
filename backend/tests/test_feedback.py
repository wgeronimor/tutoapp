import pytest
from app import evaluation
from app.evaluation import Advice, evaluate_text

ACTIVITY = {"prompt": "Di en francés: 10. Luego úsalo en una situación.", "reference": "dix"}


def advice(corrected, has_error=False):
    return Advice(
        corrected=corrected,
        has_error=has_error,
        feedback="El número es correcto.",
        next_action="Úsalo en una frase, por ejemplo para indicar un precio.",
    )


@pytest.mark.parametrize(
    "response,corrected",
    [("10", "dix"), ("Cela coûte 10 dollars.", "Cela coûte dix dollars."), ("21", "vingt-et-un")],
)
def test_equivalent_spoken_number_preserves_raw_input(monkeypatch, response, corrected):
    monkeypatch.setattr(evaluation, "ollama", lambda *args: advice(corrected))
    result = evaluate_text(ACTIVITY, response, True)
    assert result["corrected"] == response
    assert result["input_text"] == response
    assert result["model_corrected"] == corrected
    assert result["has_error"] is False and result["equivalence_note"]
    assert result["score"] is None and result["acoustic_evaluation"] is False


def test_written_numbers_do_not_erase_an_actual_written_correction(monkeypatch):
    monkeypatch.setattr(evaluation, "ollama", lambda *args: advice("dix", True))
    result = evaluate_text(ACTIVITY, "10", False)
    assert result["has_error"] is True and result["corrected"] == "dix"


def test_retries_a_real_contradiction_once_then_uses_coherent_result(monkeypatch):
    calls = []

    def model(schema, system, payload):
        calls.append(payload)
        return advice("deux" if len(calls) == 1 else "10")

    monkeypatch.setattr(evaluation, "ollama", model)
    result = evaluate_text(ACTIVITY, "10", True)
    assert len(calls) == 2 and "validation_issue" in calls[1]
    assert result["validation_retries"] == 1 and result["corrected"] == "10"


def test_persistent_contradiction_explains_exact_change_and_next_steps(monkeypatch):
    calls = []
    monkeypatch.setattr(evaluation, "ollama", lambda *args: calls.append(args) or advice("deux"))
    with pytest.raises(ValueError) as error:
        evaluate_text(ACTIVITY, "10", True)
    assert len(calls) == 2
    message = str(error.value)
    assert "«10»" in message and "«deux»" in message
    assert "no había errores" in message and "no una nota negativa" in message
    assert "guardar sin comentario" in message


def test_model_cannot_mark_equivalent_asr_format_as_an_oral_error(monkeypatch):
    monkeypatch.setattr(evaluation, "ollama", lambda *args: advice("dix", True))
    with pytest.raises(ValueError, match="no corrige el contenido"):
        evaluate_text(ACTIVITY, "10", True)


def test_no_error_sentence_reordering_does_not_replace_original(monkeypatch):
    original = "Je travaille à la maison. J'aime lire."
    proposal = "J'aime lire. Je travaille à la maison."
    monkeypatch.setattr(evaluation, "ollama", lambda *args: advice(proposal))
    result = evaluate_text(ACTIVITY, original, False)
    assert result["corrected"] == original and result["model_corrected"] == proposal
    assert result["has_error"] is False and "otro orden" in result["equivalence_note"]
