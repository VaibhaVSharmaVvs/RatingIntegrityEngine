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

**Found during Phase 0 execution (2026-09-30).** Measurements are in `docs/MEASUREMENTS.md`.

| # | Issue | Evidence | Action |
|---|---|---|---|
| C6 | **Jev → Laya distillation is prohibited.** MCA §2.3(b): customers may not "use the Services or any Output to perform model distillation, train a model to imitate the output of the Services…". | typesafe.ai/legal/mca | **Phase 8 re-scoped** (see below): fine-tune Laya on human labels + synthetic ground truth only. Confirm the reading with a lawyer before any Phase 8 work. |
| C7 | **Jev limits changed:** 40 req/s and 100K tokens/s (spec: 1,200 rpm, 250K tok/s). **Measured:** 64 reviews/s at concurrency 32 with zero 429s → 50K in ≈ 13 min at pack=1. | models.md; MEASUREMENTS M4c | **Packing is not needed for throughput.** It is now a *cost* lever only: packing 5 reviews cut tokens by 41% (M4b). Phase 3 re-framed. |
| C8 | **Laya on this CPU is unusable for bulk runs.** Measured 0.08 reviews/s (i7-1255U, 6 questions). | MEASUREMENTS.md | Local Laya is limited to the 200-review dev set. Every Laya bulk run (5K and 50K) moves to the Kaggle notebook. The "Laya" option in the live UI becomes replay-only. |
| C9 | **50K costs more than the spec's $1.** **Measured on Jev:** 1,057 input tokens/review → **$2.22 per 50K**, just above the $2 spend guard ($0.22 per 5K). | MEASUREMENTS M4c | Phase 3: trim criteria text and/or pack (−41% tokens on 5 reviews, M4b) and re-measure agreement against the untrimmed pack=1 answers. Raise the guard only as a conscious decision. |
| C10 | **Steam soft-throttles.** It returns HTTP 200 with an empty page, or 429 after about 140 pages at 1 req/s. | pull.log | Fetcher backs off on empty pages and honours `Retry-After`, paces at 1.5 s, and resumes pulls that stopped early. |
| C11 | **Laya checkpoint ships invalid temperatures** for some choice entries ("treat confidence … as uncalibrated"). | laya-serve startup warning | Don't use Laya choice `confidence` for FLAG decisions until it has been re-calibrated. Record it in the methodology card. |
| C12 | **Jev is not deterministic** (1/60 identical on resend; decision flips 2.6% at k=1, 1.0% at k=2). | MEASUREMENTS M7 | Reuse of identical inputs is off by default; `samples_per_review` averages k calls. Report Jev test-retest agreement as a benchmark row (it bounds achievable human–Jev agreement). |
| C13 | **Steam verdicts are current, not as-posted.** 77% of HD2 bomb-day reviews were edited (median 3 days later), mostly flipping to positive after the reversal: unedited bomb reviews are 9–16% positive, edited ones 75–86%. | MEASUREMENTS M9a | Analyse reviews as they stand today; say so on the methodology card; show edit status in the inspector/timeline; bursts are detected on volume as well as per verdict. The as-posted verdict is not recoverable from the public API. |

**Principle (owner, 2026-09-30): accuracy over speed.** When a choice trades accuracy against runtime or modest API cost, choose accuracy, but only when a measurement shows an accuracy gain. Speed and cost stay *reported*, not optimised at accuracy's expense. Applied so far: embedding context 128 → 256, LSH candidate bar 0.4, 2,000 bootstrap resamples, duplicates judged instead of skipped (MEASUREMENTS M6).

**Decision (owner, 2026-09-30): Laya stays as a benchmark backend only.** It is kept as a pluggable backend (same client, no extra code path) and one zero-shot benchmark row on the 200-review dev set. Reasons: vendor-risk hedge, an on-prem/privacy option, and a second point on the cost-accuracy chart. The fine-tune (Phase 8) moves out of the MVP to an optional stretch goal. "Laya (fine-tuned)" is dropped from the run-config UI, and local `laya-serve` becomes opt-in (`docker compose --profile laya up`).

---

## Phase overview

| Phase | Name | Est. | Depends on | Milestone |
|---|---|---|---|---|
| 0 | Setup, access, data pull | 2 d | — | ✅ Setup done (this commit) |
| 1 | Backend skeleton | 3 d | 0 | |
| 2 | S1 deterministic features | 2 d | 1 | |
| 3 | S2 System One judgments | 3 d | 1 (2 in parallel) | **Go/no-go on token cost & throughput** |
| 4 | S3 corpus + S4 decisions | 3 d | 2, 3 | Backend end-to-end |
| 5 | Frontend core (live grid) | 4 d | 1 (API contract); 4 for real data | |
| 6 | Drill-downs + results | 4 d | 4, 5 | **M1: demoable MVP** (~21 d) |
| 7 | Evaluation + benchmarks | 4 d | 6 | |
| 8 | *(stretch, out of MVP)* Laya fine-tune | 3 d + labelling | 7 (labels) | |
| 9 | Ship public demo | 3 d | 6, 7 | **M2: public launch** (~28 d) |

