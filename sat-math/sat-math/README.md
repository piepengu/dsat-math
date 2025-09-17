# DSAT Math App

Structure:
- backend/  FastAPI app (see backend/README.md)
- frontend/  React + TS (Vite) to be scaffolded

Backend quickstart (PowerShell):
1) cd sat-math/backend
2) python -m venv .venv
3) .venv\\Scripts\\Activate.ps1
4) pip install -r requirements.txt
5) uvicorn app.main:app --reload

Frontend quickstart (after Node):
1) cd sat-math
2) npx create-vite@latest frontend -- --template react-ts
3) cd frontend && npm i
4) npm i katex react-katex axios recharts
5) npm run dev

