# DSAT Math App [![CI](https://github.com/piepengu/dsat-math/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/piepengu/dsat-math/actions/workflows/ci.yml)

Full-stack app for Digital SAT Math practice: original problem generation (SPR + MC), auto-grading with explanations, session mode with SAT score estimate, persistence (SQLite), and basic analytics.

## Repository Structure
- sat-math/
  - backend/ FastAPI (generate, grade, attempts, stats)
  - frontend/ React + TypeScript (KaTeX, MC + SPR, sessions, stats)
- SAT_MATH/ Docs
- PROGRESS_TODAY.txt Summary

## Backend (FastAPI)
Windows PowerShell
```powershell
cd sat-math/backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```
- Health: http://127.0.0.1:8000/health
- Endpoints: POST /generate, POST /grade, POST /estimate, GET /attempts, GET /stats

## Frontend (React + Vite)
Windows PowerShell
```powershell
cd sat-math/frontend
npm install
npm run dev -- --open
```
- Default: http://localhost:5173

## Tests
Windows PowerShell
```powershell
cd sat-math/backend
.venv\Scripts\Activate.ps1
pytest -q
```

## CI
GitHub Actions runs backend tests and frontend build on every push/PR.

## Next Steps
- Expand templates (Advanced Math, Geometry/Trig, PSD) and add diagrams
- MC versions for more skills with targeted distractors and feedback
- Adaptive practice and difficulty tuning
- Auth + user sessions; richer analytics dashboard
- Deploy backend (Render/Fly) and frontend (Netlify/Vercel)