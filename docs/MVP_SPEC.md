# Rating Integrity Engine: MVP Product and Technical Spec

*v0.1, 2026-09-29; v0.2, 2026-10-08: updated to the design as built. Personal portfolio project. Companion to `RESEARCH_FINDINGS.md`. Sales, compliance and legal topics are deliberately out of scope. Decisions taken during the build are recorded in `PLAN.md` (C-items, phase blocks) and measured in `MEASUREMENTS.md` (M1–M17); this spec states their result. Where a section keeps the original plan for context, it says so.*

**Decisions locked with the owner:**

| Area | Decision |
|---|---|
| Judgment layer | System One models only, **pluggable**: Jev (hosted, TypeSafe, waitlist lifted 2026-09-27) and Laya (local, Apache-2.0) |
| Explanations | No LLM explanations. System One probabilities plus deterministic signals *are* the explanation. |
| Backend | Python |
| Frontend | React + TypeScript |
| Headline demo | Steam review bombs: Helldivers 2 (May 2024) first, then Borderlands 2, Metro 2033 Redux, Total War: ROME II and DOOM Eternal |
| Control games | Games whose reception was genuine: Gollum (known-bad), Cities: Skylines II (organic backlash), Football Manager 26 (launch backlash) (§10) |
| Compute | **CPU only.** No local GPU. Free Kaggle/Colab T4 GPUs are reserved for the future Laya fine-tune (PLAN Phase 9) |
| Language | **English only** for v1 |
| Hosting | **Replay-only public demo**, live at https://rating-integrity-engine.vaibhavvs.workers.dev (Cloudflare Workers static assets). No live runs for visitors; API spend happens only on the developer's machine |
| Ratings | **Three, side by side** (owner, 2026-10-01): raw, integrity-adjusted, and the platform's written policy applied to the same reviews |

---

## 1. Product definition

**One-liner:** Upload or fetch a review corpus. A System One model makes a few typed judgments about every review, at speed. Corpus analysis finds duplicates, bursts and coordinated clusters. You get an **integrity-adjusted rating** with a documented method and a confidence interval.

**Portfolio story (what the demo must prove):**
1. **Speed and scale.** Thousands of reviews judged live, visibly (the square grid).
2. **Corpus intelligence.** Clusters and bursts that single-review analysis can't see.
3. **Honest output.** Raw vs adjusted vs platform-policy rating, with CI and effective sample size, and controls showing the method neither inflates a bad game nor suppresses a real backlash.
4. **Engineering rigor.** Benchmarks on synthetic attacks, controls and adversarial text, comparing Jev with heuristics and with Laya zero-shot on cost, latency and accuracy. A fine-tuned Laya is future exploration (PLAN Phase 9).

**Non-goals for the MVP:** multi-tenant accounts, scraping sites other than Steam, real-time ingestion, a human review workflow beyond a simple flag queue, LLM explanations.

---

## 2. Verified facts that shape the design

| Fact | Source | Design consequence |
|---|---|---|
| Jev API: `POST /v1/systemone` with `{model, state, questions:{id:{type, instructions, criteria}}}`. Returns `noul` (0–1), `choice` + `probabilities` + `confidence`, or `score` + `probabilities` + `confidence`. Errors: 429 and 529, with backoff. | docs.typesafe.ai/api.md | One HTTP client, no SDK lock-in. Retry with backoff. |
| **Laya's `laya-serve` speaks the same wire protocol as Jev** (default `:8000`) | github.com/NandhaKishorM/laya | Switching backend means changing `base_url` + `model`. Same adapter for both. |
| Laya checkpoints: `laya` (421M, 512 ctx), `laya-multilingual` (322M), `laya-typed-decisions`. Base checkpoints are **"near random zero-shot"**; fine-tuning drives accuracy. | Laya README | Laya zero-shot is a benchmark row, not the default. *As built:* Jev's terms forbid training on its output (MCA §2.3(b), PLAN C6), so there is no Jev → Laya distillation; a fine-tune on non-Jev labels is PLAN Phase 9. |
| Laya on a T4 GPU: 32–40 ms per question; batched 103–332 questions/s; `predict_batch()` | Laya README | 6 questions/review gives ~17–55 reviews/s on a T4. CPU will be much slower [unmeasured]. |
| Jev: 1,200 requests/min, 250k tokens/s, $0.042 per 1M input tokens, output free. Limits "adjusting dynamically". | TypeSafe docs (via earlier research) | *Measured instead* (PLAN C7, C9; M8): the limits are 40 req/s and 100K tokens/s; one review per request runs at 40 reviews/s, **~21 min for 50K**. Prompt overhead dominates the cost: about **$0.07 per 1,000 reviews** with question set v5 (~$3.50 per 50K, ~$0.35 per 5K). |
| Jev weaknesses: adversarial text can sway it; weak numeric reasoning; distracted by irrelevant state | TypeSafe docs | Put the rating in words, not numbers. Keep state minimal. Deterministic signals can override. Red-team in eval. |
| Steam `appreviews`: cursor paging, ≤100 per page, `filter=recent`; `day_range` works **only from today, max 365 days**; `filter_offtopic_activity=0` includes bomb reviews | partner.steamgames.com/doc/store/getreviews | For May 2024 we must **paginate backwards** from now, so this is a one-off, cached collection job. |
| Steam rating is **binary** (`voted_up`) | same | The rating model must support binary (% positive) *and* 1–5 / 1–10 scales. |

