import random

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .estimator import estimate_math_sat
from .generators import (
    generate_linear_equation,
    generate_linear_system_2x2,
    generate_proportion,
    generate_two_step_equation,
    grade_linear_equation,
    grade_linear_system_2x2,
    grade_proportion,
    grade_two_step_equation,
)
from .schemas import (
    EstimateRequest,
    EstimateResponse,
    GenerateRequest,
    GenerateResponse,
    GradeRequest,
    GradeResponse,
)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)


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
    else:
        # default to linear equation for now
        item = generate_linear_equation(seed)

    return GenerateResponse(
        domain=item.domain,
        skill=item.skill,
        format=item.format,
        seed=item.seed,
        prompt_latex=item.prompt_latex,
    )


@app.post("/grade", response_model=GradeResponse)
def grade_item(req: GradeRequest):
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
    else:
        correct, sol, steps = grade_linear_equation(req.seed, req.user_answer)
    return GradeResponse(
        correct=correct,
        correct_answer=str(sol),
        explanation_steps=steps,
        why_correct="It satisfies the equation.",
    )


@app.post("/estimate", response_model=EstimateResponse)
def estimate(req: EstimateRequest):
    score, ci, p_mean = estimate_math_sat(req.correct, req.total)
    return EstimateResponse(score=score, ci68=ci, p_mean=p_mean)
