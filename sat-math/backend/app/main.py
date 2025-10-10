import json
import logging
import os
import random
import re
from typing import List, Optional

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from .db import Base, engine, get_db
from .estimator import estimate_math_sat
from .generators import (
    generate_exponential_solve,
    generate_linear_equation,
    generate_linear_equation_mc,
    generate_linear_system_2x2,
    generate_linear_system_3x3,
    generate_proportion,
    generate_psd_unit_rate,
    generate_pythagorean_hypotenuse,
    generate_pythagorean_leg,
    generate_quadratic_roots,
    generate_rational_equation,
    generate_rectangle_area,
    generate_rectangle_perimeter,
    generate_triangle_interior_angle,
    generate_two_step_equation,
    grade_exponential_solve,
    grade_linear_equation,
    grade_linear_equation_mc,
    grade_linear_system_2x2,
    grade_linear_system_3x3,
    grade_proportion,
    grade_pythagorean_hypotenuse,
    grade_pythagorean_leg,
    grade_quadratic_roots,
    grade_rational_equation,
    grade_rectangle_area,
    grade_rectangle_perimeter,
    grade_triangle_interior_angle,
    grade_two_step_equation,
)
from .models import Attempt
from .schemas import (
    AttemptAIRequest,
    AttemptAIResponse,
    AttemptOut,
    EstimateRequest,
    EstimateResponse,
    GenerateAIRequest,
    GenerateAIResponse,
    GenerateRequest,
    GenerateResponse,
    GradeRequest,
    GradeResponse,
    NextRequest,
    NextResponse,
    ResetStatsRequest,
    ResetStatsResponse,
)

try:
    import google.generativeai as genai

    _HAS_GENAI = True
except Exception:
    _HAS_GENAI = False

app = FastAPI()

# CORS: use explicit origins to keep headers valid in browsers
_env_origins = os.getenv("FRONTEND_ORIGIN", "").strip()
_origins = [o.strip() for o in _env_origins.split(",") if o.strip()]
if not _origins:
    _origins = [
        "https://piepengu.github.io",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=False,
)


Base.metadata.create_all(bind=engine)
_log = logging.getLogger("app.guardrails")


# Lightweight migration for new analytics columns on SQLite
try:
    with engine.connect() as _conn:
        rows = _conn.exec_driver_sql("PRAGMA table_info(attempts)").fetchall()
        existing = {r[1] for r in rows}
        if "source" not in existing:
            _conn.exec_driver_sql("ALTER TABLE attempts ADD COLUMN source TEXT")
        if "time_ms" not in existing:
            _conn.exec_driver_sql("ALTER TABLE attempts ADD COLUMN time_ms INTEGER")
        if "created_at" not in existing:
            _conn.exec_driver_sql("ALTER TABLE attempts ADD COLUMN created_at DATETIME")
        if "difficulty" not in existing:
            _conn.exec_driver_sql("ALTER TABLE attempts ADD COLUMN difficulty TEXT")
except Exception:
    pass


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/generate", response_model=GenerateResponse)
def generate_item(req: GenerateRequest):
    seed = req.seed if req.seed is not None else random.randint(1, 10_000_000)
    if req.domain == "Algebra" and req.skill == "linear_equation":
        item = generate_linear_equation(seed)
    elif req.domain == "Algebra" and req.skill == "two_step_equation":
        item = generate_two_step_equation(seed)
    elif req.domain == "PSD" and req.skill == "proportion":
        item = generate_proportion(seed)
    elif req.domain == "Algebra" and req.skill == "linear_system_2x2":
        item = generate_linear_system_2x2(seed)
    elif req.domain == "Advanced" and req.skill == "linear_system_3x3":
        item = generate_linear_system_3x3(seed)
    elif req.domain == "Algebra" and req.skill == "linear_equation_mc":
        item = generate_linear_equation_mc(seed)
    elif req.domain == "Advanced" and req.skill == "quadratic_roots":
        item = generate_quadratic_roots(seed)
    elif req.domain == "Advanced" and req.skill == "exponential_solve":
        item = generate_exponential_solve(seed)
    elif req.domain == "Advanced" and req.skill == "rational_equation":
        item = generate_rational_equation(seed)
    elif req.domain == "Geometry" and req.skill == "pythagorean_hypotenuse":
        item = generate_pythagorean_hypotenuse(seed)
    elif req.domain == "Geometry" and req.skill == "pythagorean_leg":
        item = generate_pythagorean_leg(seed)
    elif req.domain == "Geometry" and req.skill == "rectangle_area":
        item = generate_rectangle_area(seed)
    elif req.domain == "Geometry" and req.skill == "rectangle_perimeter":
        item = generate_rectangle_perimeter(seed)
    elif req.domain == "Geometry" and req.skill == "triangle_angle":
        item = generate_triangle_interior_angle(seed)
    else:
        # default to linear equation for now
        item = generate_linear_equation(seed)

    # Derive basic hints from explanation steps (first 1-2 steps)
    base_hints: List[str] = []
    try:
        steps_src = getattr(item, "explanation_steps", []) or []
        if isinstance(steps_src, list) and steps_src:
            base_hints = [str(steps_src[0])]
            if len(steps_src) > 1:
                base_hints.append(str(steps_src[1]))
    except Exception:
        base_hints = []

    return GenerateResponse(
        domain=item.domain,
        skill=item.skill,
        format=item.format,
        seed=item.seed,
        prompt_latex=item.prompt_latex,
        choices=getattr(item, "choices", None),
        diagram=getattr(item, "diagram", None),
        hints=base_hints or None,
        explanation={
            "concept": getattr(item, "concept", None),
            "plan": getattr(item, "plan", None),
            "quick_check": getattr(item, "quick_check", None),
            "common_mistake": getattr(item, "common_mistake", None),
        },
    )


