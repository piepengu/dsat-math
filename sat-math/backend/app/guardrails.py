import re
from typing import Any, Dict, List, Tuple

# Central caps for Guardrails v2
MAX_LATEX_LEN = 3000
MAX_CHOICES = 4
MAX_CHOICE_LEN = 120
MAX_STEPS = 8
MAX_STEP_LEN = 200

# Elaborate caps
ELAB_MAX_TEXT = 600  # concept/plan/quick_check/common_mistake
ELAB_MAX_WALKTHROUGH_STEPS = 8
ELAB_MAX_WALKTHROUGH_STEP_LEN = 220

# Disallowed LaTeX/content that can break KaTeX or be unsafe
_DISALLOWED_LATEX = re.compile(
    (r"\\(input|include|write18|openout|read|write|immediate)\b|" r"\\begin\{document\}|\\end\{document\}|\\label\{"),
    flags=re.IGNORECASE,
)


def _stringify_list(values: List[Any]) -> List[str]:
    return [str(v) for v in values]


def _has_unsafe_latex(s: str) -> bool:
    try:
        return bool(_DISALLOWED_LATEX.search(s or ""))
    except Exception:
        return True


def _validate_math_formats(skill: str, choices: List[str]) -> bool:
    try:
        import sympy as _sp

        if skill in (
            "linear_equation",
            "linear_equation_mc",
            "two_step_equation",
            "exponential_solve",
            "rational_equation",
            "proportion",
            "pythagorean_hypotenuse",
            "pythagorean_leg",
            "rectangle_area",
            "rectangle_perimeter",
            "triangle_angle",
            "unit_rate",
        ):
            return all(_sp.sympify(c, evaluate=False) is not None for c in choices)

        if skill in ("linear_system_2x2", "quadratic_roots"):

            def _is_pair(s: str) -> bool:
                t = s.strip()
                return t.startswith("(") and t.endswith(")") and "," in t

            return all(_is_pair(c) for c in choices)

        if skill in ("linear_system_3x3",):

            def _is_triple(s: str) -> bool:
                t = s.strip()
                return t.startswith("(") and t.endswith(")") and t.count(",") == 2

            return all(_is_triple(c) for c in choices)

        return True
    except Exception:
        return False


def validate_ai_payload(
    domain: str,
    skill: str,
    data: Dict[str, Any],
) -> Tuple[bool, Dict[str, Any], List[str], Dict[str, bool]]:
    """
    Validate and sanitize model output for AI-generated MC items.

    Returns: (valid, cleaned, reasons, flags)
      - cleaned mirrors needed fields after coercion/sanitization
      - reasons: short reason codes for logging/metrics
      - flags: category booleans for metrics e.g., {"unsafe_latex": True}
    """
    reasons: List[str] = []
    flags: Dict[str, bool] = {}

    choices = data.get("choices") or []
    correct_index = data.get("correct_index", -1)
    steps = data.get("explanation_steps") or []
    hints = data.get("hints") or None
    prompt_latex = data.get("prompt_latex") or ""
    diagram = data.get("diagram") or None

    valid = True

    # Prompt LaTeX caps and safety
    if not isinstance(prompt_latex, str) or len(prompt_latex) == 0:
        valid = False
        reasons.append("prompt_empty")
    if isinstance(prompt_latex, str) and len(prompt_latex) > MAX_LATEX_LEN:
        valid = False
        flags["over_length"] = True
        reasons.append("prompt_too_long")
    if _has_unsafe_latex(prompt_latex):
        valid = False
        flags["unsafe_latex"] = True
        reasons.append("unsafe_latex")

    # Choices
    if not (isinstance(choices, list) and len(choices) == MAX_CHOICES):
        valid = False
        reasons.append("choices_count")
    choices = _stringify_list(choices)
    if not all(isinstance(c, str) and 0 < len(c) <= MAX_CHOICE_LEN for c in choices):
        valid = False
        reasons.append("choices_len")
    if len(set(choices)) != MAX_CHOICES:
        valid = False
        reasons.append("choices_unique")

    # Correct index
    try:
        correct_index = int(correct_index)
    except Exception:
        correct_index = -1
    if not (0 <= correct_index < MAX_CHOICES):
        valid = False
        reasons.append("correct_index")

    # Steps caps
    if not (isinstance(steps, list) and 1 <= len(steps) <= MAX_STEPS):
        valid = False
        reasons.append("steps_count")
    else:
        if any((not isinstance(s, str)) or (len(s) > MAX_STEP_LEN) for s in steps):
            valid = False
            reasons.append("steps_len")
    steps = _stringify_list(steps)

    # Basic math/format sanity per skill
    if not _validate_math_formats(skill, choices):
        valid = False
        reasons.append("choices_format")

    # Diagram validation (keep permissive; sanitize integers when applicable)
    diagram_out = None
    if isinstance(diagram, dict) and diagram.get("type") == "right_triangle":
        try:
            da = int(diagram.get("a", 0))
            db = int(diagram.get("b", 0))
            dc = int(diagram.get("c", 0))
            if da > 0 and db > 0 and dc > 0:
                diagram_out = {
                    "type": "right_triangle",
                    "a": da,
                    "b": db,
                    "c": dc,
                    "labels": diagram.get("labels") or {},
                }
        except Exception:
            diagram_out = None
    elif isinstance(diagram, dict) and diagram.get("type") == "triangle":
        # Leave generic triangle untouched for now (validated client-side)
        diagram_out = diagram

    cleaned = {
        "prompt_latex": str(prompt_latex),
        "choices": choices,
        "correct_index": int(correct_index),
        "explanation_steps": steps,
        "hints": hints if hints else None,
        "diagram": diagram_out,
    }

    return valid, cleaned, reasons, flags


