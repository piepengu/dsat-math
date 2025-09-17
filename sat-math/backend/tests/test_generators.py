import pytest
from app.generators import (
    generate_exponential_solve,
    generate_linear_equation,
    generate_linear_system_2x2,
    generate_proportion,
    generate_pythagorean_hypotenuse,
    generate_pythagorean_leg,
    generate_quadratic_roots,
    generate_two_step_equation,
    grade_exponential_solve,
    grade_linear_equation,
    grade_linear_system_2x2,
    grade_proportion,
    grade_pythagorean_hypotenuse,
    grade_pythagorean_leg,
    grade_quadratic_roots,
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


@pytest.mark.parametrize("seed", [4, 12, 88])
def test_quadratic_roots(seed: int):
    item = generate_quadratic_roots(seed)
    assert item.domain == "Advanced"
    assert item.skill == "quadratic_roots"
    ok, sol, steps = grade_quadratic_roots(seed, item.solution_str)
    assert ok is True
    assert sol == item.solution_str
    assert isinstance(steps, list) and len(steps) >= 1


@pytest.mark.parametrize("seed", [6, 10, 33])
def test_exponential_solve(seed: int):
    item = generate_exponential_solve(seed)
    assert item.domain == "Advanced"
    assert item.skill == "exponential_solve"
    ok, sol, steps = grade_exponential_solve(seed, item.solution_str)
    assert ok is True
    assert sol == item.solution_str
    assert isinstance(steps, list) and len(steps) >= 1


@pytest.mark.parametrize("seed", [1, 2, 3])
def test_pythagorean_hypotenuse(seed: int):
    item = generate_pythagorean_hypotenuse(seed)
    assert item.domain == "Geometry"
    assert item.skill == "pythagorean_hypotenuse"
    ok, sol, steps = grade_pythagorean_hypotenuse(seed, item.solution_str)
    assert ok is True
    assert sol == item.solution_str
    assert isinstance(steps, list) and len(steps) >= 1


@pytest.mark.parametrize("seed", [4, 5, 6])
def test_pythagorean_leg(seed: int):
    item = generate_pythagorean_leg(seed)
    assert item.domain == "Geometry"
    assert item.skill == "pythagorean_leg"
    ok, sol, steps = grade_pythagorean_leg(seed, item.solution_str)
    assert ok is True
    assert sol == item.solution_str
    assert isinstance(steps, list) and len(steps) >= 1
