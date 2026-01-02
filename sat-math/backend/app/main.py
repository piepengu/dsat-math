import json
import logging
import os
import random
import re
import sys
import time as _time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from datetime import datetime, timedelta, timezone
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
    grade_psd_unit_rate,
    grade_pythagorean_hypotenuse,
    grade_pythagorean_leg,
    grade_quadratic_roots,
    grade_rational_equation,
    grade_rectangle_area,
    grade_rectangle_perimeter,
    grade_triangle_interior_angle,
    grade_two_step_equation,
)
from .guardrails import validate_ai_payload, validate_elaboration_payload
from .models import Attempt
from .schemas import (
    AchievementsResponse,
    AttemptAIRequest,
    AttemptAIResponse,
    AttemptOut,
    ElaborateRequest,
    ElaborateResponse,
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
    StreaksResponse,
)

try:
    from zoneinfo import ZoneInfo
except Exception:  # Python <3.9 fallback (not expected here)
    ZoneInfo = None

try:
    import google.generativeai as genai

    _HAS_GENAI = True
except Exception:
    _HAS_GENAI = False

app = FastAPI()

# Guardrails metrics (process lifetime)
app.state.guardrails_metrics = {
    "ai_calls_total": 0,
    "validated_ok_total": 0,
    "validation_failed_total": 0,
    "fallback_total": 0,
    "unsafe_latex_total": 0,
    "over_length_total": 0,
}
app.state.elaborate_calls_total = 0

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

# AI model caching infrastructure (Phase 1 optimization)
if _HAS_GENAI:
    import time as _cache_time

    # Cache model discovery results (TTL: 300 seconds = 5 minutes)
    _model_cache_ttl = 300
    _model_discovery_cache: dict = {"models": [], "timestamp": 0}
    _model_instance_cache: dict = {}  # model_name -> model_instance

    def _get_cached_models() -> list:
        """Get cached model list or refresh if expired."""
        now = _cache_time.time()
        if now - _model_discovery_cache["timestamp"] > _model_cache_ttl:
            try:
                api_key = os.getenv("GEMINI_API_KEY")
                if api_key:
                    try:
                        genai.configure(api_key=api_key, api_version="v1")
                    except Exception:
                        genai.configure(api_key=api_key)
                    _model_discovery_cache["models"] = list(genai.list_models())
                    _model_discovery_cache["timestamp"] = now
            except Exception:
                pass
        return _model_discovery_cache["models"]

    def _get_model_instance(model_name: str, api_key: str) -> any:
        """Get cached model instance or create new one."""
        if model_name not in _model_instance_cache:
            try:
                # Ensure API is configured
                try:
                    genai.configure(api_key=api_key, api_version="v1")
                except Exception:
                    genai.configure(api_key=api_key)
                _model_instance_cache[model_name] = genai.GenerativeModel(
                    model_name=model_name,
                    generation_config={
                        "response_mime_type": "application/json",
                        "max_output_tokens": 1024,  # Reduced from 2048 for faster responses
                        "temperature": 0.7,  # Consistent but creative
                    },
                )
            except Exception:
                return None
        return _model_instance_cache.get(model_name)

else:
    _get_cached_models = lambda: []
    _get_model_instance = lambda name, api_key: None


