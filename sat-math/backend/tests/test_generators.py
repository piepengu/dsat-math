import pytest
import sympy as sp
from app.generators import (
    generate_linear_equation,
    generate_linear_system_2x2,
    generate_proportion,
    generate_two_step_equation,
    grade_linear_equation,
    grade_linear_system_2x2,
    grade_proportion,
    grade_two_step_equation,
)


@pytest.mark.parametrize("seed", [1, 42, 12345])
def test_linear_equation(seed: int):
    item = generate_linear_equation(seed)
    assert item.domain == "Algebra"
    assert item.skill == "linear_equation"
    ok, sol, steps = grade_linear_equation(seed, item.solution_str)
    assert ok is True
    assert sol == item.solution_str
    assert isinstance(steps, list) and len(steps) >= 1


@pytest.mark.parametrize("seed", [7, 100, 555])
def test_two_step_equation(seed: int):
    item = generate_two_step_equation(seed)
    assert item.domain == "Algebra"
    assert item.skill == "two_step_equation"
    ok, sol, steps = grade_two_step_equation(seed, item.solution_str)
    assert ok is True
    assert sol == item.solution_str
    assert isinstance(steps, list) and len(steps) >= 1


@pytest.mark.parametrize("seed", [3, 9, 21])
def test_proportion(seed: int):
    item = generate_proportion(seed)
    assert item.domain == "PSD"
    assert item.skill == "proportion"
    ok, sol, steps = grade_proportion(seed, item.solution_str)
    assert ok is True
    assert sol == item.solution_str
    assert isinstance(steps, list) and len(steps) >= 1


@pytest.mark.parametrize("seed", [2, 13, 77])
def test_linear_system_2x2(seed: int):
    item = generate_linear_system_2x2(seed)
    assert item.domain == "Algebra"
    assert item.skill == "linear_system_2x2"
    ok, sol, steps = grade_linear_system_2x2(seed, item.solution_str)
    assert ok is True
    assert sol == item.solution_str
    assert isinstance(steps, list) and len(steps) >= 1
