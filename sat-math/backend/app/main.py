import json
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
    generate_pythagorean_hypotenuse,
    generate_pythagorean_leg,
    generate_rectangle_area,
    generate_rectangle_perimeter,
    generate_triangle_interior_angle,
    generate_quadratic_roots,
    generate_two_step_equation,
    grade_exponential_solve,
    grade_linear_equation,
    grade_linear_equation_mc,
    grade_linear_system_2x2,
    grade_linear_system_3x3,
    grade_proportion,
    grade_pythagorean_hypotenuse,
    grade_pythagorean_leg,
    grade_rectangle_area,
    grade_rectangle_perimeter,
    grade_triangle_interior_angle,
    grade_quadratic_roots,
    grade_two_step_equation,
    generate_rational_equation,
    grade_rational_equation,
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

# Lightweight migration for new analytics columns on SQLite
try:
    with engine.connect() as _conn:
        rows = _conn.exec_driver_sql(
            "PRAGMA table_info(attempts)"
        ).fetchall()
        existing = {r[1] for r in rows}
        if "source" not in existing:
            _conn.exec_driver_sql(
                "ALTER TABLE attempts ADD COLUMN source TEXT"
            )
        if "time_ms" not in existing:
            _conn.exec_driver_sql(
                "ALTER TABLE attempts ADD COLUMN time_ms INTEGER"
            )
        if "created_at" not in existing:
            _conn.exec_driver_sql(
                "ALTER TABLE attempts ADD COLUMN created_at DATETIME"
            )
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

    return GenerateResponse(
        domain=item.domain,
        skill=item.skill,
        format=item.format,
        seed=item.seed,
        prompt_latex=item.prompt_latex,
        choices=getattr(item, "choices", None),
        diagram=getattr(item, "diagram", None),
    )


@app.post("/grade", response_model=GradeResponse)
def grade_item(req: GradeRequest, db: Session = Depends(get_db)):
    if req.domain == "Algebra" and req.skill == "linear_equation":
        correct, sol, steps = grade_linear_equation(req.seed, req.user_answer)
    elif req.domain == "Algebra" and req.skill == "two_step_equation":
        correct, sol, steps = grade_two_step_equation(
            req.seed,
            req.user_answer,
        )
    elif req.domain == "PSD" and req.skill == "proportion":
        correct, sol, steps = grade_proportion(
            req.seed,
            req.user_answer,
        )
    elif req.domain == "Algebra" and req.skill == "linear_system_2x2":
        correct, sol, steps = grade_linear_system_2x2(
            req.seed,
            req.user_answer,
        )
    elif req.domain == "Advanced" and req.skill == "linear_system_3x3":
        correct, sol, steps = grade_linear_system_3x3(
            req.seed,
            req.user_answer,
        )
    elif req.domain == "Algebra" and req.skill == "linear_equation_mc":
        correct, sol, steps, why_sel = grade_linear_equation_mc(
            req.seed,
            (
                req.selected_choice_index
                if req.selected_choice_index is not None
                else -1
            ),
        )
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
        )
        db.add(db_attempt)
        db.commit()
        return GradeResponse(
            correct=correct,
            correct_answer=str(sol),
            explanation_steps=steps,
            why_correct="It satisfies the equation.",
            why_incorrect_selected=None if correct else why_sel,
        )
    elif req.domain == "Advanced" and req.skill == "quadratic_roots":
        correct, sol, steps = grade_quadratic_roots(req.seed, req.user_answer)
    elif req.domain == "Advanced" and req.skill == "exponential_solve":
        correct, sol, steps = grade_exponential_solve(
            req.seed,
            req.user_answer,
        )
    elif req.domain == "Advanced" and req.skill == "rational_equation":
        correct, sol, steps = grade_rational_equation(
            req.seed,
            req.user_answer,
        )
    elif req.domain == "Geometry" and req.skill == "pythagorean_hypotenuse":
        correct, sol, steps = grade_pythagorean_hypotenuse(
            req.seed,
            req.user_answer,
        )
    elif req.domain == "Geometry" and req.skill == "pythagorean_leg":
        correct, sol, steps = grade_pythagorean_leg(req.seed, req.user_answer)
    elif req.domain == "Geometry" and req.skill == "rectangle_area":
        correct, sol, steps = grade_rectangle_area(req.seed, req.user_answer)
    elif req.domain == "Geometry" and req.skill == "rectangle_perimeter":
        correct, sol, steps = grade_rectangle_perimeter(
            req.seed,
            req.user_answer,
        )
    elif req.domain == "Geometry" and req.skill == "triangle_angle":
        correct, sol, steps = grade_triangle_interior_angle(
            req.seed,
            req.user_answer,
        )
    else:
        correct, sol, steps = grade_linear_equation(req.seed, req.user_answer)

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
    )
    db.add(db_attempt)
    db.commit()

    return GradeResponse(
        correct=correct,
        correct_answer=str(sol),
        explanation_steps=steps,
        why_correct="It satisfies the equation.",
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
    return out


@app.post("/estimate", response_model=EstimateResponse)
def estimate(req: EstimateRequest):
    score, ci, p_mean = estimate_math_sat(req.correct, req.total)
    return EstimateResponse(score=score, ci68=ci, p_mean=p_mean)


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
        time_ms=(
            req.time_ms if (hasattr(req, "time_ms") and req.time_ms) else None
        ),
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
            if (
                req.domain == "Geometry"
                and req.skill == "pythagorean_hypotenuse"
            ):
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
        )

    # If AI is unavailable, immediately return fallback
    if not _HAS_GENAI:
        return _fallback_mc()

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
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
                return _fallback_mc()

        # Extract fields
        choices = data.get("choices") or []
        correct_index = int(data.get("correct_index", -1))
        steps = data.get("explanation_steps") or []
        prompt_latex = data.get("prompt_latex") or ""
        diagram = data.get("diagram") or None

        # Server-side validation
        def _ok_choice(s: str) -> bool:
            return isinstance(s, str) and 0 < len(s) <= 120

        valid = True
        if not (isinstance(choices, list) and len(choices) == 4):
            valid = False
        if not all(_ok_choice(str(c)) for c in choices):
            valid = False
        if not (isinstance(correct_index, int) and 0 <= correct_index < 4):
            valid = False
        if not (
            isinstance(prompt_latex, str) and 1 <= len(prompt_latex) <= 4000
        ):
            valid = False
        # Disallow problematic commands that break KaTeX
        if re.search(
            r"\\label\{|\\begin\{document\}|\\end\{document\}",
            prompt_latex,
        ):
            valid = False
        # Explanation steps size cap
        if not (isinstance(steps, list) and 1 <= len(steps) <= 10):
            valid = False

        # Optional diagram validation (currently supports right_triangle)
        diagram_out = None
        if (
            isinstance(diagram, dict)
            and diagram.get("type") == "right_triangle"
        ):
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
            return _fallback_mc()

        # Return validated AI item
        return GenerateAIResponse(
            prompt_latex=str(prompt_latex),
            choices=[str(c) for c in choices],
            correct_index=int(correct_index),
            explanation_steps=[str(s) for s in steps],
            diagram=diagram_out,
        )
    except Exception:
        # Any unexpected error — safe fallback
        return _fallback_mc()