**Critical path:** Steam pull (start day 1) → Phase 3 Jev token-cost and throughput measurement → Phase 4 → Phase 6. The frontend (Phase 5) can start against mocked SSE fixtures as soon as the Phase 1 API contract is frozen.

---

## Phase 0: Setup, access and data pull

**Goal:** every external dependency is either confirmed working or has a known fallback, and the long-running Steam pull is under way.

**Requirements**
- [x] Git repo (local identity `vaibhavsharmavvs@gmail.com`), `.gitignore` that keeps data, secrets and PII out.
- [x] Backend: Python 3.12, `uv`, FastAPI, the full ML stack (torch CPU, sentence-transformers, faiss-cpu, umap, ruptures, datasketch, duckdb, polars), `pytest`, `ruff`.
- [x] Optional extras installed: `laya[serve]` 0.3.21, `typesafe-sdk` 0.7.2.
- [x] Frontend: React 19, Vite 8, TypeScript 6, Tailwind v4, shadcn/ui, TanStack Query, Zustand, Recharts, Vitest.
- [x] `docker-compose.yml` (api `:8001`, laya `:8000`, web `:5173`), `.env.example`, spend-guard variable.
- [x] `.env` created with a random `AUTHOR_HASH_SALT` (the fetcher refuses the default salt).
- [x] Jev API key in `.env`. Smoke test passes (`jev-1.13.0`, 0.3–0.4 s per request).
- [x] `laya-serve` running on CPU; smoke test passes with `--backend laya`.
- [x] **Measured** Laya reviews/s on this CPU with question set v1 → `docs/MEASUREMENTS.md` (C8).
- [x] Jev packing probe (works per item, −41% tokens on 5 reviews) and throughput (64 reviews/s at concurrency 32, 1,057 tokens/review) → MEASUREMENTS M4.
- [x] Steam fetcher (`app/ingest/steam_fetcher.py`, tested, PII dropped at source) running for Gollum (1265780, done), Helldivers 2 (553850) and Cities: Skylines II (949230 confirmed), English only.
- [x] Jev terms checked: **distillation prohibited** (C6). No fixed retention period; ZDR is enterprise-only.

**Process**
1. Copy `.env.example` → `.env`, add the key and a random `AUTHOR_HASH_SALT`.
2. Run the smoke script against Jev; then `uv run laya-serve` (first run downloads ~421M weights) and run it against Laya.
3. Time 200 reviews × 6 questions on Laya CPU to get reviews/s.
4. Write a minimal `ingest/steam_fetcher.py` (cursor paging, 1 req/s, checkpoint the cursor to disk, append to Parquet) and start it. Back-paginating ~2.4 years of HD2 English reviews at 100/page is thousands of pages: expect several hours [estimate].

**Exit criteria:** ✅ both backends return valid answers to an identical request; Laya CPU throughput is a measured number; Steam pull is running and resumable.

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

**✅ Delivered (2026-09-30, branch `phase-1-backend-skeleton`).** 55 backend tests. Exit criteria verified: a 5K-review mock run over live HTTP/SSE emitted every event type, finished in 1.1 s, and wrote a 13 KB replay. Tests assert that the replay matches the stream and that no raw author ID is stored.

Deviations from the spec, all deliberate:
| Area | Spec | Built | Why |
|---|---|---|---|
| Review IDs | global `reviews.id` + a `grid_order` array | `reviews.id` = chronological position in its dataset; PK `(dataset_id, id)` | Grid cell *i* is review *i*; no order array to ship or keep in sync |
| EXCLUDE on spam | `spam_promo > 0.9` alone | EXCLUDE only when a deterministic promo signal agrees; otherwise FLAG | System One alone must never EXCLUDE (research §9, CLAUDE.md). Guarded by a test |
| `judged` event | `{grid_idx, actions}` | `{indices_b64 (Uint32 LE), actions_b64 (Uint8)}` | Batches complete out of order; explicit indices are required |
| `rating` event | `{raw, adjusted, ci}` | adds `n_eff`, `final`; `ci` is null on live updates | Bootstrap runs once at the end; live ticker needs no CI |
| Fake backend | `heuristic` | `mock` | `heuristic` is the real heuristics-only baseline in Phase 2 |
| `clusters` | no caption column | `caption` column | Caption is generated from data once and served as-is |
| Dependencies | — | `pytz` | DuckDB needs it to return `TIMESTAMPTZ`; sessions are pinned to UTC |