# Pre-warm AI model cache on startup (Phase 2 optimization)
@app.on_event("startup")
async def startup_event():
    """Pre-warm model cache on server startup for faster first request."""
    if _HAS_GENAI:
        try:
            api_key = os.getenv("GEMINI_API_KEY")
            if api_key:
                _log.info("Pre-warming AI model cache...")
                # Pre-warm model discovery cache
                _get_cached_models()
                # Pre-warm primary model instance (prioritize fastest)
                preferred_order = [
                    "gemini-2.5-flash-lite",  # Fastest model
                    "gemini-2.5-flash",
                    "gemini-1.5-flash",
                ]
                for model_name in preferred_order[:1]:  # Just pre-warm the first one
                    try:
                        _get_model_instance(model_name, api_key)
                        _log.info("Pre-warmed model: %s", model_name)
                        break
                    except Exception:
                        continue
        except Exception as e:
            _log.warning("Failed to pre-warm model cache: %s", str(e)[:100])


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
    try:
        gm = getattr(app.state, "guardrails_metrics", {})
        return {
            "ok": True,
            "guardrails": gm,
            "elaborate_calls": app.state.elaborate_calls_total,
            "python_version": sys.version,
        }
    except Exception:
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
    elif req.domain == "PSD" and req.skill == "unit_rate":
        item = generate_psd_unit_rate(seed)
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
    elif req.domain == "PSD" and req.skill == "unit_rate":
        correct, sol, steps = grade_psd_unit_rate(
            req.seed,
            req.user_answer,
        )
        from .generators import generate_psd_unit_rate as _gen

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
            (req.selected_choice_index if req.selected_choice_index is not None else -1),
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
            created_at=datetime.now(timezone.utc),
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
        created_at=datetime.now(timezone.utc),
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
        created_at=datetime.now(timezone.utc),
    )
    db.add(db_attempt)
    db.commit()
    return AttemptAIResponse(ok=True, correct=correct)


