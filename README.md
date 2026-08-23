# DSAT Math Forge

Full-stack **Digital SAT Math** practice app: generate original SPR/MC items, auto-grade with explanations, estimate a session score, and track attempts with basic analytics.

## Overview

Students get infinite practice from templated + Gemini-assisted generators (with output guardrails). The FastAPI backend grades answers and estimates score; the React frontend renders KaTeX, multiple-choice / student-produced response (SPR) flows, sessions, and stats.

## Architecture

```
React + Vite (KaTeX UI)
        │  HTTP
        ▼
FastAPI  ──► generators / guardrails / grader / score estimator
        │
        ▼
SQLite (attempts + stats)
```

## Tech stack

| Layer | Tools |
|-------|--------|
| Backend | Python 3.11+, FastAPI, Uvicorn, SymPy, SciPy, SQLAlchemy, Pydantic |
| AI | Google Gemini (`google-generativeai`) for MC distractors / enrichment |
| Frontend | React, TypeScript, Vite, KaTeX, Recharts |
| Quality | pytest (generators + guardrails), GitHub Actions CI |

## Quickstart

```bash
git clone https://github.com/piepengu/dsat-math.git
cd dsat-math
```

### Backend

```bash
cd sat-math/backend
python -m venv .venv
# Windows: .venv\Scripts\Activate.ps1
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # optional GEMINI_API_KEY for AI MC generation
uvicorn app.main:app --reload
```

- Health: http://127.0.0.1:8000/health  
- Core routes: `POST /generate`, `POST /grade`, `POST /estimate`, `GET /attempts`, `GET /stats`

### Frontend

```bash
cd sat-math/frontend
npm install
npm run dev
```

App: http://localhost:5173

### Tests & CI

```bash
cd sat-math/backend
pytest -q
```

GitHub Actions runs backend tests and the frontend build on every push/PR ([CI badge](https://github.com/piepengu/dsat-math/actions/workflows/ci.yml)).

## Engineering notes

- Deterministic **seeded generators** for reproducible practice items
- **Guardrails** sanitize / validate model output before it reaches students
- Score **estimator** maps session performance to a Digital SAT–style band

More detail: [`sat-math/backend/README.md`](./sat-math/backend/README.md).

## License

MIT — see [LICENSE](./LICENSE).
