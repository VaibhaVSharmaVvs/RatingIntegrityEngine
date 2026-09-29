# Rating Integrity Engine: Phased Delivery Plan

*v1.0, 2026-09-29. Derived from `MVP_SPEC.md` v0.1 (§12 build plan) and `RESEARCH_FINDINGS.md`. Section refs like §6.3 point into `MVP_SPEC.md`.*

🎯 **Goal:** a public, replay-only portfolio demo. It judges 50K Steam reviews visibly, finds the Helldivers 2 review bomb, reports a benchmarked integrity-adjusted rating with a CI, and compares Jev with Laya on cost, latency and accuracy.

**How to read this plan.** Each phase has a **goal** (the outcome), **requirements** (what must exist), **process** (how to build it, in order), and **exit criteria** (a checkable gate). Don't start phase N+1 until phase N's gate passes, except where *Parallel* says otherwise.

---

## 0. Spec corrections found during setup (act on these first)

| # | Issue | Evidence | Action |
|---|---|---|---|
| C1 | **Laya checkpoint names are wrong in the spec.** The spec says `laya`, `laya-multilingual`, `laya-typed-decisions`; the current README names them `english`, `multilingual`, `typed-decisions`. | github.com/NandhaKishorM/laya README; `laya==0.3.21` installed | `.env.example` uses `LAYA_MODEL=english`. Update spec §2 and §4. |
| C2 | **Jev packing is not documented.** `state` accepts arrays, but there is no documented per-item batching and no documented max questions per request. | docs.typesafe.ai/api.md | Packing stays a Phase 3 **experiment** with a fallback, not an assumption. `tools/smoke_systemone.py --packed N` is the probe. |
| C3 | **`jev-latest` is a moving alias.** Runs store `model_version`, but the alias can change between runs, which breaks benchmark comparability. | api.md: aliases resolved via `/models` | Resolve the alias to a pinned version at run start and store the resolved ID. |
| C4 | **Python SDK is `typesafe-sdk`** (import `typesafe_sdk`), not `typesafe-ai`. | docs.typesafe.ai/sdk/python.md | Installed as an optional extra. Our own httpx client stays the default so Jev and Laya share one code path. |
| C5 | **Timeline risk.** 31 working days assumes full-time. Phases 7–8 (evaluation, distillation) carry the most uncertainty. | Spec §12 | Phases 0–6 are the demoable MVP. Treat 7–9 as a second milestone with its own date. |

---

## Phase overview

| Phase | Name | Est. | Depends on | Milestone |
|---|---|---|---|---|
| 0 | Setup, access, data pull | 2 d | — | ✅ Setup done (this commit) |
| 1 | Backend skeleton | 3 d | 0 | |
| 2 | S1 deterministic features | 2 d | 1 | |
| 3 | S2 System One judgments | 3 d | 1 (2 in parallel) | **Go/no-go on packing** |
| 4 | S3 corpus + S4 decisions | 3 d | 2, 3 | Backend end-to-end |
| 5 | Frontend core (live grid) | 4 d | 1 (API contract); 4 for real data | |
| 6 | Drill-downs + results | 4 d | 4, 5 | **M1: demoable MVP** (~21 d) |
| 7 | Evaluation + benchmarks | 4 d | 6 | |
| 8 | Laya distillation | 3 d | 7 (labels), ToS check | |
| 9 | Ship public demo | 3 d | 6 (7, 8 for full story) | **M2: public launch** (~31 d) |

**Critical path:** Steam pull (start day 1) → Phase 3 packing test → Phase 4 → Phase 6. The frontend (Phase 5) can start against mocked SSE fixtures as soon as the Phase 1 API contract is frozen.

---

## Phase 0: Setup, access and data pull

**Goal:** every external dependency is either confirmed working or has a known fallback, and the long-running Steam pull is under way.

**Requirements**
- [x] Git repo (local identity `vaibhavsharmavvs@gmail.com`), `.gitignore` that keeps data, secrets and PII out.
- [x] Backend: Python 3.12, `uv`, FastAPI, the full ML stack (torch CPU, sentence-transformers, faiss-cpu, umap, ruptures, datasketch, duckdb, polars), `pytest`, `ruff`.
- [x] Optional extras installed: `laya[serve]` 0.3.21, `typesafe-sdk` 0.7.2.
- [x] Frontend: React 19, Vite 8, TypeScript 6, Tailwind v4, shadcn/ui, TanStack Query, Zustand, Recharts, Vitest.
- [x] `docker-compose.yml` (api `:8001`, laya `:8000`, web `:5173`), `.env.example`, spend-guard variable.
- [ ] Jev API key in `.env`. Smoke test passes: `uv run python ../tools/smoke_systemone.py --backend jev`.
- [ ] `laya-serve` running on CPU and the same smoke test passes with `--backend laya`.
- [ ] **Measured** Laya reviews/s on this CPU (6 questions per review). Record it in `docs/MEASUREMENTS.md`.
- [ ] Packing probe run once: `--packed 5`. Record whether per-item answers differ sensibly.
- [ ] Steam fetcher prototype started in the background for Helldivers 2 (553850), Gollum (1265780) and Cities: Skylines II (verify appid 949230), English only.
- [ ] Jev terms checked: can outputs be used to train Laya (gates Phase 8)? Data retention / ZDR terms noted.