@app.post("/grade", response_model=GradeResponse)
def grade_item(req: GradeRequest, db: Session = Depends(get_db)):
    item_meta = None
    if req.domain == "Algebra" and req.skill == "linear_equation":
        correct, sol, steps = grade_linear_equation(req.seed, req.user_answer)
        from .generators import generate_linear_equation as _gen

        item_meta = _gen(req.seed)
    elif req.domain == "Algebra" and req.skill == "two_step_equation":
        correct, sol, steps = grade_two_step_equation(
            req.seed,
            req.user_answer,
        )
        from .generators import generate_two_step_equation as _gen

        item_meta = _gen(req.seed)
    elif req.domain == "PSD" and req.skill == "proportion":
        correct, sol, steps = grade_proportion(
            req.seed,
            req.user_answer,
        )
        from .generators import generate_proportion as _gen

        item_meta = _gen(req.seed)
    elif req.domain == "Algebra" and req.skill == "linear_system_2x2":
        correct, sol, steps = grade_linear_system_2x2(
            req.seed,
            req.user_answer,
        )
        from .generators import generate_linear_system_2x2 as _gen

        item_meta = _gen(req.seed)
    elif req.domain == "Advanced" and req.skill == "linear_system_3x3":
        correct, sol, steps = grade_linear_system_3x3(
            req.seed,
            req.user_answer,
        )
        from .generators import generate_linear_system_3x3 as _gen

        item_meta = _gen(req.seed)
    elif req.domain == "Algebra" and req.skill == "linear_equation_mc":
        correct, sol, steps, why_sel = grade_linear_equation_mc(
            req.seed,
            (
                req.selected_choice_index
                if req.selected_choice_index is not None
                else -1
            ),
        )
        from .generators import generate_linear_equation_mc as _gen

        item_meta = _gen(req.seed)
        # persist attempt below as usual, but include why on response
        user_id = req.user_id or "anonymous"
        db_attempt = Attempt(
            user_id=user_id,
            domain=req.domain,
            skill=req.skill,
            seed=req.seed,
            correct=bool(correct),
            correct_answer=str(sol),
            source="template",
            time_ms=req.time_ms if hasattr(req, "time_ms") else None,
            difficulty=(req.difficulty if hasattr(req, "difficulty") else None),
        )
        db.add(db_attempt)
        db.commit()
        return GradeResponse(
            correct=correct,
            correct_answer=str(sol),
            explanation_steps=steps,
            why_correct="It satisfies the equation.",
            why_incorrect_selected=None if correct else why_sel,
            explanation={
                "concept": getattr(item_meta, "concept", None),
                "plan": getattr(item_meta, "plan", None),
                "quick_check": getattr(item_meta, "quick_check", None),
                "common_mistake": getattr(item_meta, "common_mistake", None),
            },
        )
    elif req.domain == "Advanced" and req.skill == "quadratic_roots":
        correct, sol, steps = grade_quadratic_roots(req.seed, req.user_answer)
        from .generators import generate_quadratic_roots as _gen

        item_meta = _gen(req.seed)
    elif req.domain == "Advanced" and req.skill == "exponential_solve":
        correct, sol, steps = grade_exponential_solve(
            req.seed,
            req.user_answer,
        )
        from .generators import generate_exponential_solve as _gen

        item_meta = _gen(req.seed)
    elif req.domain == "Advanced" and req.skill == "rational_equation":
        correct, sol, steps = grade_rational_equation(
            req.seed,
            req.user_answer,
        )
        from .generators import generate_rational_equation as _gen

        item_meta = _gen(req.seed)
    elif req.domain == "Geometry" and req.skill == "pythagorean_hypotenuse":
        correct, sol, steps = grade_pythagorean_hypotenuse(
            req.seed,
            req.user_answer,
        )
        from .generators import generate_pythagorean_hypotenuse as _gen

        item_meta = _gen(req.seed)
    elif req.domain == "Geometry" and req.skill == "pythagorean_leg":
        correct, sol, steps = grade_pythagorean_leg(req.seed, req.user_answer)
        from .generators import generate_pythagorean_leg as _gen

        item_meta = _gen(req.seed)
    elif req.domain == "Geometry" and req.skill == "rectangle_area":
        correct, sol, steps = grade_rectangle_area(req.seed, req.user_answer)
        from .generators import generate_rectangle_area as _gen

        item_meta = _gen(req.seed)
    elif req.domain == "Geometry" and req.skill == "rectangle_perimeter":
        correct, sol, steps = grade_rectangle_perimeter(
            req.seed,
            req.user_answer,
        )
        from .generators import generate_rectangle_perimeter as _gen

        item_meta = _gen(req.seed)
    elif req.domain == "Geometry" and req.skill == "triangle_angle":
        correct, sol, steps = grade_triangle_interior_angle(
            req.seed,
            req.user_answer,
        )
        from .generators import generate_triangle_interior_angle as _gen

        item_meta = _gen(req.seed)
    else:
        correct, sol, steps = grade_linear_equation(req.seed, req.user_answer)
        from .generators import generate_linear_equation as _gen

        item_meta = _gen(req.seed)

    user_id = req.user_id or "anonymous"
    db_attempt = Attempt(
        user_id=user_id,
        domain=req.domain,
        skill=req.skill,
        seed=req.seed,
        correct=bool(correct),
        correct_answer=str(sol),
        source="template",
        time_ms=req.time_ms if hasattr(req, "time_ms") else None,
        difficulty=(req.difficulty if hasattr(req, "difficulty") else None),
    )
    db.add(db_attempt)
    db.commit()

    return GradeResponse(
        correct=correct,
        correct_answer=str(sol),
        explanation_steps=steps,
        why_correct="It satisfies the equation.",
        explanation={
            "concept": getattr(item_meta, "concept", None),
            "plan": getattr(item_meta, "plan", None),
            "quick_check": getattr(item_meta, "quick_check", None),
            "common_mistake": getattr(item_meta, "common_mistake", None),
        },
    )