Not built yet, on purpose: `S1` features (Phase 2), real backends and spend guard (Phase 3), real clustering and bursts (S3 is a labelled busiest-hour placeholder), `/clusters`, `/reviews`, `/export`, `/benchmarks` (Phases 4–7).

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

**✅ Delivered (2026-09-30, branch `phase-2-features`).** 79 backend tests. Measured on 49,497 real Helldivers 2 reviews (MEASUREMENTS M5):
- Deterministic S1: **8.3 s**. Warm S1: **≈ 8.5 s** ✅. Exact-copy recall 100% ✅, near-copy recall 92% ✅.
- **Cold < 5 min: missed as written.** MiniLM-L6 runs at 96–114 reviews/s on this laptop CPU, so cold embedding of 50K takes 7–9 min. Every faster option measured (shorter context, a 3-layer model, ONNX fp32/O3/int8) either wasn't faster or changed 17–81% of nearest neighbours. **Mitigation built instead:** embeddings run in a background thread overlapped with S2 (Jev takes about 13 min for 50K, network-bound), S3 waits for them, and embeddings and kNN are cached per dataset. On the critical path, cold S1 is the 8.3 s deterministic part.

Design changes vs the spec, all deliberate:
| Area | Spec | Built | Why |
|---|---|---|---|
| Shingles | "3-shingles" | **char 5-shingles** (configurable) | Word 3-shingles catch 45% of two-edit near-copies at J ≥ 0.7; char-5 catches 95%. 0 false groupings over 31,878 real pairs (M5a) |
| MinHash | datasketch | NumPy signatures + banding; LSH candidates at 0.5, **exact Jaccard verification** at 0.7 | 17–39 s → 6 s; precision 1.0 by construction; review recall 0.76 → ≥ 0.89 (M5d) |
| Duplicate action | EXCLUDE any later copy | **DOWNWEIGHT** later copies with **≥ 8 tokens** (owner decision); EXCLUDE is available via `duplicate_action` | "Good game." ×434 is not copying evidence. "One of the best games I have ever played!" ×18 is likely independent reviewers. Copies inside a detected burst are escalated in Phase 4 |
| Are copies judged? | — | **Yes**: every review goes to System One; the copy rule is a floor (a worse model verdict still wins). Byte-identical inputs share one call (−10.5% calls on HD2) | Accuracy over cost; reuse only where it cannot change an answer |
| Heuristics-only backend | Phase 7 ablation | `backend: "heuristic"` works now | Real no-API run and ablation (a). Promo → FLAG, never EXCLUDE on regex alone |
| Account signals | per-review NEW_ACCOUNT reason | **not** used per review; stored for Phase 4 cluster suspicion | New/short-playtime reviewers are often genuine; a *concentration* of them is the evidence |

**Real-data finding:** the part of the HD2 window pulled so far (6–10 May 2024) is the **positive counter-wave** after the PSN reversal: 92–93% positive, with coordinated slogans ("Just doing my part" ×997, "FOR DEMOCRACY" ×967, "MAJOR ORDER COMPLETE WE DIVE TOGETHER OR NOT AT ALL" ×186). The demo therefore has coordination in *both* directions. Short slogans (< 8 tokens) are left to S2's `campaign_language` and `informativeness` questions.

---

## Phase 3: S2 System One judgments (core)

**Goal:** six typed judgments per review from a pluggable backend, streamed with live cost, with measured Jev token cost and throughput at pack=1 (C7, C9).

**Requirements**
- `systemone/client.py`: one `httpx.AsyncClient` for Jev and laya-serve; `aiolimiter` + `asyncio.Semaphore`; `tenacity` backoff on 429/529; parses noul / choice / score answers; records `usage.input_tokens`, latency and resolved model version (C3).
- `systemone/questions_v1.py` (**drafted in Phase 0**): the six questions in §6.3, versioned. Questions name state fields in backticks (`review`, `verdict`), the convention Jev and Laya both document. No other metadata in state (Jev distraction weakness).
- `systemone/packing.py`: pack-N builder/unpacker behind a config flag, as a **cost** lever (−41% tokens at pack 5, M4b). It is not needed for throughput (M4c). Jev only: packing is broken on Laya (M1b). **Default stays pack=1 (accuracy over cost).** Packing ships only as an option, and only if dev-set agreement with pack=1 is ≥ 0.98 per question.
- **Verify Jev determinism:** the same state sent twice must return the same answers, because S2 reuses judgments for byte-identical inputs (M6c). If it is not deterministic, measure the variance and decide whether reuse is still acceptable.
- A fixed **200-review dev set** (stratified: bomb window, pre-bomb, short, long, spammy), stored and never used for final metrics.
- Pre-flight estimator: tokens, $, ETA, requests; blocks above `MAX_RUN_COST_USD`.
- Streaming: `judged` + `counters` events every ~250 reviews or 200 ms.

