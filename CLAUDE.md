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
- Jev probes (cost < $0.02): `uv run python ../tools/jev_probe.py` (determinism, token model) · `../tools/jev_noise.py` (test-retest noise, k-averaging)
- Dev set: `uv run python ../tools/make_devset.py` then `../tools/devset_eval.py run|compare|show` (tuning only, never report metrics on it)
- After changing `app/models.py`: `uv run python ../tools/export_types.py` then `npm run gen:types` in `frontend/` (a test fails if you forget)

## Rules
- One httpx client for Jev and laya-serve (`systemone/client.py`); don't fork code paths per backend.
- System One output alone must never EXCLUDE a review; only deterministic signals can.
- Put the rating verdict in words in System One state, keep state minimal.
- Every threshold/weight lives in run config (`PolicyThresholds`, `ActionWeights` in `app/models.py`), not constants.
- `reviews.id` is the chronological position within its dataset, and equals the grid index.
- DuckDB access goes through `Database.cursor()` (UTC-pinned, thread-safe); never share a raw connection.
- **Accuracy over speed** (owner): prefer the more accurate option when a measurement shows a gain; report speed and cost, don't optimise them at accuracy's expense.
- Later copies (>= `dup_min_tokens`) are DOWNWEIGHTed by default and still judged by System One; the copy rule is a floor. Jev is not deterministic, so by default every review gets its own call (`reuse_identical_inputs` is opt-in). Texts shorter than `dup_min_tokens` are never penalised as copies.
- Tests never touch the network or the real `.env`: build settings with `tests.conftest.make_settings`, fake Jev with `tests.fake_systemone.FakeSystemOne`.
- Tests never load MiniLM: inject `tests.fakes.HashingEmbedder` via `create_app(..., embedder_factory=...)`.
- CPU timings on the dev laptop vary about ±35% under sustained load; record ranges, not single numbers.
- Never store raw author IDs (hash with salt at ingest). Never commit `data/` or `.env`.
- UI copy: never "fake"; use "integrity weight" / "low evidential value".
- Use the `typesafe:typesafe-ai` skill before writing Jev question/state code; check live docs at docs.typesafe.ai.
- Question sets are versioned (`app/systemone/questions_v*.py`, registry in `questions.py`); never edit a released version, add a new one. Default is v2. Tune only on the dev set, compare with `devset_eval.py compare` against a same-version repeat (the noise floor), max 3 iterations per version.
- To try S3/S4 settings, reuse a finished run's Jev answers: POST /runs with backend "cached" and reuse_judgments_from=<run id> ($0). Never re-pay Jev for a policy experiment.
- Cluster suspicion factors must be judged against a null (random same-size corpus subsets), never the corpus-wide rate: clusters are subsets of the corpus.
- Every Jev run goes through the pre-flight (`/runs/preflight`); above `MAX_RUN_COST_USD` it needs `confirm_cost: true`. Keep `preflight.MEASURED_INTERCEPTS` updated when question text changes.