@app.get("/attempts", response_model=List[AttemptOut])
def list_attempts(
    user_id: str,
    domain: Optional[str] = None,
    skill: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(Attempt).filter(Attempt.user_id == user_id)
    if domain:
        q = q.filter(Attempt.domain == domain)
    if skill:
        q = q.filter(Attempt.skill == skill)
    rows = q.order_by(Attempt.id.desc()).limit(200).all()
    return [
        AttemptOut(
            id=row.id,
            user_id=row.user_id,
            domain=row.domain,
            skill=row.skill,
            seed=row.seed,
            correct=row.correct,
            correct_answer=row.correct_answer,
        )
        for row in rows
    ]


@app.get("/stats")
def stats(
    user_id: str,
    db: Session = Depends(get_db),
):
    from sqlalchemy import Integer, func

    rows = (
        db.query(
            Attempt.skill,
            func.count(Attempt.id),
            func.sum(func.cast(Attempt.correct, Integer)),
            func.avg(Attempt.time_ms),
        )
        .filter(Attempt.user_id == user_id)
        .group_by(Attempt.skill)
        .all()
    )
    out = {}
    for skill, n, n_correct, avg_time in rows:
        total = int(n or 0)
        correct = int(n_correct or 0)
        acc = (correct / total) if total else 0.0
        out[skill] = {
            "attempts": total,
            "correct": correct,
            "accuracy": acc,
            "avg_time_s": float((avg_time or 0) / 1000.0),
        }

    # also provide per-difficulty aggregates under a namespaced key
    rows2 = (
        db.query(
            Attempt.skill,
            Attempt.difficulty,
            func.count(Attempt.id),
            func.sum(func.cast(Attempt.correct, Integer)),
            func.avg(Attempt.time_ms),
        )
        .filter(Attempt.user_id == user_id)
        .group_by(Attempt.skill, Attempt.difficulty)
        .all()
    )
    by_diff: dict = {}
    for skill, diff, n, n_correct, avg_time in rows2:
        if skill not in by_diff:
            by_diff[skill] = {}
        total = int(n or 0)
        correct = int(n_correct or 0)
        acc = (correct / total) if total else 0.0
        by_diff[skill][diff or "unknown"] = {
            "attempts": total,
            "correct": correct,
            "accuracy": acc,
            "avg_time_s": float((avg_time or 0) / 1000.0),
        }
    # per-source (ai vs template) aggregates
    rows3 = (
        db.query(
            Attempt.skill,
            Attempt.source,
            func.count(Attempt.id),
            func.sum(func.cast(Attempt.correct, Integer)),
            func.avg(Attempt.time_ms),
        )
        .filter(Attempt.user_id == user_id)
        .group_by(Attempt.skill, Attempt.source)
        .all()
    )
    by_src: dict = {}
    for skill, src, n, n_correct, avg_time in rows3:
        if skill not in by_src:
            by_src[skill] = {}
        total = int(n or 0)
        correct = int(n_correct or 0)
        acc = (correct / total) if total else 0.0
        key = src or "unknown"
        by_src[skill][key] = {
            "attempts": total,
            "correct": correct,
            "accuracy": acc,
            "avg_time_s": float((avg_time or 0) / 1000.0),
        }

    return {**out, "__by_difficulty": by_diff, "__by_source": by_src}


@app.post("/estimate", response_model=EstimateResponse)
def estimate(req: EstimateRequest):
    score, ci, p_mean = estimate_math_sat(req.correct, req.total)
    return EstimateResponse(score=score, ci68=ci, p_mean=p_mean)


@app.post("/reset_stats", response_model=ResetStatsResponse)
def reset_stats(req: ResetStatsRequest, db: Session = Depends(get_db)):
    q = db.query(Attempt).filter(Attempt.user_id == req.user_id)
    if req.domain:
        q = q.filter(Attempt.domain == req.domain)
    if req.skill:
        q = q.filter(Attempt.skill == req.skill)
    # Count first, then delete
    to_delete = q.count()
    q.delete(synchronize_session=False)
    db.commit()
    return ResetStatsResponse(ok=True, deleted=int(to_delete))


@app.post("/next", response_model=NextResponse)
def next_item(req: NextRequest, db: Session = Depends(get_db)):
    # Simple rule engine v1: default medium; bump up on 2-correct and fast; down on wrong or two slow
    target_domain = req.domain
    target_skill = req.skill
    q = db.query(Attempt).filter(Attempt.user_id == req.user_id)
    if target_domain:
        q = q.filter(Attempt.domain == target_domain)
    if target_skill:
        q = q.filter(Attempt.skill == target_skill)
    recent = q.order_by(Attempt.id.desc()).limit(5).all()
    # Defaults
    difficulty = "medium"
    # Compute simple signals
    last_two = recent[:2]
    two_correct = len(last_two) == 2 and all(bool(r.correct) for r in last_two)
    slow_count = sum(1 for r in last_two if (r.time_ms or 0) > 20000)
    any_wrong = any(not bool(r.correct) for r in last_two)
    if two_correct and slow_count == 0:
        difficulty = "hard"
    if any_wrong or slow_count >= 2:
        difficulty = "easy"
    return NextResponse(domain=target_domain, skill=target_skill, difficulty=difficulty)


@app.post("/attempt_ai", response_model=AttemptAIResponse)
def attempt_ai(req: AttemptAIRequest, db: Session = Depends(get_db)):
    # Persist AI attempt with a synthetic seed of -1 (AI-generated)
    correct = bool(req.selected_choice_index == req.correct_index)
    db_attempt = Attempt(
        user_id=req.user_id or "anonymous",
        domain=req.domain,
        skill=req.skill,
        seed=req.seed if (req.seed is not None) else -1,
        correct=correct,
        correct_answer=str(req.correct_answer or ""),
        source="ai",
        time_ms=(req.time_ms if (hasattr(req, "time_ms") and req.time_ms) else None),
        difficulty=(req.difficulty if hasattr(req, "difficulty") else None),
    )
    db.add(db_attempt)
    db.commit()
    return AttemptAIResponse(ok=True, correct=correct)


@app.post("/generate_ai", response_model=GenerateAIResponse)
def generate_ai(req: GenerateAIRequest):
    def _fallback_mc() -> GenerateAIResponse:
        # Fallback to a safe template-based item, matching requested skill
        # when possible
        seed = random.randint(1, 10_000_000)
        try:
            # guardrail logging context (reserved for future structured logging)
            if req.domain == "Geometry" and req.skill == "pythagorean_hypotenuse":
                item = generate_pythagorean_hypotenuse(seed)
                # Convert to a well-formed MC with 4 choices
                sol = str(item.solution_str)
                choices = [
                    sol,
                    str(int(sol) + 1),
                    str(int(sol) - 1),
                    str(int(sol) + 2),
                ]
                return GenerateAIResponse(
                    prompt_latex=item.prompt_latex,
                    choices=choices,
                    correct_index=0,
                    explanation_steps=item.explanation_steps,
                    diagram=getattr(item, "diagram", None),
                    hints=(
                        item.explanation_steps[:2] if item.explanation_steps else None
                    ),
                )
            if req.domain == "Geometry" and req.skill == "pythagorean_leg":
                item = generate_pythagorean_leg(seed)
                sol = str(item.solution_str)
                choices = [
                    sol,
                    str(int(sol) + 1),
                    str(int(sol) - 1),
                    str(int(sol) + 2),
                ]
                return GenerateAIResponse(
                    prompt_latex=item.prompt_latex,
                    choices=choices,
                    correct_index=0,
                    explanation_steps=item.explanation_steps,
                    diagram=getattr(item, "diagram", None),
                    hints=(
                        item.explanation_steps[:2] if item.explanation_steps else None
                    ),
                )
            if req.domain == "Geometry" and req.skill == "rectangle_area":
                item = generate_rectangle_area(seed)
                sol = int(item.solution_str)
                choices = [
                    str(sol),
                    str(sol + 2),
                    str(max(1, sol - 3)),
                    str(sol + 5),
                ]
                return GenerateAIResponse(
                    prompt_latex=item.prompt_latex,
                    choices=choices,
                    correct_index=0,
                    explanation_steps=item.explanation_steps,
                    hints=(
                        item.explanation_steps[:2] if item.explanation_steps else None
                    ),
                )
            if req.domain == "Geometry" and req.skill == "rectangle_perimeter":
                item = generate_rectangle_perimeter(seed)
                sol = int(item.solution_str)
                choices = [
                    str(sol),
                    str(sol + 2),
                    str(max(1, sol - 4)),
                    str(sol + 6),
                ]
                return GenerateAIResponse(
                    prompt_latex=item.prompt_latex,
                    choices=choices,
                    correct_index=0,
                    explanation_steps=item.explanation_steps,
                    hints=(
                        item.explanation_steps[:2] if item.explanation_steps else None
                    ),
                )
            if req.domain == "Geometry" and req.skill == "triangle_angle":
                item = generate_triangle_interior_angle(seed)
                sol = int(item.solution_str)
                choices = [
                    str(sol),
                    str(max(1, sol - 10)),
                    str(sol + 5),
                    str(sol + 10),
                ]
                return GenerateAIResponse(
                    prompt_latex=item.prompt_latex,
                    choices=choices,
                    correct_index=0,
                    explanation_steps=item.explanation_steps,
                    hints=(
                        item.explanation_steps[:2] if item.explanation_steps else None
                    ),
                )
            if req.domain == "Algebra" and req.skill == "linear_system_2x2":
                item = generate_linear_system_2x2(seed)
                try:
                    sx_str, sy_str = str(item.solution_str).split(",")
                    sx = int(sx_str)
                    sy = int(sy_str)
                except Exception:
                    sx, sy = 0, 0
                distractors = [(sx + 1, sy), (sx, sy - 1), (sy, sx)]
                opts = [(sx, sy)] + distractors
                choices = [f"({x}, {y})" for (x, y) in opts]
                return GenerateAIResponse(
                    prompt_latex=item.prompt_latex,
                    choices=choices,
                    correct_index=0,
                    explanation_steps=item.explanation_steps,
                    hints=(
                        item.explanation_steps[:2] if item.explanation_steps else None
                    ),
                )
            if req.domain == "Advanced" and req.skill == "linear_system_3x3":
                from .generators import _parse_triple  # local helper

                item = generate_linear_system_3x3(seed)
                try:
                    sx, sy, sz = _parse_triple(item.solution_str)
                except Exception:
                    sx, sy, sz = 0, 0, 0
                distractors3 = [
                    (sx + 1, sy, sz),
                    (sx, sy - 1, sz),
                    (sy, sx, sz),
                ]
                opts3 = [(sx, sy, sz)] + distractors3
                choices = [f"({x}, {y}, {z})" for (x, y, z) in opts3]
                return GenerateAIResponse(
                    prompt_latex=item.prompt_latex,
                    choices=choices,
                    correct_index=0,
                    explanation_steps=item.explanation_steps,
                    hints=(
                        item.explanation_steps[:2] if item.explanation_steps else None
                    ),
                )
            if req.domain == "Advanced" and req.skill == "rational_equation":
                item = generate_rational_equation(seed)
                try:
                    sol = int(item.solution_str)
                except Exception:
                    sol = 0
                choices = [
                    str(sol),
                    str(sol + 1),
                    str(sol - 2),
                    str(sol + 3),
                ]
                return GenerateAIResponse(
                    prompt_latex=item.prompt_latex,
                    choices=choices,
                    correct_index=0,
                    explanation_steps=item.explanation_steps,
                )
            if req.domain == "Advanced" and req.skill == "quadratic_roots":
                item = generate_quadratic_roots(seed)
                try:
                    parts = str(item.solution_str).split(",")
                    r1 = int(parts[0])
                    r2 = int(parts[1])
                except Exception:
                    r1, r2 = 0, 0
                distractors2 = [
                    (r1 + 1, r2),
                    (r1, r2 - 1),
                    (-r1, -r2),
                ]
                opts2 = [(r1, r2)] + distractors2
                choices = [f"({a}, {b})" for (a, b) in opts2]
                return GenerateAIResponse(
                    prompt_latex=item.prompt_latex,
                    choices=choices,
                    correct_index=0,
                    explanation_steps=item.explanation_steps,
                )
            if req.domain == "Advanced" and req.skill == "exponential_solve":
                item = generate_exponential_solve(seed)
                try:
                    sol = int(item.solution_str)
                except Exception:
                    sol = 0
                choices = [str(sol), str(sol + 1), str(sol - 1), str(sol + 2)]
                return GenerateAIResponse(
                    prompt_latex=item.prompt_latex,
                    choices=choices,
                    correct_index=0,
                    explanation_steps=item.explanation_steps,
                )
            if req.domain == "PSD" and req.skill == "proportion":
                item = generate_proportion(seed)
                try:
                    sol = int(item.solution_str)
                except Exception:
                    sol = 0
                choices = [
                    str(sol),
                    str(sol + 1),
                    str(max(1, sol - 1)),
                    str(sol + 2),
                ]
                return GenerateAIResponse(
                    prompt_latex=item.prompt_latex,
                    choices=choices,
                    correct_index=0,
                    explanation_steps=item.explanation_steps,
                    hints=(
                        item.explanation_steps[:2] if item.explanation_steps else None
                    ),
                )
            if req.domain == "PSD" and req.skill == "unit_rate":
                item = generate_psd_unit_rate(seed)
                try:
                    sol = float(item.solution_str)
                except Exception:
                    sol = 0.0
                choices = [
                    f"{sol:.2f}",
                    f"{sol + 0.50:.2f}",
                    f"{max(0.01, sol - 0.25):.2f}",
                    f"{sol + 1.00:.2f}",
                ]
                return GenerateAIResponse(
                    prompt_latex=item.prompt_latex,
                    choices=choices,
                    correct_index=0,
                    explanation_steps=item.explanation_steps,
                    hints=(
                        item.explanation_steps[:2] if item.explanation_steps else None
                    ),
                )
        except Exception:
            # fall back to linear MC below
            pass
        item = generate_linear_equation_mc(seed)
        return GenerateAIResponse(
            prompt_latex=item.prompt_latex,
            choices=item.choices or ["1", "2", "3", "4"],
            correct_index=int(item.correct_index or 0),
            explanation_steps=item.explanation_steps,
            hints=(item.explanation_steps[:2] if item.explanation_steps else None),
        )

    # If AI is unavailable, immediately return fallback
    if not _HAS_GENAI:
        try:
            _log.warning(
                "ai_unavailable_fallback domain=%s skill=%s", req.domain, req.skill
            )
        except Exception:
            pass
        return _fallback_mc()

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        try:
            _log.warning(
                "no_api_key_fallback domain=%s skill=%s",
                req.domain,
                req.skill,
            )
        except Exception:
            pass
        return _fallback_mc()

    genai.configure(api_key=api_key)

    prompt = (
        "You are an expert DSAT Math question writer. "
        "Generate one medium-level multiple-choice question.\n"
        f"Domain: {req.domain}. Skill: {req.skill}.\n"
        "Return ONLY a compact JSON with keys: prompt_latex (KaTeX-ready), "
        "choices (array of 4 strings), correct_index (0-3), explanation_steps "
        "(array of 4-6 short steps).\n"
        "Important: In JSON strings, escape EVERY backslash in LaTeX as \\"
        "(e.g., \\frac, \\sqrt). No code fences or extra text."
    )

    model = genai.GenerativeModel(
        model_name="gemini-1.5-flash",
        generation_config={
            "response_mime_type": "application/json",
        },
    )
    try:
        resp = model.generate_content(prompt)
        text = (resp.text or "").strip()
        if text.startswith("```"):
            text = text.strip("`")
            text = text.replace("json", "", 1).strip()

        # First attempt to parse JSON
        try:
            data = json.loads(text)
        except json.JSONDecodeError as je:
            if "Invalid \\escape" in str(je):
                # Escape backslashes inside prompt_latex only, then reparse
                m = re.search(
                    r'("prompt_latex"\s*:\s*")(.*?)(")',
                    text,
                    flags=re.DOTALL,
                )
                if m:
                    start_idx, end_idx = m.start(2), m.end(2)
                    val = text[start_idx:end_idx]
                    val_fixed = val.replace("\\", "\\\\")
                    text = text[:start_idx] + val_fixed + text[end_idx:]
                data = json.loads(text)
            else:
                # Unrecoverable JSON — fallback
                try:
                    _log.warning(
                        "json_parse_fallback domain=%s skill=%s",
                        req.domain,
                        req.skill,
                    )
                except Exception:
                    pass
                return _fallback_mc()

        # Extract fields
        choices = data.get("choices") or []
        correct_index = int(data.get("correct_index", -1))
        steps = data.get("explanation_steps") or []
        hints = data.get("hints") or None
        prompt_latex = data.get("prompt_latex") or ""
        diagram = data.get("diagram") or None

        # Server-side validation
        def _ok_choice(s: str) -> bool:
            return isinstance(s, str) and 0 < len(s) <= 120

        valid = True
        if not (isinstance(choices, list) and len(choices) == 4):
            valid = False
        # normalize choices to strings and enforce uniqueness/length
        choices = [str(c) for c in choices]
        if not all(_ok_choice(c) for c in choices):
            valid = False
        if len(set(choices)) != 4:
            valid = False
        if not (isinstance(correct_index, int) and 0 <= correct_index < 4):
            valid = False
        if not (isinstance(prompt_latex, str) and 1 <= len(prompt_latex) <= 4000):
            valid = False
        # Disallow problematic commands that break KaTeX
        if re.search(
            r"\\label\{|\\begin\{document\}|\\end\{document\}",
            prompt_latex,
        ):
            valid = False
        # Explanation steps size cap and per-step length
        if not (isinstance(steps, list) and 1 <= len(steps) <= 10):
            valid = False
        else:
            if any((not isinstance(s, str)) or (len(s) > 240) for s in steps):
                valid = False

        # Skill-specific math/format validation
        try:
            import sympy as _sp

            if req.skill in (
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
                if not all(_sp.sympify(c, evaluate=False) is not None for c in choices):
                    valid = False
            if req.skill in ("linear_system_2x2", "quadratic_roots"):

                def _is_pair(s: str) -> bool:
                    t = s.strip()
                    return t.startswith("(") and t.endswith(")") and "," in t

                if not all(_is_pair(c) for c in choices):
                    valid = False
            if req.skill in ("linear_system_3x3",):

                def _is_triple(s: str) -> bool:
                    t = s.strip()
                    return t.startswith("(") and t.endswith(")") and t.count(",") == 2

                if not all(_is_triple(c) for c in choices):
                    valid = False
        except Exception:
            valid = False

        # Optional diagram validation (currently supports right_triangle)
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

        if not valid:
            try:
                _log.warning(
                    "validation_fallback domain=%s skill=%s",
                    req.domain,
                    req.skill,
                )
            except Exception:
                pass
            return _fallback_mc()

        # Return validated AI item
        # Build default explanation per skill
        def _ai_expl_defaults(sk: str) -> dict:
            mapping = {
                "linear_equation": {
                    "concept": "Linear equation; distribute and isolate x",
                    "plan": "Expand, move constants, divide to isolate x",
                    "quick_check": "Plug back to verify LHS = RHS",
                    "common_mistake": "Forgetting to distribute to all terms",
                },
                "two_step_equation": {
                    "concept": "Two-step linear equation",
                    "plan": "Undo addition/subtraction, then undo multiplication",
                    "quick_check": "Substitute x and check equality",
                    "common_mistake": "Dividing before moving the constant term",
                },
                "linear_system_2x2": {
                    "concept": "2×2 linear system",
                    "plan": "Eliminate one variable, then back-substitute",
                    "quick_check": "Plug (x, y) into both equations",
                    "common_mistake": "Adding equations with mismatched coefficients",
                },
                "linear_system_3x3": {
                    "concept": "3×3 linear system",
                    "plan": "Eliminate stepwise or use matrix methods",
                    "quick_check": "Verify all three equations hold",
                    "common_mistake": "Arithmetic errors during elimination",
                },
                "quadratic_roots": {
                    "concept": "Quadratic roots via factoring",
                    "plan": "Factor, set each factor to zero",
                    "quick_check": "Each root makes a factor zero",
                    "common_mistake": "Missing a root or mixing signs",
                },
                "exponential_solve": {
                    "concept": "Exponential equation; isolate and take logarithm",
                    "plan": "Isolate b^x, then apply log base b",
                    "quick_check": "Check a·b^x equals RHS",
                    "common_mistake": "Taking logs before isolating the exponential",
                },
                "rational_equation": {
                    "concept": "Rational equation; clear denominators",
                    "plan": "Multiply by LCD, solve resulting equation",
                    "quick_check": "Plug solution; discard extraneous",
                    "common_mistake": "Not multiplying every term by the LCD",
                },
                "proportion": {
                    "concept": "Proportion; cross-multiplication",
                    "plan": "Cross-multiply, then isolate",
                    "quick_check": "Verify a/b = x/c",
                    "common_mistake": "Multiplying only one side",
                },
                "unit_rate": {
                    "concept": "Unit rate (cost per item)",
                    "plan": "Divide total cost by number of items",
                    "quick_check": "Sanity-check magnitude",
                    "common_mistake": "Dividing items by cost",
                },
                "pythagorean_hypotenuse": {
                    "concept": "Right triangle; Pythagorean theorem",
                    "plan": "Square legs, add, square root",
                    "quick_check": "a^2 + b^2 = c^2",
                    "common_mistake": "Adding legs without squaring",
                },
                "pythagorean_leg": {
                    "concept": "Right triangle; c^2 - a^2 = b^2",
                    "plan": "Square hypotenuse and leg, subtract, root",
                    "quick_check": "c^2 - known^2 = leg^2",
                    "common_mistake": "Subtracting in wrong order",
                },
                "rectangle_area": {
                    "concept": "Area of rectangle",
                    "plan": "Multiply width by height",
                    "quick_check": "Units square; w×h",
                    "common_mistake": "Adding sides instead of multiplying",
                },
                "rectangle_perimeter": {
                    "concept": "Perimeter of rectangle",
                    "plan": "Add width and height, ×2",
                    "quick_check": "Units linear; 2(w+h)",
                    "common_mistake": "Using area formula",
                },
                "triangle_angle": {
                    "concept": "Triangle interior angles sum to 180°",
                    "plan": "Subtract known angles from 180°",
                    "quick_check": "A+B+C=180°",
                    "common_mistake": "Adding instead of subtracting",
                },
            }
            return mapping.get(sk, {})

        return GenerateAIResponse(
            prompt_latex=str(prompt_latex),
            choices=[str(c) for c in choices],
            correct_index=int(correct_index),
            explanation_steps=[str(s) for s in steps],
            diagram=diagram_out,
            hints=(
                hints
                if hints
                else (
                    [str(steps[0])] + ([str(steps[1])] if len(steps) > 1 else [])
                    if steps
                    else None
                )
            ),
            explanation=_ai_expl_defaults(req.skill or ""),
        )
    except Exception:
        # Any unexpected error — safe fallback
        return _fallback_mc()