**Process**
1. Build client + questions; run the dev set on Jev at pack=1 with `tools/bench_throughput.py`. Record tokens/review, reviews/s and 429 rate.
2. Eyeball 50 answers; tune instruction wording (≤ 3 iterations, each logged with its cost). **Do not trim criteria text to save cost** unless agreement with the untrimmed set is ≥ 0.98 per question (accuracy over cost). At about $2 per 50K, raising `MAX_RUN_COST_USD` is the preferred lever.
3. Run the same dev set on Laya zero-shot on local CPU (~40 min at the measured 0.08 reviews/s). It is a benchmark row.

**Exit criteria / go-no-go:** Jev 50K run projected at ≤ 45 min from measured numbers, with cost reported (not capped at $2; the owner accepts modest cost for accuracy). If either fails, live runs use the 5K subset and the 50K run is recorded once and replayed. Numbers are written into `docs/MEASUREMENTS.md`. Total prompt-iteration spend is logged.

**✅ Delivered (2026-09-30, branch `phase-3-systemone`).** 122 backend tests. Measured (MEASUREMENTS M7–M8):
- **Exit criterion met:** 50K projected **20.8 min, $2.55** (v2, k=1) at Jev's documented 40 req/s. Live 5K runs sustain 40.1 reviews/s with 0 retries. The pre-flight is within **0.1%** of actual cost.
- **Jev is not deterministic** (C12): identical-input reuse is opt-in; `samples_per_review` averages k calls (k=2 halves decision flips, 2.6% → 1.0%; the owner decides whether to pay 2×).
- **Packing rejected** on 200 real reviews: 87.5% decision agreement at pack 5 against a 96.5% noise floor, and only −17% tokens.
- **Question set v2 is the default:** double LOW_INFO+TEMPLATED penalty 108 → 38, self-agreement 0.965 → 0.985, +24% tokens. Validated by Claude's review of about 20 targeted cases; Phase 7 human labels are the real test.
- **Spend guard:** 402 above `MAX_RUN_COST_USD` unless `confirm_cost`; runs stop at 1.25× the approved spend.
- **First integrity-adjusted rating** (HD2 5K, no burst/cluster logic yet): 76.4% → **73.2% (95% CI 71.8–74.5%)**, identical across 3 runs.
- **Laya zero-shot row:** 9.5% decision agreement with Jev, FLAGs 191/200 because of uncalibrated confidences (C11).
- Tests can no longer read `.env` or reach the network. During development one test did start a real Jev run on synthetic data (fixed; spend was at most cents).

Not done here, on purpose: the frontend pre-flight UI (Phase 6), per-question latency in `judgments.latency_ms` (the column exists but is not filled), and Laya-specific confidence handling (Phase 7).

---

## Phase 4: S3 corpus analysis + S4 decisions

**Goal:** clusters, bursts, per-review actions with reason codes, and an adjusted rating with honest uncertainty.

**Requirements**
- `corpus/clusters.py`: duplicate clusters (LSH connected components, size ≥ 3); semantic clusters (UMAP → 10-D, `sklearn.cluster.HDBSCAN`, `min_cluster_size=15`); c-TF-IDF top phrases.
- `corpus/bursts.py`: hourly counts per verdict, robust z-score vs 7-day trailing baseline, `ruptures` PELT on daily % positive → `kind='burst'` clusters.
- `corpus/suspicion.py`: the geometric-mean formula in §6.4 with **every factor stored** so the caption is generated from data.
- **In-burst copy escalation (owner decision 2026-09-30):** a later copy (≥ `dup_min_tokens`) that falls inside a detected burst window, or in a high-suspicion cluster, is escalated from DOWNWEIGHT (config `duplicate_in_burst_action`, default EXCLUDE; FLAG is the alternative). Copies outside bursts stay DOWNWEIGHT. Test on the Cities: Skylines II control: organic complaint waves must not trigger it.
- Account signals (low playtime, single-review account) enter here as `new_account_share` in cluster suspicion, never per review.
- `decide/policy.py`: the §6.5 rules; every threshold and weight in run `config`; top-3 reason codes.
- `decide/rating.py`: weighted rating, bootstrap 95% CI (1,000 resamples, vectorised NumPy), `n_eff`, Steam label bands.
- Guardrail tests: **System One alone can never EXCLUDE** (only deterministic duplicates or spam > 0.9 can); an on-topic genuine negative review with high informativeness stays KEEP.

**Process:** implement against the heuristic backend first so it is testable without API spend; then plug in the Phase 3 Jev results for the 5K subset.

**Exit criteria:** a full S0→S4 run on the HD2 5K subset completes; burst detection places a window in early May 2024; UMAP+HDBSCAN on 50K finishes in < 10 min on CPU (else lower dims / sample); `GET /runs/{id}` returns raw, adjusted, CI and counts.

