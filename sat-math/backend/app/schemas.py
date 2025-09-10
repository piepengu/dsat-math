from typing import List, Optional, Tuple

from pydantic import BaseModel, Field, conint


class GenerateRequest(BaseModel):
    domain: Optional[str] = Field(default="Algebra")
    skill: Optional[str] = Field(default="linear_equation")
    seed: Optional[int] = None


class GenerateResponse(BaseModel):
    domain: str
    skill: str
    format: str
    seed: int
    prompt_latex: str


class GradeRequest(BaseModel):
    domain: str
    skill: str
    seed: int
    user_answer: str


class GradeResponse(BaseModel):
    correct: bool
    correct_answer: str
    explanation_steps: List[str]
    why_correct: Optional[str] = None


class EstimateRequest(BaseModel):
    correct: conint(ge=0)
    total: conint(gt=0)


class EstimateResponse(BaseModel):
    score: int
    ci68: Tuple[int, int]
    p_mean: float
