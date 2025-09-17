# DSAT Math App

Full-stack app for Digital SAT Math practice with original problem generation, auto-grading, explanations, sessions with score estimate, persistence, and basic analytics.

## Repository Structure
- sat-math/
  - ackend/ FastAPI app (problem generation, grading, attempts, stats)
  - rontend/ React + TypeScript (UI with KaTeX, MC and SPR support, sessions, stats)
- SAT_MATH/ Documentation
- PROGRESS_TODAY.txt Work summary

## Prerequisites
- Python 3.7+ (Windows)
- Node.js LTS (npm)

## Backend (FastAPI)
Windows PowerShell
`powershell
cd sat-math/backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
`
- Health: http://127.0.0.1:8000/health
- Key endpoints:
  - POST /generate  new item (SPR/MC)
  - POST /grade  grade submission (persists attempt)
  - POST /estimate  SAT 200800 estimate + CI
  - GET /attempts?user_id=...  recent attempts
  - GET /stats?user_id=...  per-skill accuracy

## Frontend (React + Vite)
Windows PowerShell
`powershell
cd sat-math/frontend
npm install
npm run dev -- --open
`
- Default: http://localhost:5173
- UI features:
  - Domain/skill selection (Algebra, PSD, Advanced, Geometry)
  - SPR input and MC options (with why-wrong feedback)
  - Session mode with SAT estimate
  - My Stats (per-skill accuracy from backend)

## Notes
- KaTeX is used for math rendering (eact-katex).
- SQLite database pp.db is created in sat-math/backend on first run.
- The frontend stores a persistent user_id in localStorage and sends it on /grade.

## Tests
`powershell
cd sat-math/backend
.venv\Scripts\Activate.ps1
pytest -q
`

## Roadmap
- More templates (Advanced/Geometry/PSD)
- MC across more skills
- Diagram support (SVG) for geometry
- Deploy backend+frontend