**✅ Delivered (2026-09-30, branch `phase-4-corpus`).** 142 backend tests. Every exit criterion was measured (MEASUREMENTS M9):
- Full S0–S4 on HD2 5K with Jev: **76.4% → 72.9% (95% CI 71.5–74.2%)**. Bursts found **2024-05-03 → 05-08** at every sample size. UMAP + HDBSCAN on 50K: **3.3 min cold**. `GET /runs/{id}` returns raw / adjusted / CI / counts plus a `corpus` summary. `/runs/{id}/clusters` and `/clusters/{cid}` are added.
- **Controls pass:** CS2 organic backlash has 0 reviews penalised by clusters; Gollum is not inflated (35.7% → 34.4%).
- **Owner decisions applied:** copies inside a suspicious burst/cluster are escalated (EXCLUDE by default); outside one they stay DOWNWEIGHT. One Jev call per review (no averaging).

Deviations and findings:
| Area | Spec | Built | Why |
|---|---|---|---|
| Time concentration | share in densest 1 h window, normalised | densest window at 15 min–3 days vs a **permutation null** (random same-size corpus subsets); anchor review not counted; bursts use rate vs baseline | The corpus-lift version made 3-review clusters look maximally coordinated (M9c) |
| Geometric mean | all factors equal | missing factors skipped, floor 0.02, **new accounts at half weight** | An absent signal must not zero the score; established accounts can coordinate too |
| Penalty eligibility | any cluster | clusters with **≥ 10 reviews** | Coordination among 3 reviews is not evidence worth moving a rating for |
| Steam verdicts | as-posted | **current** (C13): 77% of bomb-day reviews were edited, median 3 days later | Not recoverable from the public API; state it on the methodology card |
| Cached backend | none | `backend: "cached"` replays a finished run's answers at $0 | Sensitivity analysis, ablations and Phase 6 sliders without new API spend |
| Small corpora | UMAP always | HDBSCAN directly on unit embeddings below 2,000 reviews | UMAP only pays off at scale, and it made the test suite 10x slower |

**Finding for Phase 7:** on HD2 the cluster stage moves the aggregate by < 0.1 pp, because coordinated slogans are already downweighted per review. Its rating value has to be demonstrated on synthetic coordinated campaigns that *look* informative. A "great community" cluster sits exactly at the 0.5 threshold, so check threshold robustness.

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

**Process:** build against **recorded SSE fixtures** from Phase 1 first (no backend needed), then switch to the live API. ~~Low-fi Figma wireframes for screens 4–7 before styling~~ *(waived by the owner, 2026-10-01: the screens are designed in code and checked in the browser).*

**Exit criteria:** a 50K replay renders at ≥ 50 fps on a mid laptop (Chrome performance panel); hover tooltip and click-to-select work; Vitest covers the store reducers and the grid colour mapping.

**✅ Delivered (2026-10-01, branch `phase-5-frontend`).** 52 frontend tests, 143 backend tests. Measured in MEASUREMENTS M10:
- 50K HD2 replay at **60 fps** (frame p95 16.9 ms, no frame > 20 ms); grid paint p95 0.4 ms, worst 2.4 ms (spec < 5 ms).
- Finished runs **auto-play**: the grid fills in 30 s (10 s and real-time options, Skip to end), cell by cell, with counters and the rating moving in step.
- Hover tooltip (verdict, 80-char snippet, hour), click-to-select, arrow-key navigation, Escape to clear. Hovering a timeline hour lights its contiguous run of cells in the grid. Hovering or pinning a cluster card dims every non-member.
- Vitest covers the store reducers, the grid colour mapping (spec hex, dimming, fade, reduced-motion snap), layout and hit-testing, timeline binning, replay pacing, the per-frame batcher and the SSE client (closes on `done`, resets on reconnect).

