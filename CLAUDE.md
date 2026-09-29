# Rating Integrity Engine

Portfolio project. System One models (Jev hosted, Laya local) make typed judgments on every review; corpus analysis finds duplicates, bursts and clusters; output is an integrity-adjusted rating with CI.

- Spec: `docs/MVP_SPEC.md` (source of truth for design). Plan: `docs/PLAN.md` (phases, exit criteria). Research: `docs/RESEARCH_FINDINGS.md`.
- Measured numbers go in `docs/MEASUREMENTS.md`; benchmark results in `docs/RESULTS.md`. Never invent numbers.

## Layout
- `backend/` Python 3.12, uv, FastAPI. Pipeline stages: `ingest/` (S0) → `features/` (S1) → `systemone/` (S2) → `corpus/` (S3) → `decide/` (S4), orchestrated by `app/pipeline.py`.
- `frontend/` React 19 + Vite + TS, Tailwind v4, shadcn/ui, Zustand, TanStack Query. `@/` = `frontend/src`.
- `tools/` one-off scripts; `notebooks/` Kaggle/Colab work; `data/` gitignored.

## Commands
- Backend (from `backend/`): `uv run uvicorn app.main:app --reload --port 8001` · `uv run pytest` · `uv run ruff check . && uv run ruff format .`
- Laya server: `uv run laya-serve` (port 8000, same protocol as Jev)
- Frontend (from `frontend/`): `npm run dev` · `npm test` · `npm run lint` · `npm run build` · `npm run build:static`
- Smoke test System One: `uv run python ../tools/smoke_systemone.py --backend jev|laya [--packed N]`

## Rules
- One httpx client for Jev and laya-serve (`systemone/client.py`); don't fork code paths per backend.
- System One output alone must never EXCLUDE a review; only deterministic signals can.
- Put the rating verdict in words in System One state, keep state minimal.
- Every threshold/weight lives in run config, not constants.
- Never store raw author IDs (hash with salt at ingest). Never commit `data/` or `.env`.
- UI copy: never "fake"; use "integrity weight" / "low evidential value".
- Use the `typesafe:typesafe-ai` skill before writing Jev question/state code; check live docs at docs.typesafe.ai.