def validate_elaboration_payload(data: Dict[str, Any]) -> Tuple[bool, Dict[str, Any], List[str], Dict[str, bool]]:
    """Validate elaboration payload fields for /elaborate."""
    reasons: List[str] = []
    flags: Dict[str, bool] = {}

    concept = data.get("concept") or None
    plan = data.get("plan") or None
    walkthrough = data.get("walkthrough") or []
    quick = data.get("quick_check") or None
    mistake = data.get("common_mistake") or None

    valid = True

    def _ok_text(s: Any) -> bool:
        return isinstance(s, str) and 0 < len(s) <= ELAB_MAX_TEXT and not _has_unsafe_latex(s)

    if concept is not None and not _ok_text(concept):
        valid = False
        reasons.append("concept_bad")
        if isinstance(concept, str) and _has_unsafe_latex(concept):
            flags["unsafe_latex"] = True
    if plan is not None and not _ok_text(plan):
        valid = False
        reasons.append("plan_bad")
        if isinstance(plan, str) and _has_unsafe_latex(plan):
            flags["unsafe_latex"] = True
    if quick is not None and not _ok_text(quick):
        valid = False
        reasons.append("quick_bad")
        if isinstance(quick, str) and _has_unsafe_latex(quick):
            flags["unsafe_latex"] = True
    if mistake is not None and not _ok_text(mistake):
        valid = False
        reasons.append("mistake_bad")
        if isinstance(mistake, str) and _has_unsafe_latex(mistake):
            flags["unsafe_latex"] = True

    steps_out: List[str] = []
    if walkthrough is not None:
        if not isinstance(walkthrough, list) or len(walkthrough) > ELAB_MAX_WALKTHROUGH_STEPS:
            valid = False
            reasons.append("walkthrough_count")
        else:
            for s in walkthrough:
                if not isinstance(s, str) or len(s) > ELAB_MAX_WALKTHROUGH_STEP_LEN or _has_unsafe_latex(s):
                    valid = False
                    reasons.append("walkthrough_step")
                    if isinstance(s, str) and _has_unsafe_latex(s):
                        flags["unsafe_latex"] = True
                else:
                    steps_out.append(str(s))

    cleaned = {
        "concept": str(concept) if isinstance(concept, str) else None,
        "plan": str(plan) if isinstance(plan, str) else None,
        "walkthrough": steps_out if steps_out else None,
        "quick_check": str(quick) if isinstance(quick, str) else None,
        "common_mistake": str(mistake) if isinstance(mistake, str) else None,
    }

    return valid, cleaned, reasons, flags