Checked during the build:
- **Packing:** Jev does answer per item when `state` is an array (M4b), but packing changes decisions well beyond the repeat noise, so it is rejected (M12d).
- **Rate limits:** 40 req/s and 100K tokens/s (PLAN C7).
- **Training Laya on Jev output:** prohibited (PLAN C6).
- **Determinism:** Jev is not deterministic; two identical runs agree on 98.8% of decisions (M12d), so every review gets its own call.

---

## 3. System architecture

```
┌────────────────────────────── React + TS (Vite) ───────────────────────────────┐
│  Dataset picker · Run config · LIVE GRID (canvas) · Timeline · Clusters ·      │
│  Review inspector · Results · Benchmarks                                        │
└───────────────▲──────────────────────────────────────────▲─────────────────────┘
                │ REST (JSON / binary grid)                 │ SSE (run events)
┌───────────────┴──────────────────────────────────────────┴─────────────────────┐
│ FastAPI (uvicorn)                                                               │
│   /datasets  /runs  /runs/{id}/events  /clusters  /reviews  /benchmarks         │
├─────────────────────────────────────────────────────────────────────────────────┤
│ Run Orchestrator (asyncio task per run, event bus → SSE + replay recorder)      │
│                                                                                 │
│  S0 Ingest ──► S1 Deterministic ──► S2 System One ──► S3 Corpus ──► S4 Decide   │
│  normalize     features (fast,      judgments         analysis      weights,    │
│  hash authors  vectorized)          (streamed,        dupes,        adjusted    │
│                MinHash, regex,      the animated      clusters,     rating, CI  │
│                embeddings           part)             bursts                    │
│                                       │                                         │
│                          ┌────────────┴────────────┐                            │
│                          │ SystemOneClient (httpx) │  same protocol             │
│                          └─────┬──────────────┬────┘                            │
└────────────────────────────────┼──────────────┼─────────────────────────────────┘
                                 ▼              ▼
                        api.typesafe.ai     laya-serve (local :8000, CPU/GPU)
                        (Jev)               (laya english checkpoint; benchmark only)

 Storage: DuckDB single file (data/rie.duckdb) · Parquet caches · replay files (.jsonl.gz)
```

**Why this shape:**
- **S1 before S2.** Cheap deterministic features finish in seconds and fill part of the grid immediately. S2 is the slow, animated stage.
- **S3 after S2** for clusters, because cluster suspicion uses S2 outputs such as off-topic probability. Bursts and duplicates can run concurrently with S2.
- **No Celery or Redis.** A single-user portfolio app runs one asyncio background task per run. Add a queue only if hosting a multi-user live mode.
- **Replay recorder.** Every run's event stream is saved with relative timestamps. The hosted portfolio demo replays it with **no backend or API key** (see §9).

---

## 4. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Python tooling | Python 3.12, `uv`, `ruff`, `pytest`, `pydantic` v2 | Fast, modern, typed |
| API | FastAPI + uvicorn, `sse-starlette` | SSE is simpler than WebSockets for one-way progress |
| HTTP to System One | `httpx.AsyncClient` + `aiolimiter` (rate limit) + `tenacity` (backoff on 429/529) | One client for Jev and Laya; the official `typesafe-ai` SDK is optional |
| Local model | `laya[serve]` (separate process, opt-in `--extra laya`); the `laya` Python lib for batched eval and the future fine-tune | Same protocol as Jev |
| Data | DuckDB (storage + drill-down SQL), Polars (transforms), PyArrow/Parquet | Single file, zero ops |
| Text features | `datasketch` (MinHash/LSH), `sentence-transformers` `all-MiniLM-L6-v2` (CPU OK), `faiss-cpu` | Duplicates and semantic neighbours |
| Corpus analysis | `hdbscan` or `sklearn.cluster.HDBSCAN`, `umap-learn` (optional 2D map), `ruptures` (change points), `scipy` | Clusters and bursts |
| Rules/stats | NumPy; bootstrap CI done in-house | Transparent |
| Frontend | React 19 + Vite + TypeScript | — |
| UI kit | Tailwind CSS + shadcn/ui (Radix) | Fast, accessible, clean |
| State/data | TanStack Query (REST), Zustand (run/grid state), native `EventSource` (SSE) | — |
| Charts | **Custom Canvas2D** for the grid and timeline; small SVG charts for results and benchmarks | 50K cells need canvas, not DOM or SVG |
| Packaging | `docker-compose` (api, web; laya-serve behind `--profile laya`); `.env` for `TYPESAFE_API_KEY`; GitHub Actions CI; Cloudflare Workers static assets for the public demo | One command up |
| Notebooks | `notebooks/`, reserved for the future Laya fine-tune; data pulls, labelling and benchmarks became `tools/` scripts and the `/label` page | Portfolio evidence |

