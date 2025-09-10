import random
from dataclasses import dataclass
from typing import List, Tuple

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
