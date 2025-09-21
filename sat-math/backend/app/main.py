import json
import os
import re
import random
from typing import List, Optional

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from .db import Base, engine, get_db
from .estimator import estimate_math_sat
from .generators import (
    generate_exponential_solve,
    generate_linear_equation,
    generate_linear_equation_mc,
    generate_linear_system_2x2,
    generate_proportion,
    generate_pythagorean_hypotenuse,
    generate_pythagorean_leg,
    generate_quadratic_roots,
    generate_two_step_equation,
    grade_exponential_solve,
    grade_linear_equation,
    grade_linear_equation_mc,
    grade_linear_system_2x2,
    grade_proportion,
    grade_pythagorean_hypotenuse,
    grade_pythagorean_leg,
    grade_quadratic_roots,
    grade_two_step_equation,
)
from .models import Attempt
from .schemas import (
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)


Base.metadata.create_all(bind=engine)


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
    elif req.domain == "Algebra" and req.skill == "linear_equation_mc":
        item = generate_linear_equation_mc(seed)
    elif req.domain == "Advanced" and req.skill == "quadratic_roots":
        item = generate_quadratic_roots(seed)
    elif req.domain == "Advanced" and req.skill == "exponential_solve":
        item = generate_exponential_solve(seed)
    elif req.domain == "Geometry" and req.skill == "pythagorean_hypotenuse":
        item = generate_pythagorean_hypotenuse(seed)
    elif req.domain == "Geometry" and req.skill == "pythagorean_leg":
        item = generate_pythagorean_leg(seed)
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
    elif req.domain == "Algebra" and req.skill == "linear_equation_mc":
        correct, sol, steps, why_sel = grade_linear_equation_mc(
            req.seed,
            req.selected_choice_index if req.selected_choice_index is not None else -1,
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
    elif req.domain == "Geometry" and req.skill == "pythagorean_hypotenuse":
        correct, sol, steps = grade_pythagorean_hypotenuse(
            req.seed,
            req.user_answer,
        )
    elif req.domain == "Geometry" and req.skill == "pythagorean_leg":
        correct, sol, steps = grade_pythagorean_leg(req.seed, req.user_answer)
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
        )
        .filter(Attempt.user_id == user_id)
        .group_by(Attempt.skill)
        .all()
    )
    out = {}
    for skill, n, n_correct in rows:
        total = int(n or 0)
        correct = int(n_correct or 0)
        acc = (correct / total) if total else 0.0
        out[skill] = {"attempts": total, "correct": correct, "accuracy": acc}
    return out


@app.post("/estimate", response_model=EstimateResponse)
def estimate(req: EstimateRequest):
    score, ci, p_mean = estimate_math_sat(req.correct, req.total)
    return EstimateResponse(score=score, ci68=ci, p_mean=p_mean)


@app.post("/generate_ai", response_model=GenerateAIResponse)
def generate_ai(req: GenerateAIRequest):
    if not _HAS_GENAI:
        raise HTTPException(status_code=500, detail="AI not available on server")
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured")
    genai.configure(api_key=api_key)

    prompt = (
        "You are an expert DSAT Math question writer. Generate one medium-level multiple-choice question.\n"
        f"Domain: {req.domain}. Skill: {req.skill}.\n"
        "Return ONLY a compact JSON with keys: prompt_latex (KaTeX-ready), choices (array of 4 strings), correct_index (0-3), explanation_steps (array of 4-6 short steps).\n"
        "Important: In JSON strings, escape EVERY backslash in LaTeX as \\\\ (e.g., \\frac, \\sqrt). No code fences or extra text."
    )

    model = genai.GenerativeModel(model_name="gemini-1.5-flash")
    try:
        resp = model.generate_content(prompt)
        text = (resp.text or "").strip()
        if text.startswith("```"):
            text = text.strip("`")
            text = text.replace("json", "", 1).strip()
        try:
            data = json.loads(text)
        except json.JSONDecodeError as je:
            if "Invalid \\escape" in str(je):
                # Attempt to escape backslashes inside prompt_latex value only
                m = re.search(r'("prompt_latex"\s*:\s*")(.*?)(")', text, flags=re.DOTALL)
                if m:
                    start_idx, end_idx = m.start(2), m.end(2)
                    val = text[start_idx:end_idx]
                    val_fixed = val.replace('\\', '\\\\')
                    text = text[:start_idx] + val_fixed + text[end_idx:]
                data = json.loads(text)
            else:
                raise
        choices = data.get("choices") or []
        correct_index = int(data.get("correct_index", -1))
        steps = data.get("explanation_steps") or []
        prompt_latex = data.get("prompt_latex") or ""
        if not (
            isinstance(choices, list)
            and len(choices) == 4
            and 0 <= correct_index < 4
            and prompt_latex
        ):
            raise ValueError("Invalid AI response shape")
        return GenerateAIResponse(
            prompt_latex=prompt_latex,
            choices=list(map(str, choices)),
            correct_index=correct_index,
            explanation_steps=[str(s) for s in steps],
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI generation failed: {e}")