---

## 5. Data model (DuckDB)

```sql
datasets(id, name, source,            -- 'steam' | 'csv' | 'yelpzip' | 'synthetic'
         source_params JSON, rating_scale,  -- 'binary' | '1-5' | '1-10'
         n_reviews, created_at)

reviews(id, dataset_id, ext_id, author_hash,   -- sha256(salt+steamid); raw IDs never stored
        text, rating_raw, rating_norm,          -- rating_norm in [0,1]
        created_at, updated_at, lang,
        meta JSON)                              -- playtime_at_review, num_reviews, received_for_free, steam_purchase, votes_up …

runs(id, dataset_id, backend,        -- 'jev' | 'laya' | 'laya-ft' | 'heuristic'
     model_version, config JSON,     -- question set version, pack size, thresholds, weights
     status, started_at, finished_at,
     stats JSON, cost_usd, tokens_in)

features(run_id, review_id, n_tokens, type_token_ratio, has_url, has_promo, emoji_ratio,
         minhash_bucket, dup_group_id, dup_score, nn_cosine_max, embedding_idx)

judgments(run_id, review_id, question_id, type, value DOUBLE, choice TEXT,
          probabilities JSON, confidence DOUBLE, latency_ms, pack_id)

clusters(run_id, cluster_id, kind,   -- 'semantic' | 'duplicate' | 'burst'
         size, t_start, t_end, time_concentration, mean_similarity,
         rating_homogeneity, new_account_share, offtopic_mean, suspicion,
         top_phrases JSON)
cluster_members(run_id, cluster_id, review_id)

decisions(run_id, review_id, action,   -- KEEP | DOWNWEIGHT | FLAG | EXCLUDE
          weight, integrity_score, reasons JSON,   -- top-3 reason codes
          human_override)

labels(dataset_id, review_id, rater, label, created_at)   -- for benchmarks / human agreement
```

**Grid ordering:** *as built*, `reviews.id` is the chronological position within its dataset and equals the grid index, so no order array is needed (PLAN Phase 1). The frontend gets actions as a compact `Uint8Array`, one byte per review. Later migrations added `benchmarks` and the influence features (`features.model_note`, `influence_hits`).

---

## 6. Pipeline detail

### 6.1 S0 Ingest
- **Steam fetcher:**
  - Takes `appid`, `from`, `to`, `language` (default `english`), with `filter=recent`, `num_per_page=100` and `filter_offtopic_activity=0`.
  - Paginates by cursor until `timestamp_created < from`.
  - Politeness: 1 request/s. It is resumable (cursor checkpoint) and caches to Parquet.
  - **One-off job.** Helldivers 2 runs to hundreds of thousands of reviews, so this takes hours [estimate].
  - Sampling: stratified by day. The showcase runs use 5K subsets or whole windows (297 to 15,348 reviews); one 50K Helldivers 2 set exists for scale tests on the $0 heuristic backend.
- **CSV or Excel upload:** column-mapper UI (text, rating, timestamp, optional author, optional extras). The rating scale is auto-detected and confirmed by the user. Capped at 50 MB, 200,000 rows and, for XLSX, 200 MB decompressed.
- **Normalize:** strip HTML/BBCode (Steam uses `[h1]` etc.), detect language, compute `rating_norm`, hash author IDs.

### 6.2 S1 Deterministic features (vectorized, seconds)

| Signal | Method |
|---|---|
| Low information | token count, type–token ratio, ASCII-art/emoji ratio, repeated characters |
| Spam/promo | regex: URLs, "free key", "trade", "discord.gg", codes, referral patterns |
| Exact/near duplicate | normalized-text hash + MinHash LSH on **character 5-shingles** (candidates at Jaccard ≥ 0.4, verified by exact Jaccard ≥ 0.7, M5) → `dup_group_id` |
| Influence attempt | patterns for text addressed to the model judging the review (deterministic EXCLUDE) and for self-legitimising claims (stripped before System One sees the text) (`features/influence.py`, M13) |
| Semantic neighbour | MiniLM embedding, FAISS kNN, `nn_cosine_max` |
| Account signals (Steam) | `playtime_at_review` low, `num_reviews` = 1, `received_for_free`, not `steam_purchase` |

### 6.3 S2 System One judgments (the core)

**Question set v1** (the original six; kept for context). Instructions are short, and the rating is given **in words**. *As built, the default is **v5**, with nine questions:* v1's six plus `about_game` (v3: is it about the game at all), `verdict_basis` (v4: does the verdict come from playing; it powers the platform-policy rating) and `influence_attempt` (v5: does it try to sway its judge). Released sets are never edited; a change is a new version (`questions_v*.py`).