Deviations and findings:
| Area | Plan | Built | Why |
|---|---|---|---|
| API | Phase 1 contract | Added `GET /runs`, `GET /datasets/{id}/hours` (hourly buckets as contiguous grid ranges) and a minimal `GET /runs/{id}/reviews/{rid}` | The timeline strip needs hours; the tooltip needs text; nothing listed runs. Phase 6 extends the review endpoint with judgments |
| Palette | Spec hex in both themes | Spec hex; the grid and timeline sit on a dark **instrument surface in both themes** | Validator: in light mode teal and amber are < 3:1 on white. Darker steps of the same hues collapse amber into vermilion for deuteranopes (ΔE 0.2) |
| Fixtures | Recorded SSE fixtures from Phase 1 | Synthetic recorded run (`src/test/fixtures.ts`) + `FakeSource`; real replays under `data/` for manual runs | `data/` is gitignored; the synthetic fixture has exact ground truth |
| Replay | Phase 9 player | Finished runs auto-play from `/runs/{id}/replay`: **fill in 30 s** (or 10 s / real time), idle stages capped at 1.2 s, Skip to end; `?play=end` shows the final state | Owner feedback: the fill was too fast to watch. Scrub and pause stay in Phase 9 |
| Reveal | Cells appear per SSE batch | **Cell drip**: each batch is revealed cell by cell over its window; following events (counters, rating) wait for it; live streams use the arrival rate, and backlogs catch up | Batches of 25–250 cells popped in as blocks |
| Fade | 150 ms from pending | **Flash, then settle over 320 ms** (ease-out); rating number tweens | A 150 ms fade on a 4 px cell read as an instant switch. Reduced motion still snaps |
| Heuristic live rating | — | `pipeline.py` fills the grid per emitted chunk | Live ratings were already final on the first event (M10) |
| Starting runs | Phase 6 drawer | Runs page can start **$0 runs only** (heuristic, mock) | Exercises the live SSE path; Jev runs wait for the pre-flight drawer |
| Wireframes | Low-fi Figma for screens 4–7 before styling | **Waived** (owner, 2026-10-01) | Screens are designed in code and verified in the browser |

Open items: the color-mode toggle (informativeness/topic/cluster) and the "Compare backends" view are not built. (The runs-page hint that named the API port was dropped, so a Phase 9 `dist/` grep for the backend URL stays clean.)

---

## Phase 6: Drill-downs, results and export → **M1 demoable MVP**

**Goal:** a viewer can explain any single decision and any cluster, and see how the rating changes with the method's knobs.

**Requirements**
- Cluster drawer: data-driven caption, per-factor metric bars, mini timeline, top phrases, member list with shared n-gram highlighting, action summary.
- Review inspector: text + meta, one row per System One question (answer, probability bar, confidence chip), deterministic signal chips, integrity gauge, reason codes.
- Results page: **three ratings** (raw · integrity-adjusted · platform policy, owner decision 2026-10-01) with CIs + `n_eff`; the platform section lists the windows Steam's rules remove and the key activations dropped, plus what Valve actually did (M11c); reason waterfall; **client-side** sensitivity sliders (no backend call); methodology card (question set, thresholds, backend + pinned model version, "English-language reviews only", "reviews as they stand today, not as posted" (C13), "not the 'true' rating").
- **Help page (owner request 2026-10-01):** a static `/help` route explaining in plain language (1) the three ratings and how they differ, with the HD2 / BL2 / Metro / control numbers as worked examples; (2) the four actions (KEEP, DOWNWEIGHT, FLAG, EXCLUDE): what each means, its weight, and the exact rules that trigger it (off-topic, contradiction, copies, in-burst copies, spam + promo, low confidence, grey zone); (3) what the engine deliberately does *not* penalise (brevity, low playtime alone, on-topic complaint waves) and why, with the measured evidence; (4) clusters, bursts and suspicion factors; (5) limits (English only, current verdicts, Jev noise). Linked from the nav and from every reason chip. Copy follows the UI rules (never "fake").
- `GET /runs/{id}/export?fmt=csv|json`; filterable review table.
- Dataset picker with CSV upload + column mapper; run-config drawer with pre-flight estimate.

**Exit criteria:** a 3-minute scripted walkthrough (dataset → live run → cluster → review → results → export) works on the HD2 5K subset with no console errors. **This is the M1 gate.**

**Wording flag (legal):** UI copy never says "fake". Use "integrity weight" and "low evidential value", never name reviewers (research §9). Have a lawyer review the copy before any public link.

**Status (2026-10-01): built.**
- **API:** `GET /runs/{id}/reviews` (filters: action, reason, cluster, verdict, text; sort by time or integrity); review detail with answers, S1 signals, meta and platform status; `GET /runs/{id}/scores`; export. Exports carry no `ext_id` or `author_hash`.
- **UI:** inspector drawer, cluster drawer, results page, reviews table, `/help`, run-config drawer with pre-flight and `confirm_cost`, CSV upload with column mapper. The run views share one header (Live · Results · Reviews · How it works). Reason chips link to `/help#reason-…`.
- **Checks:** 73 frontend and 159 backend tests. The inspector's integrity arithmetic is computed client-side; it matched the stored base integrity on 150 of 150 sampled HD2 reviews. The scripted walkthrough (Playwright, system Chrome) covers runs → Jev pre-flight → live → cluster → results → reviews → inspector → help → phone width. It took 14–19 s with **0 console errors** on HD2 5K and Metro, in dark and light, with no horizontal scroll at 390 px. The pre-flight estimate for Metro was $0.15 against an actual $0.154.

