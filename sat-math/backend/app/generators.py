import random
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import sympy as sp


@dataclass
class GeneratedItem:
    domain: str
    skill: str
    format: str
    seed: int
    prompt_latex: str
    solution_str: str
    explanation_steps: List[str]
    # MC-only fields (optional)
    choices: Optional[List[str]] = None
    correct_index: Optional[int] = None
    why_incorrect: Optional[List[str]] = None
    # Optional diagram spec
    diagram: Optional[Dict[str, object]] = None


def generate_linear_equation(seed: int) -> GeneratedItem:
    rng = random.Random(seed)
    # a(x + b) = c with integer solution
    a = rng.randint(2, 9)
    # choose integer root first
    root = rng.randint(-9, 9)
    b = rng.randint(-9, 9)
    c = int(a * (root + b))

    prompt_latex = f"Solve for x: {a}(x {b:+}) = {c}"
    solution = sp.Integer(root)

    steps: List[str] = [
        f"Distribute: {a}x {a*b:+} = {c}",
        f"Subtract {a*b:+} from both sides: {a}x = {c - a*b}",
        f"Divide by {a}: x = {(c - a*b)//a}",
    ]

    return GeneratedItem(
        domain="Algebra",
        skill="linear_equation",
        format="SPR",
        seed=seed,
        prompt_latex=prompt_latex,
        solution_str=str(solution),
        explanation_steps=steps,
        diagram=None,
    )


def grade_linear_equation(
    seed: int,
    user_answer: str,
) -> Tuple[bool, str, List[str]]:
    item = generate_linear_equation(seed)
    try:
        # Try to parse numeric answer; allow fractions like 3/4
        user_expr = sp.sympify(user_answer)
    except Exception:
        return False, item.solution_str, item.explanation_steps

    # Numeric equivalence check
    try:
        is_equal = sp.nsimplify(user_expr) == sp.nsimplify(
            sp.sympify(item.solution_str)
        )
    except Exception:
        is_equal = False
    return bool(is_equal), item.solution_str, item.explanation_steps


def generate_linear_equation_mc(seed: int) -> GeneratedItem:
    # build on linear equation, generate distractors from common errors
    base = generate_linear_equation(seed)
    rng = random.Random(seed + 999)
    try:
        sol_val = int(sp.nsimplify(base.solution_str))
    except Exception:
        sol_val = int(float(sp.nsimplify(base.solution_str)))

    # distractor strategies
    d1 = sol_val + rng.choice([-2, -1, 1, 2])  # off-by-small
    d2 = sol_val * -1  # wrong sign
    d3 = sol_val + rng.choice([3, -3])  # another plausible

    options = [sol_val, d1, d2, d3]
    rng.shuffle(options)
    correct_index = options.index(sol_val)
    choices = [str(x) for x in options]

    why_map = []
    for x in options:
        if x == sol_val:
            why_map.append(
                "Correct — solves the equation after proper distribution/" "isolation."
            )
        elif x == d2:
            why_map.append("Sign error when moving terms across the equals sign.")
        elif x == d1:
            why_map.append(
                "Arithmetic slip (off-by-one/two) during add/" "subtract step."
            )
        else:
            why_map.append("Stopped early or misapplied division step.")

    return GeneratedItem(
        domain=base.domain,
        skill=base.skill + "_mc",
        format="MC",
        seed=base.seed,
        prompt_latex=base.prompt_latex,
        solution_str=str(sol_val),
        explanation_steps=base.explanation_steps,
        choices=choices,
        correct_index=correct_index,
        why_incorrect=why_map,
        diagram=None,
    )


def grade_linear_equation_mc(
    seed: int, selected_index: int
) -> Tuple[bool, str, List[str], str]:
    item = generate_linear_equation_mc(seed)
    if (
        selected_index is None
        or selected_index < 0
        or selected_index >= len(item.choices or [])
    ):
        return (
            False,
            item.solution_str,
            item.explanation_steps,
            "No choice selected",
        )
    correct = selected_index == (item.correct_index or -1)
    why_selected = (item.why_incorrect or [""])[selected_index]
    return (
        bool(correct),
        item.solution_str,
        item.explanation_steps,
        why_selected,
    )