@app.post("/elaborate", response_model=ElaborateResponse)
def elaborate(req: ElaborateRequest):
    try:
        app.state.elaborate_calls_total += 1
    except Exception:
        pass
    # In-memory rate limit: 3/min and 20/day per user_id
    import time as _time

    from fastapi import HTTPException as _HTTPException

    user_id = (req.user_id or "anonymous").strip() or "anonymous"
    now = _time.time()
    minute_bucket = int(now // 60)
    day_bucket = int(now // 86400)
    if not hasattr(app.state, "_elab_quota"):
        app.state._elab_quota = {}
    qb = app.state._elab_quota
    min_key = (user_id, minute_bucket)
    day_key = (user_id, day_bucket)
    qb[min_key] = qb.get(min_key, 0) + 1
    qb[day_key] = qb.get(day_key, 0) + 1
    if qb[min_key] > 3 or qb[day_key] > 20:
        raise _HTTPException(status_code=429, detail={"error": "quota_exceeded"})

    start = _time.perf_counter()

    def _fallback_stub() -> ElaborateResponse:
        walkthrough = req.steps[:3] if isinstance(req.steps, list) else []
        draft = {
            "concept": "Decompose the problem and apply the relevant rule.",
            "plan": "Identify givens, choose a method, compute carefully, then verify.",
            "walkthrough": walkthrough
            or [
                "Restate the question in your own words.",
                "Write the key equation or relation.",
                "Compute step by step and check the result.",
            ],
            "quick_check": "Plug the result back or compare units/magnitude.",
            "common_mistake": "Skipping isolating the variable before computing.",
        }
        ok, cleaned, reasons, flags = validate_elaboration_payload(draft)
        if not ok:
            cleaned = {
                k: (cleaned.get(k) or None) for k in ["concept", "plan", "walkthrough", "quick_check", "common_mistake"]
            }
        ms = int((_time.perf_counter() - start) * 1000)
        return ElaborateResponse(
            elaboration=cleaned,
            usage_ms=ms,
            guardrails={"blocked": False, "reasons": reasons, "flags": flags},
        )

    if not _HAS_GENAI:
        return _fallback_stub()
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return _fallback_stub()

    try:
        # Configure API once (cached via helper)
        try:
            genai.configure(api_key=api_key, api_version="v1")
        except Exception:
            genai.configure(api_key=api_key)

        prompt = (
            "You are a helpful DSAT math tutor. Given the problem context and a user's question, "
            "return STRICT JSON with keys: concept (string), plan (string), walkthrough (array of 3-6 short strings), "
            "quick_check (string), common_mistake (string). All content must be KaTeX-friendly (no dangerous commands).\n"
            f"Domain: {req.domain or ''}. Skill: {req.skill or ''}. Difficulty: {req.difficulty or ''}.\n"
            f"Prompt LaTeX: {req.prompt_latex}\n"
            f"Steps: {(req.steps or [])}\n"
            f"Correct answer: {req.correct_answer or ''}\n"
            f"User question: {req.user_question}\n"
            "Return ONLY JSON."
        )

        def _supports_generate(m) -> bool:
            methods = getattr(m, "supported_generation_methods", []) or []
            return "generateContent" in methods or "generate_content" in methods

        def _name_suffix(n: str) -> str:
            return n.split("/")[-1] if "/" in n else n

        # Phase 2: Prioritize gemini-2.5-flash-lite for fastest responses
        preferred_order = [
            "gemini-2.5-flash-lite",  # Fastest model - prioritize for speed
            "gemini-2.5-flash",
            "gemini-1.5-flash",
            "gemini-1.5-flash-001",
            "gemini-1.5-flash-latest",
        ]

        # Use cached model discovery
        available_models = _get_cached_models()

        candidate_names = []
        # Add preferred if present in list_models
        for pref in preferred_order:
            for m in available_models:
                n = _name_suffix(getattr(m, "name", ""))
                if pref in n and _supports_generate(m):
                    candidate_names.append(n)
                    break

        # Fallback to static preferences if list_models returned nothing
        if not candidate_names:
            candidate_names = preferred_order[:]

        # Try first candidate with cached model instance (Phase 1 optimization)
        model_name = candidate_names[0] if candidate_names else None
        if model_name:
            try:
                model_instance = _get_model_instance(model_name, api_key)
                if model_instance:
                    _log.info("elab_model_use name=%s domain=%s skill=%s", model_name, req.domain, req.skill)
                    # Add 30s timeout with fallback
                    try:
                        with ThreadPoolExecutor(max_workers=1) as executor:
                            future = executor.submit(model_instance.generate_content, prompt)
                            resp = future.result(timeout=30.0)  # 30 second timeout
                    except FutureTimeoutError:
                        _log.warning(
                            "elab_timeout name=%s domain=%s skill=%s",
                            model_name,
                            req.domain,
                            req.skill,
                        )
                        return _fallback_stub()
                else:
                    # Fallback: try building fresh instance with optimized config
                    model_instance = genai.GenerativeModel(
                        model_name=model_name,
                        generation_config={
                            "response_mime_type": "application/json",
                            "max_output_tokens": 1024,  # Reduced for faster responses
                            "temperature": 0.7,
                        },
                    )
                    # Add timeout for fallback instance too
                    try:
                        with ThreadPoolExecutor(max_workers=1) as executor:
                            future = executor.submit(model_instance.generate_content, prompt)
                            resp = future.result(timeout=30.0)
                    except FutureTimeoutError:
                        _log.warning(
                            "elab_timeout_fallback name=%s domain=%s skill=%s",
                            model_name,
                            req.domain,
                            req.skill,
                        )
                        return _fallback_stub()
            except Exception as e:
                _log.warning(
                    "elab_model_failed name=%s domain=%s skill=%s err=%s",
                    model_name,
                    req.domain,
                    req.skill,
                    str(e)[:120],
                )
                return _fallback_stub()
        else:
            return _fallback_stub()

        # Handle empty responses (safety filters, quota limits, etc.)
        try:
            text = (resp.text or "").strip()
        except (ValueError, AttributeError) as ve:
            # finish_reason 2 = SAFETY or empty response
            _log.warning(
                "elab_empty_response domain=%s skill=%s finish_reason=%s err=%s",
                req.domain,
                req.skill,
                getattr(resp.candidates[0] if resp.candidates else None, "finish_reason", "unknown"),
                str(ve)[:120],
            )
            return _fallback_stub()

        if text.startswith("```"):
            text = text.strip("`")
            text = text.replace("json", "", 1).strip()
        # First attempt parse
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            # Minimal cleanup for common fence/escape issues
            text = text.replace("\\n", " ")
            data = json.loads(text)

        ok, cleaned, reasons, flags = validate_elaboration_payload(data or {})
        if not ok:
            return _fallback_stub()
        ms = int((_time.perf_counter() - start) * 1000)
        return ElaborateResponse(
            elaboration=cleaned,
            usage_ms=ms,
            guardrails={"blocked": False, "reasons": reasons, "flags": flags},
        )
    except Exception:
        _log.exception("elab_unhandled_error domain=%s skill=%s", req.domain, req.skill)
        return _fallback_stub()


@app.post("/generate_ai", response_model=GenerateAIResponse)
def generate_ai(req: GenerateAIRequest):
    try:
        app.state.guardrails_metrics["ai_calls_total"] += 1
    except Exception:
        pass

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
                    hints=(item.explanation_steps[:2] if item.explanation_steps else None),
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
                    hints=(item.explanation_steps[:2] if item.explanation_steps else None),
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
                    hints=(item.explanation_steps[:2] if item.explanation_steps else None),
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
                    hints=(item.explanation_steps[:2] if item.explanation_steps else None),
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
                    diagram=getattr(item, "diagram", None),
                    hints=(item.explanation_steps[:2] if item.explanation_steps else None),
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
                    hints=(item.explanation_steps[:2] if item.explanation_steps else None),
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
                    hints=(item.explanation_steps[:2] if item.explanation_steps else None),
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
                    hints=(item.explanation_steps[:2] if item.explanation_steps else None),
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
                    hints=(item.explanation_steps[:2] if item.explanation_steps else None),
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
            _log.warning("ai_unavailable_fallback domain=%s skill=%s", req.domain, req.skill)
            app.state.guardrails_metrics["fallback_total"] += 1
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
            app.state.guardrails_metrics["fallback_total"] += 1
        except Exception:
            pass
        return _fallback_mc()

    # Prefer stable v1 API; avoids v1beta model availability issues
    try:
        genai.configure(api_key=api_key, api_version="v1")
    except Exception:
        genai.configure(api_key=api_key)

    # Optimized prompt: shorter, more direct, reduces token usage
    # Critical: choices must be pure math expressions parseable by SymPy (numbers, fractions, etc.)
    # No units, no text - just math: "5", "\\frac{3}{2}", "-7", etc.
    prompt = (
        f"DSAT Math: {req.domain} - {req.skill}. "
        "Generate one medium multiple-choice question.\n"
        "JSON only: {prompt_latex: string (KaTeX), choices: [4 strings], "
        "correct_index: 0-3, explanation_steps: [4-6 short steps]}.\n"
        "CRITICAL: choices must be pure math expressions (numbers, fractions, decimals) - NO text, NO units. "
        "Examples: '5', '\\frac{3}{2}', '-7', '12.5'. Use LaTeX for fractions: \\frac{{numerator}}{{denominator}}.\n"
        "Escape backslashes in LaTeX (\\frac, \\sqrt). No code fences."
    )

    def _supports_generate(m) -> bool:
        methods = getattr(m, "supported_generation_methods", []) or []
        return "generateContent" in methods or "generate_content" in methods

    def _name_suffix(n: str) -> str:
        return n.split("/")[-1] if "/" in n else n

    # Phase 2: Prioritize gemini-2.5-flash-lite for fastest responses
    preferred_order = [
        "gemini-2.5-flash-lite",  # Fastest model - prioritize for speed
        "gemini-2.5-flash",
        "gemini-1.5-flash",
        "gemini-1.5-flash-001",
        "gemini-1.5-flash-latest",
    ]

    # Use cached model discovery
    available_models = _get_cached_models()

    candidate_names = []
    # Add preferred if present in list_models
    for pref in preferred_order:
        for m in available_models:
            n = _name_suffix(getattr(m, "name", ""))
            if pref in n and _supports_generate(m):
                candidate_names.append(n)
                break

    # Fallback to static preferences if list_models returned nothing
    if not candidate_names:
        candidate_names = preferred_order[:]

    # Try first candidate with cached model instance (Phase 1 optimization)
    model_name = candidate_names[0] if candidate_names else None
    if model_name:
        try:
            start_time = _time.perf_counter()
            model_instance = _get_model_instance(model_name, api_key)
            if model_instance:
                _log.info("ai_model_use name=%s domain=%s skill=%s", model_name, req.domain, req.skill)
                # Add 30s timeout with fallback
                try:
                    with ThreadPoolExecutor(max_workers=1) as executor:
                        future = executor.submit(model_instance.generate_content, prompt)
                        resp = future.result(timeout=30.0)  # 30 second timeout
                except FutureTimeoutError:
                    _log.warning(
                        "ai_timeout name=%s domain=%s skill=%s",
                        model_name,
                        req.domain,
                        req.skill,
                    )
                    try:
                        app.state.guardrails_metrics["fallback_total"] += 1
                    except Exception:
                        pass
                    return _fallback_mc()
            else:
                # Fallback: try building fresh instance with optimized config
                model_instance = genai.GenerativeModel(
                    model_name=model_name,
                    generation_config={
                        "response_mime_type": "application/json",
                        "max_output_tokens": 1024,  # Reduced for faster responses
                        "temperature": 0.7,
                    },
                )
                # Add timeout for fallback instance too
                try:
                    with ThreadPoolExecutor(max_workers=1) as executor:
                        future = executor.submit(model_instance.generate_content, prompt)
                        resp = future.result(timeout=30.0)
                except FutureTimeoutError:
                    _log.warning(
                        "ai_timeout_fallback name=%s domain=%s skill=%s",
                        model_name,
                        req.domain,
                        req.skill,
                    )
                    try:
                        app.state.guardrails_metrics["fallback_total"] += 1
                    except Exception:
                        pass
                    return _fallback_mc()

            # Log timing
            elapsed_ms = int((_time.perf_counter() - start_time) * 1000)
            _log.info(
                "ai_generate_time_ms name=%s domain=%s skill=%s time_ms=%d",
                model_name,
                req.domain,
                req.skill,
                elapsed_ms,
            )
        except Exception as e:
            try:
                _log.warning(
                    "ai_model_failed name=%s domain=%s skill=%s err=%s",
                    model_name,
                    req.domain,
                    req.skill,
                    str(e)[:120],
                )
                app.state.guardrails_metrics["fallback_total"] += 1
            except Exception:
                pass
            return _fallback_mc()
    else:
        try:
            app.state.guardrails_metrics["fallback_total"] += 1
        except Exception:
            pass
        return _fallback_mc()

    try:
        # Handle empty responses (safety filters, quota limits, etc.)
        try:
            text = (resp.text or "").strip()
        except (ValueError, AttributeError) as ve:
            # finish_reason 2 = SAFETY or empty response
            _log.warning(
                "ai_empty_response domain=%s skill=%s finish_reason=%s err=%s",
                req.domain,
                req.skill,
                getattr(resp.candidates[0] if resp.candidates else None, "finish_reason", "unknown"),
                str(ve)[:120],
            )
            try:
                app.state.guardrails_metrics["validation_failed_total"] += 1
                app.state.guardrails_metrics["fallback_total"] += 1
            except Exception:
                pass
            return _fallback_mc()

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
                    app.state.guardrails_metrics["validation_failed_total"] += 1
                    app.state.guardrails_metrics["fallback_total"] += 1
                except Exception:
                    pass
                return _fallback_mc()

        # Light normalization of choices before validation to satisfy expected formats
        def _normalize_choices(skill: str, vals: list) -> list:
            out: list[str] = []
            for c in (vals or [])[:4]:
                s = str(c).strip()
                # Common bracket fixes and separators
                s = s.replace("[", "(").replace("]", ")").replace("{", "(").replace("}", ")")
                s = s.replace(";", ",")
                s = re.sub(r"\s*,\s*", ", ", s)
                if skill in ("linear_system_2x2", "quadratic_roots"):
                    # Ensure pair format: (a, b)
                    if "," in s:
                        if not (s.startswith("(") and s.endswith(")")):
                            s = f"({s})"
                    else:
                        # Try to coerce space/and separated into a pair
                        parts = re.split(r"\s+and\s+|\s+", s)
                        parts = [p for p in parts if p]
                        if len(parts) == 2:
                            s = f"({parts[0]}, {parts[1]})"
                        else:
                            # As a last resort, create a benign pair
                            s = f"({s}, 0)"
                if skill in ("linear_system_3x3",):
                    # Ensure triple: (a, b, c)
                    if s.count(",") == 2 and not (s.startswith("(") and s.endswith(")")):
                        s = f"({s})"
                out.append(s)

            # Ensure 4 choices by repeating last if fewer
            while len(out) < 4:
                out.append(out[-1] if out else "0")

            # Enforce uniqueness (last-resort tweaks that preserve value semantics)
            seen: set[str] = set()
            for i, s in enumerate(out):
                t = s
                while t in seen:
                    if skill in (
                        "linear_equation",
                        "two_step_equation",
                        "exponential_solve",
                        "rational_equation",
                        "proportion",
                        "unit_rate",
                    ):
                        t = f"({s}) + 0"
                    elif skill in ("linear_system_2x2", "quadratic_roots") and s.startswith("(") and s.endswith(")"):
                        # Insert +0 inside the tuple on the last value: (a, b+0)
                        inner = s[1:-1]
                        parts = [p.strip() for p in inner.split(",")]
                        if len(parts) >= 2:
                            parts[-1] = parts[-1] + " + 0"
                            t = f"({', '.join(parts)})"
                        else:
                            t = f"({s}) + 0"
                    elif skill in ("linear_system_3x3",) and s.startswith("(") and s.endswith(")"):
                        inner = s[1:-1]
                        parts = [p.strip() for p in inner.split(",")]
                        if len(parts) >= 3:
                            parts[-1] = parts[-1] + " + 0"
                            t = f"({', '.join(parts)})"
                        else:
                            t = f"({s}) + 0"
                    else:
                        # For other skills, append a harmless +0 pattern
                        t = f"({s}) + 0"
                out[i] = t
                seen.add(t)
            return out[:4]

        if isinstance(data, dict):
            data["choices"] = _normalize_choices(req.skill or "", data.get("choices") or [])
            # Coerce correct_index into range [0,3]
            try:
                ci = int(data.get("correct_index", 0))
            except Exception:
                ci = 0
            if ci < 0 or ci >= 4:
                ci = 0
            data["correct_index"] = ci
            # Normalize explanation steps: 1..MAX_STEPS, each <= MAX_STEP_LEN
            raw_steps = data.get("explanation_steps") or []
            try:
                from .guardrails import MAX_STEP_LEN as _MAX_STEP_LEN
                from .guardrails import MAX_STEPS as _MAX_STEPS
            except Exception:
                _MAX_STEPS, _MAX_STEP_LEN = 8, 200
            norm_steps = []
            for s in raw_steps:
                try:
                    t = str(s).strip()
                    if len(t) > _MAX_STEP_LEN:
                        t = t[:_MAX_STEP_LEN]
                    if t:
                        norm_steps.append(t)
                except Exception:
                    continue
            if not norm_steps:
                norm_steps = [
                    "Identify givens and what is asked.",
                    "Compute step by step and verify.",
                ]
            data["explanation_steps"] = norm_steps[:_MAX_STEPS]

        # Guardrails v2 validation and metrics
        valid, cleaned, reasons, flags = validate_ai_payload(req.domain, req.skill, data)
        if not valid:
            try:
                _log.warning(
                    "validation_fallback domain=%s skill=%s reasons=%s",
                    req.domain,
                    req.skill,
                    ",".join(reasons) if reasons else "",
                )
                app.state.guardrails_metrics["validation_failed_total"] += 1
                if flags.get("unsafe_latex"):
                    app.state.guardrails_metrics["unsafe_latex_total"] += 1
                if flags.get("over_length"):
                    app.state.guardrails_metrics["over_length_total"] += 1
                app.state.guardrails_metrics["fallback_total"] += 1
            except Exception:
                pass
            return _fallback_mc()
        else:
            try:
                app.state.guardrails_metrics["validated_ok_total"] += 1
            except Exception:
                pass

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

        # Normalize prompt text to avoid letter-by-letter artifacts (e.g., "p l u s")
        def _normalize_prompt_text(s: str) -> str:
            try:
                t = str(s).replace("\n", " ").replace("\r", " ")
                t = re.sub(r"\s+", " ", t).strip()
                tokens = t.split(" ")
                out = []
                run: list = []
                for tok in tokens:
                    if len(tok) == 1 and tok.isalpha():
                        run.append(tok)
                    else:
                        if len(run) >= 2:
                            out.append("".join(run))
                        elif run:
                            out.extend(run)
                        run = []
                        out.append(tok)
                if len(run) >= 2:
                    out.append("".join(run))
                elif run:
                    out.extend(run)
                return " ".join(out)
            except Exception:
                return s

        cleaned["prompt_latex"] = _normalize_prompt_text(cleaned.get("prompt_latex", ""))
        # Normalize malformed inline LaTeX in choices (e.g., \frac(8)(5) → \frac{8}{5})
        try:
            fixed_choices = []
            for c in cleaned.get("choices", []):
                s = str(c)
                # Fix \frac(8)(5) → \frac{8}{5}
                s = re.sub(r"\\frac\s*\(\s*([^()]+?)\s*\)\s*\(\s*([^()]+?)\s*\)", r"\\frac{\1}{\2}", s)
                # Remove unnecessary braces around fractions: {\frac{a}{b}} → \frac{a}{b}
                s = re.sub(r"\{\\frac\{([^}]+)\}\{([^}]+)\}\}", r"\\frac{\1}{\2}", s)
                fixed_choices.append(s)
            cleaned["choices"] = fixed_choices
        except Exception:
            pass

        # Prepare hints separately to keep lines short and satisfy lint caps
        _steps = cleaned.get("explanation_steps") or []
        if cleaned.get("hints"):
            _hints = cleaned.get("hints")
        elif _steps:
            _hints = [str(_steps[0])] + ([str(_steps[1])] if len(_steps) > 1 else [])
        else:
            _hints = None

        return GenerateAIResponse(
            prompt_latex=str(cleaned.get("prompt_latex", "")),
            choices=[str(c) for c in cleaned.get("choices", [])],
            correct_index=int(cleaned.get("correct_index", 0)),
            explanation_steps=[str(s) for s in _steps],
            diagram=cleaned.get("diagram"),
            hints=_hints,
            explanation=_ai_expl_defaults(req.skill or ""),
        )
    except Exception:
        try:
            _log.exception("ai_unhandled_error domain=%s skill=%s", req.domain, req.skill)
            app.state.guardrails_metrics["validation_failed_total"] += 1
            app.state.guardrails_metrics["fallback_total"] += 1
        except Exception:
            pass
        return _fallback_mc()


@app.get("/streaks", response_model=StreaksResponse)
def streaks(user_id: str, db: Session = Depends(get_db)):
    tz = ZoneInfo("America/Chicago") if ZoneInfo else None
    now_utc = datetime.now(timezone.utc)
    now_ct = now_utc.astimezone(tz) if tz else now_utc
    today = now_ct.date()

    # Pull recent attempts (bounded) and aggregate by Central-date
    rows = (
        db.query(Attempt)
        .filter(Attempt.user_id == (user_id or "anonymous"))
        .order_by(Attempt.id.desc())
        .limit(2000)
        .all()
    )

    from collections import defaultdict

    per_day_counts = defaultdict(int)
    for r in rows:
        dt = getattr(r, "created_at", None)
        if not dt:
            continue
        if dt.tzinfo is None:
            dt_utc = dt.replace(tzinfo=timezone.utc)
        else:
            dt_utc = dt.astimezone(timezone.utc)
        dt_ct = dt_utc.astimezone(tz) if tz else dt_utc
        d = dt_ct.date()
        per_day_counts[d] += 1

    problems_solved_today = int(per_day_counts.get(today, 0))

    thresholds = [5, 10, 20, 50]
    badges_today = [f"daily_{n}" for n in thresholds if problems_solved_today >= n]

    # Current streak: consecutive days ending today with >=1 attempt
    cur_streak = 0
    cursor = today
    while per_day_counts.get(cursor, 0) > 0:
        cur_streak += 1
        cursor = cursor - timedelta(days=1)

    # Longest streak across available window
    longest = 0
    if per_day_counts:
        days_sorted = sorted(per_day_counts.keys())
        run = 0
        prev = None
        for d in days_sorted:
            if prev is None or d == prev + timedelta(days=1):
                run = run + 1 if prev is not None else 1
            else:
                if run > longest:
                    longest = run
                run = 1
            prev = d
        if run > longest:
            longest = run

    return StreaksResponse(
        user_id=(user_id or "anonymous"),
        current_streak_days=int(cur_streak),
        longest_streak_days=int(longest),
        problems_solved_today=problems_solved_today,
        badges_today=badges_today,
    )


@app.get("/achievements", response_model=AchievementsResponse)
def achievements(user_id: str, db: Session = Depends(get_db)):
    """Calculate user achievements based on their attempt history."""
    uid = user_id or "anonymous"

    # Get all attempts for the user, ordered by ID (which reflects chronological order)
    rows = db.query(Attempt).filter(Attempt.user_id == uid).order_by(Attempt.id.asc()).all()

    achievements_list = []

    # 1. First solve: Has at least one correct attempt
    has_correct = any(r.correct for r in rows)
    if has_correct:
        achievements_list.append("first_solve")

    # 2. Five correct streak: Check for 5 consecutive correct answers
    consecutive_correct = 0
    max_consecutive_correct = 0
    for r in rows:
        if r.correct:
            consecutive_correct += 1
            if consecutive_correct > max_consecutive_correct:
                max_consecutive_correct = consecutive_correct
        else:
            consecutive_correct = 0

    if max_consecutive_correct >= 5:
        achievements_list.append("five_correct_streak")

    # 3. Seven day streak: Use the streaks endpoint logic to check current streak
    tz = ZoneInfo("America/Chicago") if ZoneInfo else None
    now_utc = datetime.now(timezone.utc)
    now_ct = now_utc.astimezone(tz) if tz else now_utc
    today = now_ct.date()

    from collections import defaultdict

    per_day_counts = defaultdict(int)
    for r in rows:
        dt = getattr(r, "created_at", None)
        if not dt:
            continue
        if dt.tzinfo is None:
            dt_utc = dt.replace(tzinfo=timezone.utc)
        else:
            dt_utc = dt.astimezone(timezone.utc)
        dt_ct = dt_utc.astimezone(tz) if tz else dt_utc
        d = dt_ct.date()
        per_day_counts[d] += 1

    # Current streak: consecutive days ending today with >=1 attempt
    cur_streak = 0
    cursor = today
    while per_day_counts.get(cursor, 0) > 0:
        cur_streak += 1
        cursor = cursor - timedelta(days=1)

    if cur_streak >= 7:
        achievements_list.append("seven_day_streak")

    return AchievementsResponse(
        user_id=uid,
        achievements=achievements_list,
    )