| id | type | instructions (draft) | criteria |
|---|---|---|---|
| `informativeness` | score | "How much concrete, specific information about the game does this review contain?" | `["none / noise or meme", "minimal", "some specifics", "detailed and specific"]` |
| `rating_support` | score | "The reviewer {recommended / did not recommend} the game. How well does the text support that verdict?" | `["contradicts it", "no support", "partial support", "clear support"]` |
| `topic` | choice | "What is this review mainly about?" | gameplay, technical/performance, content/value, monetization, **platform/account policy**, developer/publisher conduct, unrelated/off-topic, joke/meme |
| `spam_promo` | noul | "Is this spam, advertising, or promotion of something other than an honest opinion?" | true/false descriptions |
| `templated` | noul | "Does this read like generic, templated or copy-paste text rather than a personal experience?" | true/false |
| `campaign_language` | noul | "Does this review reference or urge a collective action (e.g. 'everyone review bomb', 'refund', 'let's push the score down')?" | true/false |

- **State:** just the review text plus a minimal context string, e.g. `"Steam review of 'Helldivers 2'. Verdict: Not recommended."`. No other metadata, to avoid the documented distraction problem.
- **Packing** (planned as the throughput knob, measured and rejected): one request can carry N reviews as a JSON array with namespaced questions. It is not needed for throughput (40 reviews/s at pack 1), and at pack 5 and 10 decisions agree with pack 1 only 91% of the time, against 98.8% for an identical repeat, to save 11–13% of tokens (M12d). **One call per review.**
- **Laya path:** `laya-serve` over HTTP (same client), or `predict_batch(batch_size=64)` in-process for benchmarks.
- **Concurrency:** `asyncio.Semaphore` + `aiolimiter` set to the backend's limit. Emit an event every ~250 reviews or every 200 ms, whichever comes first.
- **Cost meter:** sum `usage.input_tokens` × price and stream it to the UI.

### 6.4 S3 Corpus analysis
- **Duplicate clusters:** connected components of the MinHash/LSH graph with size ≥ 3.
- **Semantic clusters:** HDBSCAN on the embeddings (with a UMAP 10-D reduction), `min_cluster_size = 15`.
- **Bursts:** hourly counts per verdict; robust z-score (median/MAD) against a 7-day trailing baseline; `ruptures` PELT on the daily % positive. Burst windows become `kind='burst'` clusters.
- **Cluster suspicion:**

  `suspicion = weighted geo_mean(time_concentration, mean_similarity, rating_homogeneity, new_account_share, offtopic_mean)`

  - *As built:* new_account_share, offtopic_mean and similarity carry weight ½ (M13); a missing factor is skipped, with a floor of 0.02.
  - time_concentration: the densest window (15 min to 3 days) judged against a **permutation null** of random same-size corpus subsets, never the corpus-wide rate (M9c).
  - offtopic_mean: mean probability that the review is not about the game (`about_game`), or the `topic` fallback for v1/v2.
  - Each factor is stored so the UI can print: *"127 reviews · 91% within 14 min · 84% similar wording · 93% same verdict."*

### 6.5 S4 Decision policy (rule-based, every threshold in `config`; as built, 2026-10-08)

```
integrity_score = 1
  − 0.60·(1 − about_game)                         not about the game
  − 0.50·P(text contradicts its verdict)
  − 0.20·spam_promo
  − 0.15·templated
  − 0.60·max(0, influence_attempt − 0.5) / 0.5    tries to sway the judge (v5)
  − 0.20·(1 − about_game)·low_playtime            off-game AND low playtime
  (informativeness and rating support are shown, weight 0: "option B", M10)
  then × (1 − 0.5·suspicion) for members of a burst/cluster with suspicion > 0.5 and ≥ 10 reviews
       (semantic clusters only inside a detected burst, M13)

EXCLUDE    spam_promo > 0.9 AND a deterministic promo match
           OR a note addressed to the model (deterministic)
           OR a later copy (≥ 8 tokens) inside a suspicious burst/cluster
FLAG       spam_promo > 0.9 without a promo match
           OR System One confidence < 0.5 on ≥ 2 weighted questions
           OR a penalised cluster member within 0.1 ABOVE the line (grey zone, M17)
DOWNWEIGHT integrity_score < 0.55, OR a later copy (≥ 8 tokens) of an earlier review
KEEP       otherwise
Weights: KEEP 1.0 · DOWNWEIGHT 0.25 · FLAG 1.0 (counted as KEEP, shown separately) · EXCLUDE 0
```

