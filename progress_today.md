DSAT Math App - Progress Summary (date: 2025-09-19)

What we accomplished today
- Repo cleanup & structure
  - Flattened repo layout; fixed Python package imports and tests.
  - Removed stray submodule (dsat-math-export) that broke Netlify builds.
  - Added netlify.toml to pin frontend build (base/publish) and VITE_API_BASE for all contexts.

- Backend (sat-math/backend)
  - FastAPI app: /health, /generate, /grade, /attempts, /stats, /estimate.
  - Generators/graders: linear_equation, two_step_equation, proportion, linear_system_2x2,
    quadratic_roots, exponential_solve, pythagorean_hypotenuse, pythagorean_leg,
    linear_equation_mc (with choices and feedback).
  - Persistence: SQLite via SQLAlchemy; Attempt model; stats endpoint (per-skill accuracy).
  - CORS: uses FRONTEND_ORIGIN env; health verified on Render.
  - Python 3.7 compatibility fixes (Optional/Lists, f-string escaping). 

- Frontend (sat-math/frontend)
  - React + Vite + TypeScript scaffolded and wired to backend.
  - KaTeX rendering; UI supports MC and short answers, sessions with progress and SAT estimate.
  - Reads API base from VITE_API_BASE (Netlify env) with localhost fallback.
  - Tailwind CSS v4 set up: postcss.config.js uses @tailwindcss/postcss; index.css imports tailwind.
  - Added debug banner (API base + last error) for deploy troubleshooting.
  - UI styling upgrade: Tailwind classes, improved button contrast (indigo/slate) and dark text.
  - Type declaration added for react-katex to fix Netlify build.

- CI/CD & Deployments
  - GitHub Actions: backend tests and frontend build passing.
  - Netlify: configured build (base sat-math/frontend, publish dist), env VITE_API_BASE.
  - Render: backend deployed; FRONTEND_ORIGIN set to Netlify URL; CORS OK.
  - Resolved Netlify deploy preview failures (submodule & settings) and published Production.

How to run locally
- Backend
  1) cd sat-math/backend
  2) python -m venv .venv; .venv\Scripts\Activate.ps1
  3) pip install -r requirements.txt
  4) python -m uvicorn app.main:app --reload
  5) Verify: http://127.0.0.1:8000/health → {"ok": true}

- Frontend
  1) cd sat-math/frontend
  2) npm install
  3) (optional) $env:VITE_API_BASE="http://127.0.0.1:8000"
  4) npm run dev -- --open

What’s next
- Add more MC templates with targeted distractors and “why wrong” feedback.
- Geometry/trig diagrams and richer formatting.
- Adaptive difficulty; expanded analytics dashboard.
- Auth or simple session management; persist user profiles.

Next Sprint Plan (ordered: easiest → harder)
1) UX polish (very easy)
   - Show which option was correct after submit; expand/collapse full explanation. (DONE)

2) Difficulty/topic controls (easy)
   - Add “Difficulty” and “Topic/Skill” selectors; pass to /generate or /generate_ai. (NEXT)

3) Persist AI attempts (easy)
   - Include source='ai' and correct_index in attempt log so stats include AI items.

4) Basic rate limiting/quota (easy)
   - Cap AI calls per session/user; local counter + backend guard.

5) Server-side validation/fallbacks (medium)
   - Sanity-check AI answers (numeric/symbolic) and fall back to templates on failure.

6) Diagram support (template-based) (medium)
   - Add SVG components for triangles/circles; generators return diagram params; render figure with prompt.

7) Diagram support (AI-assisted) (medium-hard)
   - /generate_ai returns prompt_latex + structured diagram spec (shapes/points/labels); render via SVG; validate spec.

8) Enhanced analytics (medium)
   - Per-topic accuracy trends, time-to-answer, AI vs template performance.

9) Adaptive difficulty (medium-hard)
   - Adjust difficulty based on rolling accuracy; simple ELO/moving average.

10) Auth/sessions (harder)
   - Optional user accounts; keep stats across devices; migrate to Postgres.

Note: We will continue with step 2 next (difficulty/topic controls).