**Process**
1. Copy `.env.example` → `.env`, add the key and a random `AUTHOR_HASH_SALT`.
2. Run the smoke script against Jev; then `uv run laya-serve` (first run downloads ~421M weights) and run it against Laya.
3. Time 200 reviews × 6 questions on Laya CPU to get reviews/s.
4. Write a minimal `ingest/steam_fetcher.py` (cursor paging, 1 req/s, checkpoint the cursor to disk, append to Parquet) and start it. Back-paginating ~2.4 years of HD2 English reviews at 100/page is thousands of pages: expect several hours [estimate].

**Exit criteria:** both backends return valid answers to an identical request; Laya CPU throughput is a measured number; Steam pull is running and resumable.

**Risks:** Jev rate limits differ from the documented 1,200 rpm → measure 429 frequency during the smoke test. Laya CPU is very slow (<2 reviews/s) → Laya runs locally only on a 200-review dev set; bulk runs move to Kaggle (spec §9).

---

## Phase 1: Backend skeleton

**Goal:** a dataset can be ingested, stored, and a dummy run streams events over SSE end to end, with replay recording.

**Requirements**
- DuckDB schema from §5 created by a migration function in `core/db.py` (idempotent, versioned).
- `ingest/normalize.py`: strip HTML/BBCode, language detection (`lingua`), `rating_norm` for binary / 1–5 / 1–10, `author_hash = sha256(salt + id)`. **Raw author IDs never reach the DB.**
- `ingest/csv_loader.py` with explicit column mapping; `ingest/steam_fetcher.py` finalised with day-stratified sampling (50K headline set, 5K live subset).
- `core/events.py`: an in-process event bus per run → SSE (`sse-starlette`) + a replay recorder writing `.jsonl.gz` with relative timestamps.
- Routers: `GET/POST /datasets*`, `POST /runs`, `GET /runs/{id}`, `GET /runs/{id}/events`, `GET /runs/{id}/replay`.
- Pydantic models for every request, response and **every SSE event type in §7**. This is the frozen contract the frontend builds against.
- A `heuristic` fake backend that emits random judgments so the pipeline is runnable before Phase 3.

**Process**
1. Schema + DB connection (single writer; runs execute in one asyncio task each).
2. Normalizer with unit tests (BBCode samples from real Steam reviews, rating scales, hashing).
3. CSV loader → `datasets` + `reviews`; Steam Parquet → the same path.
4. Event bus + SSE + recorder; a dummy run that walks S0→S4 with fake data.
5. Export a JSON schema / TS types for the events (`pydantic` → `json-schema` → `json-schema-to-typescript`) into `frontend/src/data/types.ts`.

**Exit criteria:** `pytest` green; `curl -N /runs/{id}/events` streams every event type for a 5K dataset; the replay file plays back the same sequence; no raw steamid appears anywhere in `data/rie.duckdb` (test asserts it).

**Compliance flag (SOC2 / ISO 27001):** review text can contain names, emails and handles. Add a PII-scrub pass (emails, URLs with usernames, phone numbers) in `normalize.py` **before** text is sent to Jev, and record in the methodology that it happens.

---

## Phase 2: S1 deterministic features

**Goal:** cheap signals for every review in seconds, which fill part of the grid before any model call.

**Requirements**
- `features/heuristics.py`: token count, type–token ratio, emoji/ASCII-art ratio, repeated chars, promo regex (URLs, `discord.gg`, "free key", codes, referral patterns). Vectorised with Polars.
- `features/minhash.py`: 3-shingle MinHash + LSH (Jaccard ≥ 0.7) → `dup_group_id`, `dup_score`; exact-hash duplicates.
- `features/embeddings.py`: MiniLM-L6-v2 on CPU, **cached per dataset** (Parquet/npy keyed by dataset id + model), FAISS kNN → `nn_cosine_max`.
- Steam account signals from `meta`: low `playtime_at_review`, `num_reviews == 1`, `received_for_free`, not `steam_purchase`.
- `features_done` SSE event with counts.