| Deviation | Planned | Built | Why |
|---|---|---|---|
| "What Valve actually did" | on the results page | on `/help` (Steam policy, emulated) | M11c is per game and all-language; it is not part of a run's data |
| Sensitivity sliders | client-side sliders on the results page | **removed** (owner, 2026-10-01) | The thresholds and weights were chosen by measurement; visitors should not tune them. Policy experiments use `backend: "cached"` through the API ($0, exact) |
| Home page | runs list + new-run drawer + CSV upload | **Product picker** (the six showcase games, `frontend/src/data/showcase.ts`) → replay the recorded run ($0) or start a live Jev run behind the pre-flight. The run list and the free backends are gone. **CSV or Excel upload** (`.xlsx`, first sheet, detected from the bytes; Excel date cells become UTC timestamps; capped at `MAX_UPLOAD_MB` 50, `MAX_UPLOAD_ROWS` 200,000 and, for XLSX, `MAX_UPLOAD_EXPANDED_MB` 200 decompressed, all HTTP 413) stays as a link on the picker; this browser's uploads join the list, labelled "your upload", and can be run live with Jev (owner, 2026-10-01). The picker says "Product", since products other than games may come later. Question set v4 stays game-worded for now (owner) | Visitors should see the curated runs, not dozens of test runs. Every run stays in the database and in `docs/RUNS.md`; the cached backend remains available through the API |
| Run header | dataset name, run id, backend, question set | tabs · stages · help + theme only (owner, 2026-10-01) | It had become crowded. The backend and question set are on the results page's method card |
| Waterfall | per reason | per *primary* reason, applied in a fixed order | Each review sits in exactly one step, so the steps sum exactly to adjusted − raw |

**Open finding (owner decision):** the low-confidence FLAG cannot fire under question sets v3/v4. It needs ≥ 2 *weighted* questions below 0.5 confidence. Noul answers carry no confidence, and option B set informativeness to 0, which leaves only `rating_support`. HD2 v4 has 0 `LOW_CONFIDENCE` decisions; its 159 FLAGs come from the grey zone and spam. Options: set `low_confidence_min_questions` to 1, count unweighted score questions too, or accept the current behaviour. Any of them can be tested at $0 with the cached backend. The help page states the current behaviour.

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

**Status (2026-10-02): built and measured, two items open.**
- **Results:** in `docs/RESULTS.md`; method notes in MEASUREMENTS M12. Jev spend $2.16; every policy experiment reused answers at $0.
- **Tools:** `inject_attacks.py` + `bench_attacks.py` (exact ground truth); `make_adversarial.py` + `bench_adversarial.py`; `bench_controls.py`; `make_labelset.py` + `bench_agreement.py`; `sweep_cached.py` ($0 variants and ablations); `_api.py` (a client that retries GETs).
- **API:** `benchmarks` table (migration 4) with `GET`/`POST /benchmarks`; blind labelling via `/labelsets`.
- **UI:** `/benchmarks` (tables plus a cost-vs-accuracy chart) and `/label`.
- **Exit criteria:**
  - CS2 on-topic negative false-positive rate 0.3% ✅
  - Gollum −1.4 pp (< 5) ✅
  - every §10 row has a number or a stated reason, except two open items.
- **Open:**
  - **human labels:** two raters at `/label`, set `hd2-300`, then `tools/bench_agreement.py --record`;
  - **Laya zero-shot κ:** run `run_9e290104478b` on the 300-review set.

| Deviation | Planned | Built | Why |
|---|---|---|---|
| Labelling | `tools/label_cli.py` | `/label` page in the app (local only) | A second rater need not be a developer; labels go to the existing `labels` table |
| Laya ablation (c) | the full attack set | the 300-review label set | Laya runs at 0.06–0.08 reviews/s on CPU, about 20 h for 5,689 reviews |
| Ablation (d) | Laya fine-tuned on Jev labels | not run | Out of the MVP (Phase 8, owner decision) |
| YelpZip | if access is granted | not run | No access |

**Findings that need owner decisions** (RESULTS: recommendations):
1. Halve the off-topic and similarity suspicion weights: +10 pp attack removal, controls unchanged.
2. A deterministic detector for self-legitimising text: one sentence launders 30–39% of off-topic reviews.
3. The cluster penalty on semantic clusters: little gain, all the collateral.
4. Document that varied, on-topic coordinated campaigns are not discounted.

---

## Phase 8 (stretch, out of MVP): Laya fine-tune on non-Jev labels (re-scoped, C6)

**Goal:** show whether a free, local System One model fine-tuned on **legally clean labels** closes the accuracy gap with Jev on this task.

**Constraint:** Jev outputs must **never** enter the training set (MCA §2.3(b)). Jev appears only as an evaluation baseline. Keep a written data-lineage note for every training row.

