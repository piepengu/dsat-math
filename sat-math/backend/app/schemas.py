from typing import Dict, List, Optional, Tuple

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
    choices: Optional[List[str]] = None
    diagram: Optional["DiagramSpec"] = None
    hints: Optional[List[str]] = None
    # Optional rich explanation (concept/plan/check/mistake)
    explanation: Optional["Explanation"] = None


class DiagramSpec(BaseModel):
    type: str  # e.g., "right_triangle", "triangle"
    # Right triangle legacy fields
    a: Optional[int] = None
    b: Optional[int] = None
    c: Optional[int] = None
    labels: Optional[Dict[str, str]] = None
    # Generic triangle support
    points: Optional[Dict[str, Tuple[float, float]]] = None  # A,B,C -> (x,y)
    angleMarkers: Optional[List[Dict[str, object]]] = None  # {at, style,
    # radius}
    sideTicks: Optional[List[Dict[str, object]]] = None  # {side, count}
    showLabels: Optional[bool] = None
    # Triangle definition parameters (e.g., mode + values)
    triangle: Optional[Dict[str, object]] = None


class GradeRequest(BaseModel):
    domain: str
    skill: str
    seed: int
    user_answer: str
    user_id: Optional[str] = None
    selected_choice_index: Optional[int] = None
    time_ms: Optional[int] = None
    source: Optional[str] = None  # 'ai' | 'template'
    difficulty: Optional[str] = Field(default=None)


class GradeResponse(BaseModel):
    correct: bool
    correct_answer: str
    explanation_steps: List[str]
    why_correct: Optional[str] = None
    why_incorrect_selected: Optional[str] = None
    # New richer explanation payload (optional for backward compatibility)
    explanation: Optional["Explanation"] = None


class AttemptOut(BaseModel):
    id: int
    user_id: str
    domain: str
    skill: str
    seed: int
    correct: bool
    correct_answer: str
    source: Optional[str] = None
    time_ms: Optional[int] = None
    difficulty: Optional[str] = None


class EstimateRequest(BaseModel):
    correct: conint(ge=0)
    total: conint(gt=0)


class EstimateResponse(BaseModel):
    score: int
    ci68: Tuple[int, int]
    p_mean: float


class GenerateAIRequest(BaseModel):
    domain: Optional[str] = Field(default="Algebra")
    skill: Optional[str] = Field(default="linear_equation_mc")
    difficulty: Optional[str] = Field(default="medium")


class GenerateAIResponse(BaseModel):
    prompt_latex: str
    choices: List[str]
    correct_index: int
    explanation_steps: List[str]
    diagram: Optional[DiagramSpec] = None
    hints: Optional[List[str]] = None
    explanation: Optional["Explanation"] = None


class AttemptAIRequest(BaseModel):
    user_id: Optional[str] = None
    domain: str
    skill: str
    selected_choice_index: int
    correct_index: int
    correct_answer: Optional[str] = None
    seed: Optional[int] = None
    time_ms: Optional[int] = None
    difficulty: Optional[str] = None


class AttemptAIResponse(BaseModel):
    ok: bool
    correct: bool


class Explanation(BaseModel):
    concept: Optional[str] = None
    plan: Optional[str] = None
    quick_check: Optional[str] = None
    common_mistake: Optional[str] = None


class NextRequest(BaseModel):
    user_id: str
    domain: Optional[str] = None
    skill: Optional[str] = None


class NextResponse(BaseModel):
    domain: Optional[str] = None
    skill: Optional[str] = None
    difficulty: str


class ResetStatsRequest(BaseModel):
    user_id: str
    domain: Optional[str] = None
    skill: Optional[str] = None


class ResetStatsResponse(BaseModel):
    ok: bool
    deleted: int


class ElaborateRequest(BaseModel):
    user_id: Optional[str] = None
    domain: Optional[str] = None
    skill: Optional[str] = None
    difficulty: Optional[str] = None
    prompt_latex: str
    steps: Optional[List[str]] = None
    correct_answer: Optional[str] = None
    user_question: str


class ElaboratePayload(BaseModel):
    concept: Optional[str] = None
    plan: Optional[str] = None
    walkthrough: Optional[List[str]] = None
    quick_check: Optional[str] = None
    common_mistake: Optional[str] = None


class ElaborateResponse(BaseModel):
    elaboration: ElaboratePayload
    usage_ms: int = 0
    guardrails: Optional[Dict[str, object]] = None


class StreaksResponse(BaseModel):
    user_id: str
    current_streak_days: int
    longest_streak_days: int
    problems_solved_today: int
    badges_today: List[str]


class AchievementsResponse(BaseModel):
    user_id: str
    achievements: List[str]  # e.g., ["first_solve", "five_correct_streak", "seven_day_streak"]