**Process:** implement each extractor as a pure function `DataFrame → DataFrame`; test each with fixtures (known duplicates, known spam strings); then benchmark wall-clock on the 50K set.

**Exit criteria:** 50K reviews through S1 on CPU in **< 5 min** with a cold embedding cache and **< 30 s** warm; duplicate detection finds 100% of injected exact copies and ≥ 90% of injected near-copies in a unit fixture.

---

## Phase 3: S2 System One judgments (core)

**Goal:** six typed judgments per review from a pluggable backend, streamed with live cost, and a data-backed decision on packing.

**Requirements**
- `systemone/client.py`: one `httpx.AsyncClient` for Jev and laya-serve; `aiolimiter` + `asyncio.Semaphore`; `tenacity` backoff on 429/529; parses noul / choice / score answers; records `usage.input_tokens`, latency and resolved model version (C3).
- `systemone/questions_v1.py`: the six questions in §6.3, versioned. The verdict goes in words in `state`; no other metadata (Jev distraction weakness).
- `systemone/packing.py`: pack-N builder + unpacker, behind a config flag.
- A fixed **200-review dev set** (stratified: bomb window, pre-bomb, short, long, spammy), stored and never used for final metrics.
- Pre-flight estimator: tokens, $, ETA, requests; blocks above `MAX_RUN_COST_USD`.
- Streaming: `judged` + `counters` events every ~250 reviews or 200 ms.

**Process**
1. Build client + questions; run the dev set on Jev at pack=1. Eyeball 50 answers; tune instruction wording (≤ 3 iterations, each logged with its cost).
2. **Packing experiment:** dev set at pack 1 / 5 / 10. Metric: per-question agreement with pack=1 (Spearman for scores, accuracy for choice/noul).
3. Run the same dev set on Laya zero-shot (expected to be weak, which is fine: it is a benchmark row).

**Exit criteria / go-no-go:** pack-N is adopted **only if** agreement with pack=1 is ≥ 0.9 on every question; otherwise live runs use the 5K subset and the 50K run is recorded and replayed. The decision and numbers are written into `docs/MEASUREMENTS.md`. Total prompt-iteration spend is logged.

---

## Phase 4: S3 corpus analysis + S4 decisions

**Goal:** clusters, bursts, per-review actions with reason codes, and an adjusted rating with honest uncertainty.

**Requirements**
- `corpus/clusters.py`: duplicate clusters (LSH connected components, size ≥ 3); semantic clusters (UMAP → 10-D, `sklearn.cluster.HDBSCAN`, `min_cluster_size=15`); c-TF-IDF top phrases.
- `corpus/bursts.py`: hourly counts per verdict, robust z-score vs 7-day trailing baseline, `ruptures` PELT on daily % positive → `kind='burst'` clusters.
- `corpus/suspicion.py`: the geometric-mean formula in §6.4 with **every factor stored** so the caption is generated from data.
- `decide/policy.py`: the §6.5 rules; every threshold and weight in run `config`; top-3 reason codes.
- `decide/rating.py`: weighted rating, bootstrap 95% CI (1,000 resamples, vectorised NumPy), `n_eff`, Steam label bands.
- Guardrail tests: **System One alone can never EXCLUDE** (only deterministic duplicates or spam > 0.9 can); an on-topic genuine negative review with high informativeness stays KEEP.

**Process:** implement against the heuristic backend first so it is testable without API spend; then plug in the Phase 3 Jev results for the 5K subset.

**Exit criteria:** a full S0→S4 run on the HD2 5K subset completes; burst detection places a window in early May 2024; UMAP+HDBSCAN on 50K finishes in < 10 min on CPU (else lower dims / sample); `GET /runs/{id}` returns raw, adjusted, CI and counts.

---

## Phase 5: Frontend core (live analysis screen)

**Goal:** the hero screen. Thousands of squares fill in live, with counters and a rating ticker.

**Requirements**
- `DataSource` interface with `LiveApi` (REST + `EventSource`) now; `StaticBundle` stub for Phase 9.
- `IntegrityGrid`: Canvas2D `ImageData`, one cell per review in chronological row-major order, redraw < 5 ms at 50K, colours from the action palette tokens, 150 ms fade, `prefers-reduced-motion` snaps.
- `TimelineStrip` (canvas): hourly volume stacked by action, burst windows shaded.
- Counters (tabular numerals), rating ticker with CI whisker, stage stepper, cluster feed cards.
- Zustand store for run state; events batched into one render per animation frame.
- Dark-first theme with a light toggle.

**Process:** build against **recorded SSE fixtures** from Phase 1 first (no backend needed), then switch to the live API. Low-fi Figma wireframes for screens 4–7 before styling (Solulever guidance: wireframes only).