**Label sources (no Jev):**
| Source | Covers questions | Volume | Licence |
|---|---|---|---|
| Synthetic-attack injector (Phase 7) | `templated`, `spam_promo`, `campaign_language` | exact labels, as many as needed | own data |
| Deterministic weak labels (MinHash dup groups, promo regex) | `templated`, `spam_promo` | thousands | own data |
| Expanded hand labels (`tools/label_cli.py`, ~1–2K reviews, 2 raters on a 300 overlap) | `informativeness`, `rating_support`, `topic` | ~6–12K questions | own data |
| Salminen Fake Reviews (40K) / AiGen-FoodReview (20K) | `templated` (generated text) | large | CC BY 4.0 / MIT |

**Requirements:** Kaggle T4 notebook `notebooks/03_finetune_laya.ipynb` (~30K questions, ~4–5 h per the Laya README); 50K batch inference in the same notebook with `predict_batch` (C8: CPU is too slow); `tools/import_judgments.py` loads results as a normal `laya-ft` run; benchmark row added.

**Exit criteria:** the fine-tuned model has a benchmark row on the same held-out sets as Jev (never trained on the dev or eval sets); lineage note shows zero Jev-derived rows; checkpoint versioned. Hand-labelling time (~2–3 d) is the real cost here; if it doesn't fit, fine-tune only the three questions with synthetic/weak labels and say so.

---

## Phase 9: Ship the public demo → **M2**

**Goal:** a $0-running-cost public link that feels live.

**Requirements**
- `tools/export_bundle.py`: summary JSON, grid Uint8, integrity scores, clusters, ~3–5K sampled review texts, `replay.jsonl.gz`; a few MB per bundle.
- `StaticBundle` data source; `npm run build:static` hides upload/fetch/run controls and shows the "runs are pre-recorded" note.
- Replay player: play/pause, 1×/4×/16×, scrub. Landing page auto-plays the 50K HD2 replay.
- Deploy to Vercel / Netlify / GitHub Pages; README with architecture, results table and how to run locally; 90-second demo video.

**Exit criteria:** the static build contains **no API key and no backend URL** (grep the `dist/` output in CI); Lighthouse performance ≥ 90 on landing; bundle review text has been PII-scrubbed and author hashes only.

**Status (2026-10-08): built; host chosen, Cloudflare Workers static assets (`frontend/wrangler.jsonc`, `npm run deploy`); review text published scrubbed (owner decision). Not yet deployed.**
- **Bundle:** `tools/export_bundle.py` writes `frontend/public/bundle/` (gitignored). The 8 showcase runs come to 107 MB on disk, about 17 MB gzipped. There are 1,214 files, the largest 4.2 MB, and review details are split into 1,000-review chunks that load on demand. A bulk `GET /runs/{id}/review-details` makes the export take minutes instead of an hour.
- **`StaticBundle`:** serves every page from those files, including table filtering and "Skip to end" from the recording. Runs, uploads, the pre-flight and labelling are refused.
- **Static build:** shows a "pre-recorded" note on the home page.
- **SPA fallbacks:** `_redirects` (Netlify, Cloudflare Pages), `vercel.json`, and `404.html` (GitHub Pages). `VITE_BASE` sets a subfolder base.
- **Exit criteria:**
  - `npm run check:static` (also in CI, `.github/workflows/ci.yml`) is clean on all 1,214 files: no key, model or backend URL, no live-API code, no identifier fields or e-mail addresses in the data.
  - Lighthouse on the landing page: performance **95**, accessibility 100, best practices 100 (LCP 2.4 s, TBT 20 ms).
  - Text is scrubbed of e-mails, links, phone numbers and @handles; no author hashes or Steam ids are exported.
- **Browser check:** home → replay → reviews (filtered) → inspector → benchmarks → help → skip to end, with no console errors.

| Deviation | Planned | Built | Why |
|---|---|---|---|
| Landing | auto-plays the 50K HD2 replay | the product picker; each game replays on demand | Owner decision (home page); the showcase runs are the reference runs |
| Replay player | play/pause, 1×/4×/16×, scrub | 30 s / 10 s / real time, and Skip to end | The existing controls cover the demo; scrubbing is open |
| Review text | ~3–5K sampled texts per bundle | all texts, scrubbed, or none (`--text none`) | Sampling would leave inspector and tooltip gaps. Publishing Steam review text is an owner decision (README "Responsible use") |
| Demo video | 90 s | not made | Needs the final host |


---

## Cross-cutting requirements (every phase)

- **Tests:** `uv run pytest` and `npm test` green before each commit to `main`; new logic comes with tests.
- **Lint:** `uv run ruff check .` and `npm run lint` clean.
- **Reproducibility:** every run stores its full config, question-set version and pinned model version.
- **Spend:** every Jev call goes through the spend guard; prompt-iteration spend is logged in `docs/MEASUREMENTS.md`.
- **Data hygiene:** nothing under `data/` is committed; raw steamids never persisted.
- **Branching:** one branch per phase (`phase-1-backend-skeleton`, …), merged when its exit criteria pass.