- **Guardrail:** System One output alone never EXCLUDEs a review; every EXCLUDE needs a deterministic signal. Every review is judged, copies included.
- *Original v0.1 formula, for context:* informativeness 0.30, rating support 0.25, spam 0.20, templated 0.15, off-topic 0.10; every later copy EXCLUDEd; a symmetric grey zone. Measurements replaced each of these (M10, M6, M17).
- **Reason codes** (top 3 by contribution): `OFF_TOPIC`, `CONTRADICTS_VERDICT`, `SPAM`, `TEMPLATED`, `INFLUENCE_ATTEMPT`, `LOW_EXPERIENCE`, `NEAR_DUPLICATE`, `COORDINATED_CLUSTER`, `BURST_WINDOW`, `LOW_CONFIDENCE`; `LOW_INFO` and `UNSUPPORTED_VERDICT` appear only if their weights are raised. Account signals alone are never a per-review reason (low playtime counts only together with an off-game verdict); they feed cluster suspicion.
- **Platform-policy rating:** Steam's written review-bomb rules applied to the same reviews: whole off-topic burst windows removed, key activations dropped (`decide/platform.py`; M11, M15).
- **Adjusted rating:**
  - Formula: Σwᵢrᵢ / Σwᵢ.
  - Uncertainty: bootstrap 95% CI (2,000 resamples, M6) and n_eff = (Σw)² / Σw².
  - For Steam, it is also mapped to Steam's label bands (e.g. "Mostly Negative" → "Mixed").
- **Sensitivity:** *planned as client-side sliders; removed* (owner, 2026-10-01): the thresholds were chosen by measurement. Policy experiments re-run a finished run's answers with `backend: "cached"` at $0.

---

## 7. API contract (MVP)

| Method | Path | Purpose |
|---|---|---|
| GET | `/datasets` | List datasets (samples + uploads) |
| POST | `/datasets/csv` | Upload CSV + column mapping → dataset |
| POST | `/datasets/steam` | `{appid, from, to, language, sample_n}` → background fetch job |
| GET | `/datasets/{id}` | Metadata, rating histogram, timeline counts |
| POST | `/runs` | `{dataset_id, backend, model, pack_size, question_set, thresholds}` → `run_id` |
| GET | `/runs/{id}/events` | **SSE** stream (below) |
| GET | `/runs/{id}` | Status + summary (raw/adjusted, CI, counts, cost, throughput) |
| GET | `/runs/{id}/grid` | `application/octet-stream`: Uint8 action codes in grid order (+ `/grid/order` IDs) |
| GET | `/runs/{id}/clusters` | Clusters ranked by suspicion |
| GET | `/runs/{id}/clusters/{cid}` | Metrics, member IDs, hourly histogram, top phrases, sample reviews |
| GET | `/runs/{id}/reviews/{rid}` | Text, meta, all judgments with probabilities, features, decision, reasons, near-duplicates |
| GET | `/runs/{id}/reviews?action=&reason=&cluster=&q=` | Filterable table (paged) |
| PATCH | `/runs/{id}/reviews/{rid}` | Human override for FLAG (*not built*; the column exists) |
| GET | `/runs/{id}/export?fmt=csv|json` | Decisions + summary + methodology config |
| GET | `/runs/{id}/replay` | Recorded event stream (jsonl.gz) for static demo mode |
| GET | `/benchmarks` | Stored benchmark results (backend × dataset × metrics) |
| | *Added during the build* | `POST /runs/preflight`, `GET /runs`, `GET /runs/{id}/scores`, `GET /runs/{id}/review-details` (bulk, for the static export), `GET /datasets/{id}/hours`, `/labelsets` (blind labelling), `GET /datasets/upload-limits`. `/grid` was not needed: the replay carries the grid |

**SSE events:**
- `stage` `{name, status}`
- `features_done` `{counts}`
- `judged` `{grid_idx: Uint8 packed as base64, actions}`
- `counters` `{keep, down, flag, exclude, processed, rps, cost_usd}`
- `rating` `{raw, adjusted, ci}`
- `cluster` `{cid, kind, size, suspicion, caption}`
- `done` `{summary}`
- `error` `{message, retryable}`

---

## 8. UX: flow and screens

### 8.1 Primary flow
```
Landing ─► Choose dataset ─► Configure run ─► LIVE ANALYSIS ─► Cluster drill-down ─► Results & methodology
 (hero      (sample / Steam      (backend, pack,    (grid fills,      (click cluster or   (raw vs adjusted,
  replay)    fetch / CSV)         cost+ETA est.)     clusters pop)     burst)              sliders, export)
                                                         │
                                                         └─► Review inspector (click any square)
Side nav: Benchmarks · Flag queue · Datasets
```

### 8.2 Screens and key UI elements

**1. Landing / hero**
- *As built:* a **product picker**: choose one of the eight showcase games, then replay its recorded run ($0) or, locally, start a live Jev run behind the pre-flight. The recorded result shows below. (Planned: auto-play a 50K Helldivers 2 replay.)
- Links: Benchmarks and How it works.

**2. Dataset picker**
- *As built, merged into the landing picker:* Helldivers 2 (5K), Borderlands 2, Metro 2033 Redux, Total War: ROME II, DOOM Eternal, and the controls Football Manager 26, Cities: Skylines II and Gollum. (Planned: Overwatch 2 and a YelpZip sample; YelpZip access was never granted.)
- *Upload CSV or Excel* (local only) has a column mapper, a detected rating scale and a 10-row preview. Steam fetches run from the command line (`steam_fetcher`, `steam_import`).
- Dataset preview: rating histogram and volume timeline, so bursts are visible before analysis.

