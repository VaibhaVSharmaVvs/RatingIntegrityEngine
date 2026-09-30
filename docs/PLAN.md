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
| C6 | **Jev → Laya distillation is prohibited.** MCA §2.3(b): customers may not "use the Services or any Output to perform model distillation, train a model to imitate the output of the Services…". | typesafe.ai/legal/mca | **Phase 8 re-scoped** (see below): fine-tune Laya on human labels + synthetic ground truth only. Confirm the reading with Solulever legal. |
| C7 | **Jev limits changed:** 40 req/s and 100K tokens/s (spec: 1,200 rpm, 250K tok/s). **Measured:** 64 reviews/s at concurrency 32 with zero 429s → 50K in ≈ 13 min at pack=1. | models.md; MEASUREMENTS M4c | **Packing is not needed for throughput.** It is now a *cost* lever only: packing 5 reviews cut tokens by 41% (M4b). Phase 3 re-framed. |
| C8 | **Laya on this CPU is unusable for bulk runs.** Measured 0.08 reviews/s (i7-1255U, 6 questions). | MEASUREMENTS.md | Local Laya is limited to the 200-review dev set. Every Laya bulk run (5K and 50K) moves to the Kaggle notebook. The "Laya" option in the live UI becomes replay-only. |
| C9 | **50K costs more than the spec's $1.** **Measured on Jev:** 1,057 input tokens/review → **$2.22 per 50K**, just above the $2 spend guard ($0.22 per 5K). | MEASUREMENTS M4c | Phase 3: trim criteria text and/or pack (−41% tokens on 5 reviews, M4b) and re-measure agreement against the untrimmed pack=1 answers. Raise the guard only as a conscious decision. |
| C10 | **Steam soft-throttles.** It returns HTTP 200 with an empty page, or 429 after about 140 pages at 1 req/s. | pull.log | Fetcher backs off on empty pages and honours `Retry-After`, paces at 1.5 s, and resumes pulls that stopped early. |
| C11 | **Laya checkpoint ships invalid temperatures** for some choice entries ("treat confidence … as uncalibrated"). | laya-serve startup warning | Don't use Laya choice `confidence` for FLAG decisions until it has been re-calibrated. Record it in the methodology card. |

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

---

## Cross-cutting requirements (every phase)

- **Tests:** `uv run pytest` and `npm test` green before each commit to `main`; new logic comes with tests.
- **Lint:** `uv run ruff check .` and `npm run lint` clean.
- **Reproducibility:** every run stores its full config, question-set version and pinned model version.
- **Spend:** every Jev call goes through the spend guard; prompt-iteration spend is logged in `docs/MEASUREMENTS.md`.
- **Data hygiene:** nothing under `data/` is committed; raw steamids never persisted.
- **Branching:** one branch per phase (`phase-1-backend-skeleton`, …), merged when its exit criteria pass.