**Exit criteria:** a 50K replay renders at ≥ 50 fps on a mid laptop (Chrome performance panel); hover tooltip and click-to-select work; Vitest covers the store reducers and the grid colour mapping.

---

## Phase 6: Drill-downs, results and export → **M1 demoable MVP**

**Goal:** a viewer can explain any single decision and any cluster, and see how the rating changes with the method's knobs.

**Requirements**
- Cluster drawer: data-driven caption, per-factor metric bars, mini timeline, top phrases, member list with shared n-gram highlighting, action summary.
- Review inspector: text + meta, one row per System One question (answer, probability bar, confidence chip), deterministic signal chips, integrity gauge, reason codes.
- Results page: raw vs adjusted with CI + `n_eff`, reason waterfall, **client-side** sensitivity sliders (no backend call), methodology card (question set, thresholds, backend + pinned model version, "English-language reviews only", "not the 'true' rating").
- `GET /runs/{id}/export?fmt=csv|json`; filterable review table.
- Dataset picker with CSV upload + column mapper; run-config drawer with pre-flight estimate.

**Exit criteria:** a 3-minute scripted walkthrough (dataset → live run → cluster → review → results → export) works on the HD2 5K subset with no console errors. **This is the M1 gate.**

**Wording flag (legal):** UI copy never says "fake". Use "integrity weight" and "low evidential value", never name reviewers (research §9). Get Solulever legal to review the copy before any public link.

---

## Phase 7: Evaluation and benchmarks

**Goal:** numbers that survive scrutiny: accuracy, false positives on organic backlash, human agreement, cost and latency per backend.

**Requirements**
- `tools/inject_attacks.py`: template floods, paraphrase floods, coordinated bursts, spam into a clean slice, with exact ground truth.
- `tools/label_cli.py`: 300 HD2 reviews × 2 raters → Cohen's κ (human–human, human–Jev, human–Laya).
- Benchmark harness writing to a `benchmarks` table + `GET /benchmarks`; benchmarks page (table + cost-vs-accuracy chart).
- Control runs: Gollum (must **not** inflate), Cities: Skylines II (must **not** suppress an on-topic burst).
- Adversarial set: reviews that argue for their own legitimacy; measure score shift.
- Ablations (a)–(f) from §10.

**Exit criteria:** every §10 row has a number, including failures; FP rate on Cities: Skylines II on-topic negatives is reported; Gollum adjusted rating moves by < 5 pp (target, adjust after first measurement). Results in `docs/RESULTS.md`.

---

## Phase 8: Laya distillation (Jev → Laya)

**Goal:** show that a free, local System One model fine-tuned on Jev labels closes most of the accuracy gap.

**Gate:** Jev terms permit training on outputs (Phase 0 check). If not, fine-tune on human + synthetic labels only and say so.

**Requirements:** Kaggle T4 notebook `notebooks/03_finetune_laya.ipynb` (~30K Jev-labelled questions, ~4–5 h per the Laya README); 50K batch inference in the same notebook with `predict_batch`; `tools/import_judgments.py` loads results as a normal `laya-ft` run; benchmark row added.

**Exit criteria:** the fine-tuned model has a benchmark row on the same held-out sets as Jev (never trained on the dev or eval sets); checkpoint versioned.

---

## Phase 9: Ship the public demo → **M2**

**Goal:** a $0-running-cost public link that feels live.

**Requirements**
- `tools/export_bundle.py`: summary JSON, grid Uint8, integrity scores, clusters, ~3–5K sampled review texts, `replay.jsonl.gz`; a few MB per bundle.
- `StaticBundle` data source; `npm run build:static` hides upload/fetch/run controls and shows the "runs are pre-recorded" note.
- Replay player: play/pause, 1×/4×/16×, scrub. Landing page auto-plays the 50K HD2 replay.
- Deploy to Vercel / Netlify / GitHub Pages; README with architecture, results table and how to run locally; 90-second demo video.

**Exit criteria:** the static build contains **no API key and no backend URL** (grep the `dist/` output in CI); Lighthouse performance ≥ 90 on landing; bundle review text has been PII-scrubbed and author hashes only.

---

## Cross-cutting requirements (every phase)

- **Tests:** `uv run pytest` and `npm test` green before each commit to `main`; new logic comes with tests.
- **Lint:** `uv run ruff check .` and `npm run lint` clean.
- **Reproducibility:** every run stores its full config, question-set version and pinned model version.
- **Spend:** every Jev call goes through the spend guard; prompt-iteration spend is logged in `docs/MEASUREMENTS.md`.
- **Data hygiene:** nothing under `data/` is committed; raw steamids never persisted.
- **Branching:** one branch per phase (`phase-1-backend-skeleton`, …), merged when its exit criteria pass.
