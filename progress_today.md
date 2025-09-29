DSAT Math App - Progress Summary (date: 2025-09-19)

Updates (2025-09-28)
- Backend
  - Added POST `/attempt_ai` to persist AI-generated MC attempts (logs `user_id`, domain/skill, selection, correctness).
  - Hardened Gemini JSON parsing; clarified escaping in AI prompt; lint cleanups.
  - Confirmed CORS works with the new frontend origin.
- Frontend
  - Implemented AI attempt logging: after client-side grading, the app POSTs to `/attempt_ai` so stats include AI items.
  - Improved LaTeX normalization for environments (e.g., `cases`, `aligned`) so multi-line prompts render correctly.
  - UX polish: the “Hide explanation” toggle now hides both the correct answer and the step list.
  - Diagram rendering: added right-triangle SVG; labels with contrast; dynamic scaling.
  - Renderer fixes: treat pure `\text{...}` as plain text; support `\[ ... \]` block splitting.
  - UI: filter skill dropdown based on selected domain; reset skill on domain change.
- Deployment
  - Moved frontend hosting to GitHub Pages.
    - Published the built site to `docs/` on `master` and added a GitHub Actions Pages workflow to deploy automatically.
    - Ensured SPA fallback via `404.html`; added `.nojekyll` as needed.
  - Updated Render `FRONTEND_ORIGIN` to the Pages URL; validated health and cross-origin calls.
- Verification
  - “Use AI” → Submit → “My Stats” increases attempts for the selected skill.
  - API checks: `/attempts?user_id=...` and `/stats` reflect AI attempts.
  - Geometry (AI/template) now shows diagrams; MC shows four choices.

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
  - AI fallback improvements:
    - Geometry: Pythagorean items return valid 4-choice MC with diagram when AI fails.
    - Algebra 2x2: fallback builds coordinate options from template solution.
  - Fixed LaTeX for 2x2 systems (proper line breaks in `cases`).

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
   - Add “Difficulty” and “Topic/Skill” selectors; pass to /generate or /generate_ai. (DONE)

3) Persist AI attempts (easy)
   - Include source='ai' and correct_index in attempt log so stats include AI items. (DONE)

4) Basic rate limiting/quota (easy)
   - Cap AI calls per session/user; local counter + backend guard.

5) Server-side validation/fallbacks (medium)
   - Sanity-check AI answers (numeric/symbolic) and fall back to templates on failure.

6) Diagram support (template-based) (medium) (IN PROGRESS)

7) Diagram support (AI-assisted) (medium-hard)
   - /generate_ai returns prompt_latex + structured diagram spec (shapes/points/labels); render via SVG; validate spec.

8) Enhanced analytics (medium)
   - Per-topic accuracy trends, time-to-answer, AI vs template performance.

9) Adaptive difficulty (medium-hard)
   - Adjust difficulty based on rolling accuracy; simple ELO/moving average.

10) Auth/sessions (harder)
   - Optional user accounts; keep stats across devices; migrate to Postgres.

Note: We will continue with step 2 next (difficulty/topic controls).

End of day notes (2025-09-28)
- Verified “Avg time” column appears in My Stats; headings set to neutral black.
- Fixed CORS configuration and added auto‑migration for analytics columns (`source`, `time_ms`, `created_at`).
- Surfaced errors in the debug banner to aid troubleshooting (e.g., Network Error details).
- Improved LaTeX rendering for both AI and non‑AI prompts: supports `\[ ... \]` blocks and treats pure `\text{...}` as plain text.
- Diagram labels (right triangle) now high‑contrast and positioned clearly.
- UI: skills dropdown filters by domain and resets to a valid skill on domain change.

Planned for next session
- Record `time_ms` for AI submissions via `/attempt_ai` so Avg time includes AI items.

Comprehensive accomplishments to date
- Backend (FastAPI + SQLite/SQLAlchemy)
  - Endpoints: `/health`, `/generate`, `/grade`, `/attempts`, `/stats`, `/estimate`, `/attempt_ai`, `/generate_ai`.
  - Models: `Attempt` with `user_id`, `domain`, `skill`, `seed`, `correct`, `correct_answer`, analytics fields `source`, `time_ms`, `created_at`.
  - Auto‑migration: safely adds analytics columns on startup if missing.
  - Generators/graders: linear equation (SPR/MC with distractors + feedback), two‑step equation, proportion, linear system 2×2, quadratic roots, exponential solve, Pythagorean hypotenuse/leg.
  - AI integration (Gemini): strict JSON, LaTeX escaping, schema and content validation, robust fallbacks to templates (Geometry and 2×2), optional diagram pass‑through.
  - CORS: explicit origins (GitHub Pages, localhost) for valid browser responses.

- Frontend (React + Vite + TS + Tailwind)
  - Core UI: domain + skill pickers (skill list filtered by domain), difficulty selector, AI toggle, session mode with progress bar, debug banner, improved button styles.
  - Rendering: KaTeX with helpers for `\text{...}`, `\[ ... \]` blocks, environments (`cases`/`aligned`), and inline math; non‑AI and AI paths unified.
  - MC UX: radio options with correct/wrong highlighting, “why wrong” text, explanation toggle; SPR input preserved.
  - Diagrams: right‑triangle SVG with scaled sides, readable labels, right‑angle marker; shown for Pythagorean items (templates and AI when provided/fallback).
  - Analytics: live time‑to‑answer timer under the prompt; requests send `time_ms` and `source`; My Stats table shows Attempts/Correct/Accuracy and Avg time per skill.

- CI/CD + Deployments
  - GitHub Actions: backend tests + frontend build on push/PR.
  - Backend on Render with environment (`FRONTEND_ORIGIN`, `GEMINI_API_KEY`).
  - Frontend on GitHub Pages (docs/ branch flow) with repeatable publish.

- Stability & fixes
  - Python 3.7 compatibility (typing, f‑strings), added SQLAlchemy, fixed Tailwind v4 PostCSS, added `react-katex` types, resolved Netlify issues, cleaned submodules, resolved CORS and JSON issues.

Next up (options)
- Per‑skill AI vs template breakdowns in My Stats (counts/accuracy/avg time for each source).
- Trend charts (last 7/30 days) for accuracy and avg time per skill.
- Diagram enhancements (angle markers, side ticks, labels toggle) and more geometry skills.
- Simple AI rate limiting per user/session and a friendly quota banner.
- Export attempts as CSV; “Reset my stats” control.