**3. Run config** (a drawer, not a page)
- *As built:* a live run uses Jev with the default question set. Heuristic, mock, Laya and cached runs go through the API. Packing is rejected, so there is no pack-size control.
- Pre-flight estimate: tokens, **$**, **ETA**, requests.
- Thresholds and weights are not editable in the UI; they are shown on the results page's method card.

**4. Live analysis (hero screen)**
- **Integrity grid.** Canvas; one square per review in chronological, row-major order, so **bursts show up as solid colored bands**.
  - Colors: pending gray, then KEEP / DOWNWEIGHT / FLAG / EXCLUDE.
  - View toggle: *Integrity* (action colours) · *Steam policy* (what the platform rules keep). (Planned: informativeness, topic and cluster colour modes; not built.)
  - Hover shows a tooltip (verdict, 80-char snippet, action); click opens the inspector. Brushing a cluster dims every other square.
- **Timeline strip** under the grid: hourly volume stacked by action, with burst windows shaded and ruptures change points marked.
- **Counters:** processed / total, reviews/s, $ spent, elapsed time, one counter per action.
- **Rating ticker:** RAW vs INTEGRITY-ADJUSTED with a CI whisker, updating live.
- **Cluster feed:** cards appear as clusters are detected (size, suspicion bar, one-line caption).
- **Stage stepper:** Ingest → Features → System One → Corpus → Decide.

**5. Cluster drill-down** (right drawer)
- Header caption: *"Cluster #17 · 127 reviews · 91% within 14 min · 84% similar wording · 93% same verdict."*
- Metric bars for each suspicion factor (the explanation), plus a mini timeline of this cluster against the corpus and top shared phrases (c-TF-IDF).
- Member list, with a diff-highlight of shared n-grams between two selected reviews.
- Action summary for members: "downweighted 104 · flagged 23".

**6. Review inspector** (modal or drawer)
- Text, verdict, date, playtime, account review count.
- **System One panel:** one row per question showing the answer, a probability bar (choice/score distribution) and a confidence chip. This is the explainability surface that replaces LLM explanations.
- Deterministic signals: chips such as NEAR_DUPLICATE (links to its twin) and NEW_ACCOUNT.
- Decision: action badge, integrity score gauge, top-3 reason codes.
- Planned: a "Compare backends" button with Jev and Laya answers side by side (not built).

**7. Results and methodology**
- Three ratings: raw, integrity-adjusted (95% CI, n_eff) and Steam policy, with the windows and key activations the policy removes.
- Waterfall chart of how each primary reason moves the rating (the steps sum exactly to adjusted − raw).
- Sliders: planned, removed (see §6.5).
- **Methodology card:** the question set, the thresholds, the backend and model version, and the note *"not the 'true' rating; the rating under this documented method."*
- Export CSV/JSON.

