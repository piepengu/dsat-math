from app.guardrails import validate_ai_payload


def test_guardrails_rejects_unsafe_latex():
    data = {
        "prompt_latex": "\\input{bad}",
        "choices": ["1", "2", "3", "4"],
        "correct_index": 0,
        "explanation_steps": ["step1"],
    }
    ok, cleaned, reasons, flags = validate_ai_payload(domain="Algebra", skill="linear_equation_mc", data=data)
    assert ok is False
    assert "unsafe_latex" in reasons or flags.get("unsafe_latex") is True


def test_guardrails_accepts_simple_valid_item():
    data = {
        "prompt_latex": "Let\\ x=2.",
        "choices": ["1", "2", "3", "4"],
        "correct_index": 1,
        "explanation_steps": ["Assign x.", "Evaluate."],
    }
    ok, cleaned, reasons, flags = validate_ai_payload(domain="Algebra", skill="linear_equation_mc", data=data)
    assert ok is True
    assert cleaned["correct_index"] == 1
    assert len(cleaned["choices"]) == 4
