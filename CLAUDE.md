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
- Throughput benchmark: `uv run python ../tools/bench_throughput.py --backend jev|laya --n 200 --concurrency 8`
- Steam pull (resumable): `uv run python -m app.ingest.steam_fetcher --appid N --from YYYY-MM-DD --to YYYY-MM-DD`
- Pull → dataset: `uv run python -m app.ingest.steam_import --pull <dir under data/raw/steam> --name "..." [--sample 50000]`
- S1 feature benchmark: `uv run python ../tools/bench_features.py --pull <dir> --n 50000 [--cache-dir <dir>]`
- After changing `app/models.py`: `uv run python ../tools/export_types.py` then `npm run gen:types` in `frontend/` (a test fails if you forget)

## Rules
- One httpx client for Jev and laya-serve (`systemone/client.py`); don't fork code paths per backend.
- System One output alone must never EXCLUDE a review; only deterministic signals can.
- Put the rating verdict in words in System One state, keep state minimal.
- Every threshold/weight lives in run config (`PolicyThresholds`, `ActionWeights` in `app/models.py`), not constants.
- `reviews.id` is the chronological position within its dataset, and equals the grid index.
- DuckDB access goes through `Database.cursor()` (UTC-pinned, thread-safe); never share a raw connection.
- Duplicate EXCLUDEs are decided in S1 and never sent to System One; texts shorter than `dup_min_tokens` are never excluded as copies.
- Tests never load MiniLM: inject `tests.fakes.HashingEmbedder` via `create_app(..., embedder_factory=...)`.
- CPU timings on the dev laptop vary about ±35% under sustained load; record ranges, not single numbers.
- Never store raw author IDs (hash with salt at ingest). Never commit `data/` or `.env`.
- UI copy: never "fake"; use "integrity weight" / "low evidential value".
- Use the `typesafe:typesafe-ai` skill before writing Jev question/state code; check live docs at docs.typesafe.ai.