**8. Benchmarks**
- Table and charts: backend × dataset → precision/recall/F1, false-positive rate on organic negative bursts, agreement with human labels (Cohen's κ), reviews/s, $ per 1K, p50/p95 latency.
- The headline chart plots cost against accuracy, with each backend as a point.

**9. Flag queue** (nice-to-have; not built)
- Table of FLAG reviews with keep/downweight/exclude buttons. Overrides are written to `decisions.human_override` and double as extra labels.

### 8.3 Visual language
- Dark-first "mission control" style, with a light theme.
- Tabular numerals for counters. Monospace for IDs and probabilities.
- **Action palette must be colour-blind safe:**
  - KEEP: teal, `#2BA8A0`
  - DOWNWEIGHT: amber, `#E0A030`
  - FLAG: violet, `#8B6CEF`
  - EXCLUDE: vermilion, `#E4572E`
  - Pending: neutral gray
  - Always pair colour with a legend and patterns in the inspector.
- Motion: each square flashes in and settles over 320 ms, revealed cell by cell (a 150 ms fade read as an instant switch). Respect `prefers-reduced-motion`, which snaps to the final state.
- ~~Wireframes: low-fidelity only (Figma), for screens 4–7.~~ Waived by the owner (2026-10-01); screens are designed in code.

---

## 9. Deployment modes

| Mode | What runs | Use |
|---|---|---|
| **Local full** (developer only) | `docker compose up`: api + laya-serve (CPU) + web; Jev via `.env` key | Development, real runs, producing bundles |
| **Offline GPU batch** (future, PLAN Phase 9) | A Kaggle/Colab notebook runs Laya `predict_batch()` over a dataset. `tools/import_judgments.py` loads the results into DuckDB as a normal run. | Laya runs at scale without a local GPU |
| **Public portfolio demo** (the only hosted mode) | Static frontend on **Cloudflare Workers static assets** (https://rating-integrity-engine.vaibhavvs.workers.dev) + precomputed run bundles (`tools/export_bundle.py`: run, replay, clusters, scores, the reviews table and review details in 1,000-review chunks) | Public link, **$0 running cost, no API key, no backend** |

- **DataSource interface.** The frontend has one interface with two implementations: `LiveApi` for local development and `StaticBundle` for the public build. The public build (`npm run build:static`) leaves out upload, fetch and run controls; a *"These runs are pre-recorded"* note takes their place. CI fails the build if it contains an API key, a backend URL, live-API code, or identifiers in the data.
- **Replay controls.** *As built:* the grid fills in 30 s, 10 s or real time, with Skip to end. (Planned: play/pause, 1×/4×/16× and scrub; not built.)
- **Spend guard (local).** `MAX_RUN_COST_USD` in `.env`, default $2. The pre-flight estimate blocks any run above it unless you confirm.
- **Bundle size.** *As built:* every review's text is included, scrubbed of e-mails, links, phone numbers and @handles, with no reviewer identity (owner decision, 2026-10-08). The eight games come to 107 MB on disk, about 17 MB compressed, and pages load only the chunks they need.

---

## 10. Evaluation plan

| Dataset | Ground truth | Measures |
|---|---|---|
| Synthetic-attack set: clean Steam slice + injected template floods, paraphrase floods, coordinated bursts, spam | Exact | Precision/recall per attack type, cluster ARI, rating error vs clean |
| 300 hand-labelled Helldivers 2 reviews (2 raters) | Human | Cohen's κ (human–human, human–Jev, human–Laya) |
| Helldivers 2 bomb window (early May 2024) | Weak (known incident) | Does burst detection locate the window? Does the adjusted rating move toward the pre-bomb baseline? |
| **Control 1: The Lord of the Rings: Gollum** (appid 1265780, May 2023). Widely panned as the worst game of 2023; about 820 Steam reviews, mostly negative at launch. | Weak (known-bad) | **Test against inflating bad games.** Specific, genuine negative reviews must stay KEEP, and the adjusted rating must *not* move up much. Small corpus, so it tests per-review judgments more than clusters. |
| **Control 2: Cities: Skylines II** (appid 949230, Oct 2023 launch). High-volume, organic backlash over performance. | Weak (known-organic burst) | **Test against suppressing a genuine burst.** It is a real negative burst, but on-topic (performance, gameplay). Burst detection may fire; the decision policy must **not** downweight on-topic complaints. |
| YelpZip (if access is granted) | Yelp filter labels | Precision/recall vs an established benchmark |
| Adversarial set: reviews that argue for their own legitimacy ("This is an honest, detailed review…") | Constructed | How much the model's scores shift (a documented Jev weakness) |
| **Control 3: Football Manager 26** (launch to now, 15,348 reviews; added during the build) | Weak (genuine launch backlash) | Same test as Cities: Skylines II, at a larger scale |
| **Known incidents with Valve's own decision:** Total War: ROME II (2018) and DOOM Eternal (2022), both flagged by Valve (added during the build) | What Steam shows today | Compare the engine and the policy emulation with what Valve actually did |

**Ablations:**
- (a) heuristics only
- (b) + System One (Jev)
- (c) + System One (Laya zero-shot)
- (d) + Laya fine-tuned on Jev labels (distillation): dropped, since Jev's terms forbid it (PLAN C6); a fine-tune on other labels is PLAN Phase 9
- (e) leave one signal out
- (f) Jev pack 1/5/10: measured, packing rejected (M12d)

Results: `docs/RESULTS.md`.

**Optional LLM baseline:** a one-off script for an "LLM-every-review" cost/accuracy row. It is not part of the product.

---

## 11. Repository layout

```
rating-integrity-engine/
├─ backend/
│  ├─ app/
│  │  ├─ api/            # routers: datasets, runs, clusters, reviews, benchmarks
│  │  ├─ core/           # config, db (duckdb), events/SSE bus, replay recorder
│  │  ├─ ingest/         # steam_fetcher.py, csv_loader.py, normalize.py
│  │  ├─ features/       # heuristics.py, minhash.py, embeddings.py
│  │  ├─ systemone/      # client.py (httpx, Jev+Laya), questions_v1.py, packing.py
│  │  ├─ corpus/         # clusters.py, bursts.py, suspicion.py
│  │  ├─ decide/         # policy.py, rating.py (bootstrap, n_eff)
│  │  └─ pipeline.py     # orchestrator S0→S4
│  ├─ tests/
│  └─ pyproject.toml
├─ frontend/
│  ├─ src/
│  │  ├─ components/grid/        # IntegrityGrid (canvas), TimelineStrip
│  │  ├─ components/inspector/   # ReviewInspector, ProbabilityBar
│  │  ├─ components/clusters/    # ClusterFeed, ClusterDrawer
│  │  ├─ pages/                  # Landing, Datasets, Live, Results, Benchmarks
│  │  ├─ data/                   # DataSource: LiveApi | StaticBundle
│  │  └─ store/                  # zustand run state
│  └─ package.json
├─ tools/            # inject_attacks.py, export_bundle.py, label_cli.py
├─ notebooks/        # 01_pull_steam, 02_label, 03_finetune_laya, 04_benchmarks
├─ data/             # (gitignored) raw parquet, rie.duckdb, bundles/
└─ docker-compose.yml
```

---

## 12. Build plan

**Goal (original, 2026-09-29):** a public portfolio demo that judges 50K Steam reviews visibly, finds the Helldivers 2 bomb, reports a benchmarked integrity-adjusted rating, and compares Jev with Laya. *How it changed, and the phase status, are in `PLAN.md`; the plan below is kept as written.*

Estimates assume a solo developer working full-time-equivalent. Double them if part-time.

| # | Task (deliverable) | Activities | Est. |
|---|---|---|---|
| 0 | Access and data | Get a Jev key; `pip install laya[serve]` and smoke-test the same client against both; **measure Laya reviews/s on your CPU**; start the backward Steam pulls for Helldivers 2, Gollum and Cities: Skylines II (English only, in the background) | 2 d |
| 1 | Backend skeleton | FastAPI, DuckDB schema, CSV + Steam ingest, normalize, SSE bus, replay recorder | 3 d |
| 2 | S1 features | Heuristics, MinHash, embeddings + FAISS, unit tests | 2 d |
| 3 | S2 System One | Client (limiter, backoff, packing), question set v1, prompt tuning on 200 reviews, cost meter | 3 d |
| 4 | S3 + S4 | Duplicate/semantic clusters, bursts, suspicion, policy, rating + CI | 3 d |
| 5 | Frontend core | Canvas grid + SSE, counters, rating ticker, timeline strip, stage stepper | 4 d |
| 6 | Drill-downs | Cluster drawer, review inspector (probability bars), results page with sliders, export | 4 d |
| 7 | Evaluation | Attack injector, label 300 reviews, benchmark harness, pack-size test, adversarial set | 4 d |
| 8 | Ship | Static bundle export, replay player (speed/scrub), static build flag, deploy, README with architecture + results, 90-second demo video | 3 d |
| 9 | ~~Laya distillation~~ | Dropped: Jev's terms forbid training on its output (PLAN C6). Now PLAN Phase 9, future exploration: fine-tune Laya on non-Jev labels to bring the per-run cost to $0 | 3 d |

**Total: about 31 working days, roughly 6–7 weeks solo.** Tasks 0–6 (about 21 days) are already a demoable MVP.

**Critical path and risks:**
- **The Steam backward pull.** Start on day 1; it can take hours to days.
- **Jev packing behaviour.** It decides whether live 50K runs are possible; test on day 3.
- **Laya zero-shot quality.** Expect it to be poor. (Measured: κ ≈ 0 against Jev; Laya stays a benchmark row.)
- **Laya on CPU.** Local throughput is unmeasured. If it is slow, run Laya locally only on the 5K subset and produce 50K runs in the Kaggle notebook.
- **HDBSCAN on CPU.** Clustering 50K × 384-d embeddings is slow. Reduce with UMAP to 10-D first (minutes on CPU [estimate]), and cache embeddings per dataset so they are computed once.
- **Jev spend.** Estimated at about $1 per 50K-review run; measured at about $0.07 per 1,000 reviews (v5). Prompt iteration adds up. Iterate prompts on a fixed 200-review dev set; the spend guard covers the rest.
- **Edited reviews.** Many bomb reviews were later edited or deleted, so current `voted_up` may not match the verdict at posting time. (Confirmed: 77% of Helldivers 2 bomb-day reviews were edited, PLAN C13.) Use `timestamp_created`, and note it in the methodology.

---

## 13. Resolved decisions (2026-09-29)

1. **Compute:** CPU only. Local Laya is for the 200- and 300-review benchmark sets; a fine-tune and batch runs on Kaggle/Colab are future exploration (PLAN Phase 9).
2. **Language:** English only for v1. Use `language=english` on the Steam fetch and the `laya` English checkpoint (421M, 512 ctx). The Helldivers 2 bomb was heavily multilingual, so the methodology card must say *"English-language reviews only"* and show the English share of total reviews.
3. **Control games:** Gollum (known-bad, small) and Cities: Skylines II (organic on-topic burst, large); Football Manager 26 added later.
4. **Hosting:** replay-only static site, on Cloudflare Workers static assets since 2026-10-08. Live runs are local-only, behind a spend guard.

## 14. Verified during the build
- Packing: per-item answers work, but packing is rejected on accuracy (M4b, M12d).
- Jev rate limits: 40 req/s, 100K tokens/s (PLAN C7).
- Training Laya on Jev output: prohibited (PLAN C6).
- Laya on this CPU: 0.06–0.08 reviews/s (PLAN C8).
- Cities: Skylines II: appid 949230; the control uses 5,000 English reviews from Oct–Dec 2023.