def generate_two_step_equation(seed: int) -> GeneratedItem:
    rng = random.Random(seed)
    # a x + b = c with integer root
    a = rng.randint(2, 9)
    root = rng.randint(-9, 9)
    b = rng.randint(-9, 9)
    c = int(a * root + b)

    prompt_latex = f"Solve for x: {a}x {b:+} = {c}"
    steps: List[str] = [
        f"Subtract {b:+} from both sides: {a}x = {c - b}",
        f"Divide by {a}: x = {(c - b)//a}",
    ]
    return GeneratedItem(
        domain="Algebra",
        skill="two_step_equation",
        format="SPR",
        seed=seed,
        prompt_latex=prompt_latex,
        solution_str=str(int(root)),
        explanation_steps=steps,
        diagram=None,
    )


def grade_two_step_equation(
    seed: int,
    user_answer: str,
) -> Tuple[bool, str, List[str]]:
    item = generate_two_step_equation(seed)
    try:
        user_expr = sp.sympify(user_answer)
        is_equal = sp.nsimplify(user_expr) == sp.nsimplify(
            sp.sympify(item.solution_str)
        )
    except Exception:
        is_equal = False
    return bool(is_equal), item.solution_str, item.explanation_steps


def generate_proportion(seed: int) -> GeneratedItem:
    rng = random.Random(seed)
    # a/b = x/c  -> x = a*c/b (choose divisible)
    b = rng.randint(2, 9)
    c = rng.randint(2, 9)
    k = rng.randint(1, 9)
    a = b * k  # ensures divisibility
    x_val = int(a * c // b)
    prompt_latex = (
        "Solve for x: "
        "\\[\\frac{" + str(a) + "}{" + str(b) + "} = "
        "\\frac{x}{" + str(c) + "}\\]"
    )
    steps: List[str] = [
        "Cross-multiply: " + f"{a} \u00b7 {c} = {b} \u00b7 x",
        f"Compute: {a*c} = {b}x",
        f"Divide both sides by {b}: x = {x_val}",
    ]
    return GeneratedItem(
        domain="PSD",
        skill="proportion",
        format="SPR",
        seed=seed,
        prompt_latex=prompt_latex,
        solution_str=str(x_val),
        explanation_steps=steps,
        diagram=None,
    )


def grade_proportion(
    seed: int,
    user_answer: str,
) -> Tuple[bool, str, List[str]]:
    item = generate_proportion(seed)
    try:
        user_expr = sp.sympify(user_answer)
        is_equal = sp.nsimplify(user_expr) == sp.nsimplify(
            sp.sympify(item.solution_str)
        )
    except Exception:
        is_equal = False
    return bool(is_equal), item.solution_str, item.explanation_steps


def generate_linear_system_2x2(seed: int) -> GeneratedItem:
    rng = random.Random(seed)
    # Choose integer solution first
    x0 = rng.randint(-5, 5)
    y0 = rng.randint(-5, 5)
    # Choose coefficients with non-zero determinant
    while True:
        a = rng.randint(-5, 5) or 1
        b = rng.randint(-5, 5) or 2
        c = rng.randint(-5, 5) or -2
        d = rng.randint(-5, 5) or 3
        det = a * d - b * c
        if det != 0:
            break
    e = a * x0 + b * y0
    f = c * x0 + d * y0
    prompt_latex = (
        "Solve the system for (x, y):\\n\\[\n"
        f"\\begin{{cases}} {a}x {b:+}y = {e} \\"
        f" {c}x {d:+}y = {f} \\end{{cases}}\n"
        "\\]"
    )
    steps: List[str] = [
        "Use elimination or Cramer's rule to solve.",
        ("Determinant: " f"{a}·{d} - {b}·{c} = {det}"),
        f"Solution: x = {x0}, y = {y0}",
    ]
    return GeneratedItem(
        domain="Algebra",
        skill="linear_system_2x2",
        format="SPR",
        seed=seed,
        prompt_latex=prompt_latex,
        solution_str=f"{x0},{y0}",
        explanation_steps=steps,
        diagram=None,
    )


def _parse_pair(answer: str) -> Tuple[int, int]:
    # Accept formats like "x,y", "(x,y)", "x y"
    s = answer.strip().replace("(", "").replace(")", "")
    if "," in s:
        parts = s.split(",")
    else:
        parts = s.split()
    if len(parts) != 2:
        raise ValueError("expected two numbers")
    return int(sp.Integer(parts[0])), int(sp.Integer(parts[1]))


def grade_linear_system_2x2(
    seed: int,
    user_answer: str,
) -> Tuple[bool, str, List[str]]:
    item = generate_linear_system_2x2(seed)
    try:
        ux, uy = _parse_pair(user_answer)
        sx, sy = _parse_pair(item.solution_str)
        is_equal = (ux == sx) and (uy == sy)
    except Exception:
        is_equal = False
    return bool(is_equal), item.solution_str, item.explanation_steps


# ------------------------ Advanced Math ------------------------


def generate_quadratic_roots(seed: int) -> GeneratedItem:
    rng = random.Random(seed)
    # Choose integer roots r1, r2 and leading coefficient a
    r1 = rng.randint(-5, 5)
    r2 = rng.randint(-5, 5)
    a = rng.choice([1, 1, 1, 2, 3])  # bias to 1 to keep small coefficients
    x = sp.symbols("x")
    poly = sp.expand(a * (x - r1) * (x - r2))
    prompt_latex = f"Solve for x: {sp.latex(sp.Eq(poly, 0))}"
    steps: List[str] = [
        f"Set factors to zero: (x - {r1}) = 0 or (x - {r2}) = 0",
        f"Therefore, x = {r1} or x = {r2}",
    ]
    # order-independent solution
    sol = f"{min(r1, r2)},{max(r1, r2)}"
    return GeneratedItem(
        domain="Advanced",
        skill="quadratic_roots",
        format="SPR",
        seed=seed,
        prompt_latex=prompt_latex,
        solution_str=sol,
        explanation_steps=steps,
        diagram=None,
    )


def _parse_two_numbers_any(answer: str) -> Tuple[sp.Basic, sp.Basic]:
    s = answer.strip().replace("(", "").replace(")", "")
    sep = "," if "," in s else None
    parts = [p for p in (s.split(sep) if sep else s.split()) if p]
    if len(parts) != 2:
        raise ValueError("expected two numbers")
    return sp.nsimplify(parts[0]), sp.nsimplify(parts[1])


def grade_quadratic_roots(
    seed: int,
    user_answer: str,
) -> Tuple[bool, str, List[str]]:
    item = generate_quadratic_roots(seed)
    try:
        u1, u2 = _parse_two_numbers_any(user_answer)
        s1, s2 = _parse_two_numbers_any(item.solution_str)
        user_set = {sp.nsimplify(u1), sp.nsimplify(u2)}
        sol_set = {sp.nsimplify(s1), sp.nsimplify(s2)}
        is_equal = user_set == sol_set
    except Exception:
        is_equal = False
    return bool(is_equal), item.solution_str, item.explanation_steps


def generate_exponential_solve(seed: int) -> GeneratedItem:
    rng = random.Random(seed)
    b = rng.randint(2, 5)
    x0 = rng.randint(-3, 3)
    a = rng.choice([1, 2, 3, 4])
    c = a * (b**x0)
    prompt_latex = f"Solve for x: {a}\\cdot {b}^x = {c}"
    steps: List[str] = [
        f"Divide both sides by {a}: {b}^x = {c//a}",
        f"Take log base {b}: x = \\log_{{{b}}}({c//a}) = {x0}",
    ]
    return GeneratedItem(
        domain="Advanced",
        skill="exponential_solve",
        format="SPR",
        seed=seed,
        prompt_latex=prompt_latex,
        solution_str=str(int(x0)),
        explanation_steps=steps,
    )


def grade_exponential_solve(
    seed: int,
    user_answer: str,
) -> Tuple[bool, str, List[str]]:
    item = generate_exponential_solve(seed)
    try:
        is_equal = sp.nsimplify(user_answer) == sp.nsimplify(item.solution_str)
    except Exception:
        is_equal = False
    return bool(is_equal), item.solution_str, item.explanation_steps


# -------------------- Geometry / Trigonometry --------------------

_TRIPLES = [(3, 4, 5), (5, 12, 13), (7, 24, 25), (8, 15, 17), (9, 12, 15)]


def generate_pythagorean_hypotenuse(seed: int) -> GeneratedItem:
    rng = random.Random(seed)
    a, b, c = rng.choice(_TRIPLES)
    k = rng.randint(1, 5)
    leg1, leg2, hyp = a * k, b * k, c * k
    prompt_latex = (
        "\\text{In a right triangle with legs "
        f"{leg1} and {leg2}, find the hypotenuse.}}"
    )
    steps: List[str] = [
        ("Use a^2 + b^2 = c^2: " f"{leg1}^2 + {leg2}^2 = c^2"),
        ("Compute: " f"{leg1**2} + {leg2**2} = {leg1**2 + leg2**2} = c^2"),
        f"Take square root: c = {hyp}",
    ]
    return GeneratedItem(
        domain="Geometry",
        skill="pythagorean_hypotenuse",
        format="SPR",
        seed=seed,
        prompt_latex=prompt_latex,
        solution_str=str(hyp),
        explanation_steps=steps,
        diagram={
            "type": "right_triangle",
            "a": leg1,
            "b": leg2,
            "c": hyp,
            "labels": {"a": str(leg1), "b": str(leg2), "c": "?"},
        },
    )


def grade_pythagorean_hypotenuse(
    seed: int,
    user_answer: str,
) -> Tuple[bool, str, List[str]]:
    item = generate_pythagorean_hypotenuse(seed)
    try:
        is_equal = sp.nsimplify(user_answer) == sp.nsimplify(item.solution_str)
    except Exception:
        is_equal = False
    return bool(is_equal), item.solution_str, item.explanation_steps


def generate_pythagorean_leg(seed: int) -> GeneratedItem:
    rng = random.Random(seed)
    a, b, c = rng.choice(_TRIPLES)
    k = rng.randint(1, 5)
    leg_known = a * k
    hyp = c * k
    other_leg = b * k
    prompt_latex = (
        "\\text{In a right triangle, the hypotenuse is "
        f"{hyp} and one leg is {leg_known}. Find the other leg.}}"
    )
    steps: List[str] = [
        ("Use c^2 - a^2 = b^2: " f"{hyp}^2 - {leg_known}^2 = b^2"),
        ("Compute: " f"{hyp**2} - {leg_known**2} = {hyp**2 - leg_known**2} = b^2"),
        f"Take square root: b = {other_leg}",
    ]
    return GeneratedItem(
        domain="Geometry",
        skill="pythagorean_leg",
        format="SPR",
        seed=seed,
        prompt_latex=prompt_latex,
        solution_str=str(other_leg),
        explanation_steps=steps,
        diagram={
            "type": "right_triangle",
            "a": leg_known,
            "b": other_leg,
            "c": hyp,
            "labels": {"a": str(leg_known), "b": "?", "c": str(hyp)},
        },
    )


def grade_pythagorean_leg(
    seed: int,
    user_answer: str,
) -> Tuple[bool, str, List[str]]:
    item = generate_pythagorean_leg(seed)
    try:
        is_equal = sp.nsimplify(user_answer) == sp.nsimplify(item.solution_str)
    except Exception:
        is_equal = False
    return bool(is_equal), item.solution_str, item.explanation_steps
