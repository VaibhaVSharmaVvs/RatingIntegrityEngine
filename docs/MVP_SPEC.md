# Rating Integrity Engine: MVP Product and Technical Spec

*v0.1, 2026-09-29. Portfolio project. Companion to `RESEARCH_FINDINGS.md`. Sales, compliance and legal topics are deliberately out of scope.*

**Decisions locked with the owner:**

| Area | Decision |
|---|---|
| Judgment layer | System One models only, **pluggable**: Jev (hosted, TypeSafe, waitlist lifted 2026-09-27) and Laya (local, Apache-2.0) |
| Explanations | No LLM explanations. System One probabilities plus deterministic signals *are* the explanation. |
| Backend | Python |
| Frontend | React + TypeScript |
| Headline demo | Steam, Helldivers 2 review bomb (May 2024) |
| Control games | Genuinely bad games that were negative on their own merits (§10) |
| Compute | **CPU only.** No local GPU; free Kaggle/Colab T4 GPUs for fine-tuning and bulk Laya inference |
| Language | **English only** for v1 |
| Hosting | **Replay-only public demo.** No live runs for visitors; API spend happens only on the developer's machine |

---

## 1. Product definition

**One-liner:** Upload or fetch a review corpus. A System One model makes a few typed judgments about every review, at speed. Corpus analysis finds duplicates, bursts and coordinated clusters. You get an **integrity-adjusted rating** with a documented method and a confidence interval.

**Portfolio story (what the demo must prove):**
1. **Speed and scale.** Thousands of reviews judged live, visibly (the square grid).
2. **Corpus intelligence.** Clusters and bursts that single-review analysis can't see.
3. **Honest output.** Raw vs adjusted rating, with CI, effective sample size and sensitivity.
4. **Engineering rigor.** Benchmarks comparing Jev, Laya zero-shot and Laya fine-tuned on cost, latency and accuracy.

**Non-goals for the MVP:** multi-tenant accounts, scraping sites other than Steam, real-time ingestion, a human review workflow beyond a simple flag queue, LLM explanations.

---

## 2. Verified facts that shape the design

| Fact | Source | Design consequence |
|---|---|---|
| Jev API: `POST /v1/systemone` with `{model, state, questions:{id:{type, instructions, criteria}}}`. Returns `noul` (0–1), `choice` + `probabilities` + `confidence`, or `score` + `probabilities` + `confidence`. Errors: 429 and 529, with backoff. | docs.typesafe.ai/api.md | One HTTP client, no SDK lock-in. Retry with backoff. |
| **Laya's `laya-serve` speaks the same wire protocol as Jev** (default `:8000`) | github.com/NandhaKishorM/laya | Switching backend means changing `base_url` + `model`. Same adapter for both. |
| Laya checkpoints: `laya` (421M, 512 ctx), `laya-multilingual` (322M), `laya-typed-decisions`. Base checkpoints are **"near random zero-shot"**; fine-tuning drives accuracy. | Laya README | Laya zero-shot is a benchmark row, not the default. Plan a **Jev → Laya distillation** fine-tune (a strong portfolio item). |
| Laya on a T4 GPU: 32–40 ms per question; batched 103–332 questions/s; `predict_batch()` | Laya README | 6 questions/review gives ~17–55 reviews/s on a T4. CPU will be much slower [unmeasured]. |
| Jev: 1,200 requests/min, 250k tokens/s, $0.042 per 1M input tokens, output free. Limits "adjusting dynamically". | TypeSafe docs (via earlier research) | One review per request is about 20 reviews/s, **~42 min for 50K**. See §6.3 on packing. Cost for 50K is about **$1**. |
| Jev weaknesses: adversarial text can sway it; weak numeric reasoning; distracted by irrelevant state | TypeSafe docs | Put the rating in words, not numbers. Keep state minimal. Deterministic signals can override. Red-team in eval. |
| Steam `appreviews`: cursor paging, ≤100 per page, `filter=recent`; `day_range` works **only from today, max 365 days**; `filter_offtopic_activity=0` includes bomb reviews | partner.steamgames.com/doc/store/getreviews | For May 2024 we must **paginate backwards** from now, so this is a one-off, cached collection job. |
| Steam rating is **binary** (`voted_up`) | same | The rating model must support binary (% positive) *and* 1–5 / 1–10 scales. |

Things to check during build:
- Whether Jev gives per-item answers when `state` is an array.
- The maximum number of questions per request.
- Jev's rate limits after the waitlist was lifted.
- Whether Jev's terms allow using its outputs to train Laya.

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
                        (Jev)               (laya / laya-typed-decisions / fine-tuned)

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
| Local model | `laya[serve]` (separate process); `laya` Python lib for fine-tuning and batched eval | Same protocol as Jev |
| Data | DuckDB (storage + drill-down SQL), Polars (transforms), PyArrow/Parquet | Single file, zero ops |
| Text features | `datasketch` (MinHash/LSH), `sentence-transformers` `all-MiniLM-L6-v2` (CPU OK), `faiss-cpu` | Duplicates and semantic neighbours |
| Corpus analysis | `hdbscan` or `sklearn.cluster.HDBSCAN`, `umap-learn` (optional 2D map), `ruptures` (change points), `scipy` | Clusters and bursts |
| Rules/stats | NumPy; bootstrap CI done in-house | Transparent |
| Frontend | React 19 + Vite + TypeScript | — |
| UI kit | Tailwind CSS + shadcn/ui (Radix) | Fast, accessible, clean |
| State/data | TanStack Query (REST), Zustand (run/grid state), native `EventSource` (SSE) | — |
| Charts | Recharts for standard charts; **custom Canvas2D** for the grid and timeline heat strip | 50K cells need canvas, not DOM or SVG |
| Packaging | `docker-compose` (api, laya-serve, web); `.env` for `TYPESAFE_API_KEY` | One command up |
| Notebooks | `notebooks/` for data pull, labelling, fine-tune, benchmarks | Portfolio evidence |

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

**Grid ordering:** each run stores a `grid_order` array (review IDs sorted by `created_at`). The frontend gets actions as a compact `Uint8Array`, one byte per review.

---

## 6. Pipeline detail

### 6.1 S0 Ingest
- **Steam fetcher:**
  - Takes `appid`, `from`, `to`, `language` (default `english`), with `filter=recent`, `num_per_page=100` and `filter_offtopic_activity=0`.
  - Paginates by cursor until `timestamp_created < from`.
  - Politeness: 1 request/s. It is resumable (cursor checkpoint) and caches to Parquet.
  - **One-off job.** Helldivers 2 runs to hundreds of thousands of reviews, so this takes hours [estimate].
  - Sampling: stratified by day to reach **50K** for the headline set, plus a **5K** subset for live runs.
- **CSV upload:** column-mapper UI (text, rating, timestamp, optional author, optional extras). The rating scale is auto-detected and confirmed by the user.
- **Normalize:** strip HTML/BBCode (Steam uses `[h1]` etc.), detect language, compute `rating_norm`, hash author IDs.

### 6.2 S1 Deterministic features (vectorized, seconds)

| Signal | Method |
|---|---|
| Low information | token count, type–token ratio, ASCII-art/emoji ratio, repeated characters |
| Spam/promo | regex: URLs, "free key", "trade", "discord.gg", codes, referral patterns |
| Exact/near duplicate | normalized-text hash + MinHash LSH (3-shingles, Jaccard ≥ 0.7) → `dup_group_id` |
| Semantic neighbour | MiniLM embedding, FAISS kNN, `nn_cosine_max` |
| Account signals (Steam) | `playtime_at_review` low, `num_reviews` = 1, `received_for_free`, not `steam_purchase` |

### 6.3 S2 System One judgments (the core)

**Question set v1:** 6 questions per review. Instructions are short, and the rating is given **in words**.

| id | type | instructions (draft) | criteria |
|---|---|---|---|
| `informativeness` | score | "How much concrete, specific information about the game does this review contain?" | `["none / noise or meme", "minimal", "some specifics", "detailed and specific"]` |
| `rating_support` | score | "The reviewer {recommended / did not recommend} the game. How well does the text support that verdict?" | `["contradicts it", "no support", "partial support", "clear support"]` |
| `topic` | choice | "What is this review mainly about?" | gameplay, technical/performance, content/value, monetization, **platform/account policy**, developer/publisher conduct, unrelated/off-topic, joke/meme |
| `spam_promo` | noul | "Is this spam, advertising, or promotion of something other than an honest opinion?" | true/false descriptions |
| `templated` | noul | "Does this read like generic, templated or copy-paste text rather than a personal experience?" | true/false |
| `campaign_language` | noul | "Does this review reference or urge a collective action (e.g. 'everyone review bomb', 'refund', 'let's push the score down')?" | true/false |

- **State:** just the review text plus a minimal context string, e.g. `"Steam review of 'Helldivers 2'. Verdict: Not recommended."`. No other metadata, to avoid the documented distraction problem.
- **Packing.** This is the throughput knob. We need to test whether one request can carry N reviews:
  - The state is a JSON array.
  - Questions are namespaced, e.g. `r3_informativeness`.
  - `pack=1` is the safe baseline: ~42 min for 50K on Jev.
  - `pack=10` would be ~4–5 min, if the per-item answers hold up.
  - **Benchmark accuracy at pack 1/5/10.** If packing hurts accuracy, live demos use the 5K subset and the 50K run is replayed.
- **Laya path:** `laya-serve` over HTTP (same client), or `predict_batch(batch_size=64)` in-process for benchmarks.
- **Concurrency:** `asyncio.Semaphore` + `aiolimiter` set to the backend's limit. Emit an event every ~250 reviews or every 200 ms, whichever comes first.
- **Cost meter:** sum `usage.input_tokens` × price and stream it to the UI.

### 6.4 S3 Corpus analysis
- **Duplicate clusters:** connected components of the MinHash/LSH graph with size ≥ 3.
- **Semantic clusters:** HDBSCAN on the embeddings (with a UMAP 10-D reduction), `min_cluster_size = 15`.
- **Bursts:** hourly counts per verdict; robust z-score (median/MAD) against a 7-day trailing baseline; `ruptures` PELT on the daily % positive. Burst windows become `kind='burst'` clusters.
- **Cluster suspicion:**

  `suspicion = geo_mean(time_concentration, mean_similarity, rating_homogeneity, new_account_share, offtopic_mean)`

  - time_concentration: share of the cluster inside its densest 1-hour window, normalized.
  - offtopic_mean: mean probability that `topic` is off-topic or platform/policy.
  - Each factor is stored so the UI can print: *"127 reviews · 91% within 14 min · 84% similar wording · 93% same verdict."*

### 6.5 S4 Decision policy (v1, rule-based, every threshold in `config`)

```
integrity_score = 1
  − 0.30·(1 − informativeness_norm)
  − 0.25·(1 − rating_support_norm)
  − 0.20·spam_promo
  − 0.15·templated
  − 0.10·offtopic_prob
  then × cluster_penalty (1 − 0.5·suspicion) if the review is in a cluster with suspicion > τ

EXCLUDE    exact/near duplicate of an earlier review (keep the first) OR spam_promo > 0.9
FLAG       System One confidence < 0.5 on ≥2 questions
           OR (member of a high-suspicion cluster AND integrity_score in the grey zone)
DOWNWEIGHT integrity_score < 0.55
KEEP       otherwise
Weights: KEEP 1.0 · DOWNWEIGHT 0.25 · FLAG 1.0 (counted as KEEP, shown separately) · EXCLUDE 0
```

- **Reason codes** (top 3 by contribution): `LOW_INFO`, `UNSUPPORTED_VERDICT`, `OFF_TOPIC`, `SPAM`, `TEMPLATED`, `NEAR_DUPLICATE`, `COORDINATED_CLUSTER`, `BURST_WINDOW`, `NEW_ACCOUNT`, `LOW_CONFIDENCE`.
- **Adjusted rating:**
  - Formula: Σwᵢrᵢ / Σwᵢ.
  - Uncertainty: bootstrap 95% CI (1,000 resamples) and n_eff = (Σw)² / Σw².
  - For Steam, it is also mapped to Steam's label bands (e.g. "Mostly Negative" → "Mixed").
- **Sensitivity:** recompute on the client from the per-review `integrity_score`s as the user moves the DOWNWEIGHT weight and threshold sliders. This needs no backend call.

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
| PATCH | `/runs/{id}/reviews/{rid}` | Human override for FLAG |
| GET | `/runs/{id}/export?fmt=csv|json` | Decisions + summary + methodology config |
| GET | `/runs/{id}/replay` | Recorded event stream (jsonl.gz) for static demo mode |
| GET | `/benchmarks` | Stored benchmark results (backend × dataset × metrics) |

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
- Auto-plays a **replay** of the 50K Helldivers 2 run, so the product demonstrates itself in 10 seconds.
- CTAs: "Run it yourself" and "See benchmarks".

**2. Dataset picker**
- Cards for the samples:
  - Helldivers 2, May 2024 (50K)
  - Helldivers 2, 5K live subset
  - Overwatch 2, Aug 2023
  - Synthetic-attack set (with ground truth)
  - YelpZip sample (if access is granted)
- Tabs: *Fetch from Steam* (appid, date range, language, sample size) and *Upload CSV*. Upload has a column mapper, a detected rating scale and a 10-row preview.
- Dataset preview: rating histogram and volume timeline, so bursts are visible before analysis.

**3. Run config** (a drawer, not a page)
- Backend segmented control: **Jev** | **Laya** | **Laya (fine-tuned)** | **Heuristics only**.
- Pack size; question set version.
- Pre-flight estimate: tokens, **$**, **ETA**, requests.
- "Advanced": thresholds and weights, for methodology transparency.

**4. Live analysis (hero screen)**
- **Integrity grid.** Canvas; one square per review in chronological, row-major order, so **bursts show up as solid colored bands**.
  - Colors: pending gray, then KEEP / DOWNWEIGHT / FLAG / EXCLUDE.
  - Color-mode toggle: *Action* · *Informativeness heatmap* · *Topic* · *Cluster*.
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
- Button: "Compare backends" shows the Jev vs Laya answers side by side, when both runs exist.

**7. Results and methodology**
- Big-number pair: *Raw 33% positive → Adjusted 58% (95% CI 56–60%) · n_eff 31,204 of 50,000*. These figures are placeholders, not results.
- Waterfall chart of how each reason moves the rating.
- Sliders: DOWNWEIGHT weight (0–1), grey-zone threshold, include/exclude flags. The rating recomputes instantly on the client.
- **Methodology card:** the question set, the thresholds, the backend and model version, and the note *"not the 'true' rating; the rating under this documented method."*
- Export CSV/JSON.

**8. Benchmarks**
- Table and charts: backend × dataset → precision/recall/F1, false-positive rate on organic negative bursts, agreement with human labels (Cohen's κ), reviews/s, $ per 1K, p50/p95 latency.
- The headline chart plots cost against accuracy, with each backend as a point.

**9. Flag queue** (nice-to-have)
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
- Motion: squares fade in over 150 ms. Respect `prefers-reduced-motion`, which snaps to the final state.
- Wireframes: low-fidelity only (Figma, per Solulever guidance), for screens 4–7.

---

## 9. Deployment modes

| Mode | What runs | Use |
|---|---|---|
| **Local full** (developer only) | `docker compose up`: api + laya-serve (CPU) + web; Jev via `.env` key | Development, real runs, producing bundles |
| **Offline GPU batch** (developer only) | A Kaggle/Colab notebook runs Laya `predict_batch()` over a dataset. `tools/import_judgments.py` loads the results into DuckDB as a normal run. | 50K-scale Laya runs without a local GPU |
| **Public portfolio demo** (the only hosted mode) | Static frontend (Vercel / Netlify / GitHub Pages) + precomputed run bundles (summary JSON, grid Uint8, clusters, sampled reviews, `replay.jsonl.gz`) | Public link, **$0 running cost, no API key, no backend** |

- **DataSource interface.** The frontend has one interface with two implementations: `LiveApi` for local development and `StaticBundle` for the public build. The public build is compiled with `VITE_MODE=static`, which leaves out upload, fetch and run controls. Their place is taken by a *"Runs are pre-recorded. See the repo to run locally"* note.
- **Replay controls.** The public build offers play, pause, 1×/4×/16× speed, and scrub. The replay then feels live without costing anything.
- **Spend guard (local).** `MAX_RUN_COST_USD` in `.env`, default $2. The pre-flight estimate blocks any run above it unless you confirm.
- **Bundle size.** 50K reviews × (action byte + integrity score) is well under 1 MB. Include review text only for sampled or cluster-member reviews, at about 3–5K reviews [estimate], to keep each bundle a few MB.

---

## 10. Evaluation plan

| Dataset | Ground truth | Measures |
|---|---|---|
| Synthetic-attack set: clean Steam slice + injected template floods, paraphrase floods, coordinated bursts, spam | Exact | Precision/recall per attack type, cluster ARI, rating error vs clean |
| 300 hand-labelled Helldivers 2 reviews (2 raters) | Human | Cohen's κ (human–human, human–Jev, human–Laya) |
| Helldivers 2 bomb window (early May 2024) | Weak (known incident) | Does burst detection locate the window? Does the adjusted rating move toward the pre-bomb baseline? |
| **Control 1: The Lord of the Rings: Gollum** (appid 1265780, May 2023). Widely panned as the worst game of 2023; about 820 Steam reviews, mostly negative at launch. | Weak (known-bad) | **Test against inflating bad games.** Specific, genuine negative reviews must stay KEEP, and the adjusted rating must *not* move up much. Small corpus, so it tests per-review judgments more than clusters. |
| **Control 2: Cities: Skylines II** (appid 949230 [verify], Oct 2023 launch). High-volume, organic backlash over performance. | Weak (known-organic burst) | **Test against suppressing a genuine burst.** It is a real negative burst, but on-topic (performance, gameplay). Burst detection may fire; the decision policy must **not** downweight on-topic complaints. |
| YelpZip (if access is granted) | Yelp filter labels | Precision/recall vs an established benchmark |
| Adversarial set: reviews that argue for their own legitimacy ("This is an honest, detailed review…") | Constructed | How much the model's scores shift (a documented Jev weakness) |

**Ablations:**
- (a) heuristics only
- (b) + System One (Jev)
- (c) + System One (Laya zero-shot)
- (d) + Laya fine-tuned on Jev labels (distillation)
- (e) leave one signal out
- (f) Jev pack 1/5/10

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

## 12. Build plan (ProtrackLite)

🎯 **Goal:** a public portfolio demo that judges 50K Steam reviews visibly, finds the Helldivers 2 bomb, reports a benchmarked integrity-adjusted rating, and compares Jev with Laya.

Estimates assume a solo developer working full-time-equivalent. Double them if part-time.

| # | ✅ Task (deliverable) | 📌 Activities | Est. |
|---|---|---|---|
| 0 | Access and data | Get a Jev key; `pip install laya[serve]` and smoke-test the same client against both; **measure Laya reviews/s on your CPU**; start the backward Steam pulls for Helldivers 2, Gollum and Cities: Skylines II (English only, in the background) | 2 d |
| 1 | Backend skeleton | FastAPI, DuckDB schema, CSV + Steam ingest, normalize, SSE bus, replay recorder | 3 d |
| 2 | S1 features | Heuristics, MinHash, embeddings + FAISS, unit tests | 2 d |
| 3 | S2 System One | Client (limiter, backoff, packing), question set v1, prompt tuning on 200 reviews, cost meter | 3 d |
| 4 | S3 + S4 | Duplicate/semantic clusters, bursts, suspicion, policy, rating + CI | 3 d |
| 5 | Frontend core | Canvas grid + SSE, counters, rating ticker, timeline strip, stage stepper | 4 d |
| 6 | Drill-downs | Cluster drawer, review inspector (probability bars), results page with sliders, export | 4 d |
| 7 | Evaluation | Attack injector, label 300 reviews, benchmark harness, pack-size test, adversarial set | 4 d |
| 8 | Laya distillation | Fine-tune on Jev labels in a Kaggle T4 notebook (~4–5 h per the Laya README), run 50K batch inference in the same notebook, import the judgments, add a benchmark row | 3 d |
| 9 | Ship | Static bundle export, replay player (speed/scrub), static build flag, deploy, README with architecture + results, 90-second demo video | 3 d |

**Total: about 31 working days, roughly 6–7 weeks solo.** Tasks 0–6 (about 21 days) are already a demoable MVP.

**Critical path and risks:**
- **The Steam backward pull.** Start on day 1; it can take hours to days.
- **Jev packing behaviour.** It decides whether live 50K runs are possible; test on day 3.
- **Laya zero-shot quality.** Expect it to be poor, and plan task 8 in.
- **Laya on CPU.** Local throughput is unmeasured. If it is slow, run Laya locally only on the 5K subset and produce 50K runs in the Kaggle notebook.
- **HDBSCAN on CPU.** Clustering 50K × 384-d embeddings is slow. Reduce with UMAP to 10-D first (minutes on CPU [estimate]), and cache embeddings per dataset so they are computed once.
- **Jev spend.** About $1 per 50K-review run, but prompt iteration adds up. Iterate prompts on a fixed 200-review dev set; the spend guard covers the rest.
- **Edited reviews.** Many bomb reviews were later edited or deleted, so current `voted_up` may not match the verdict at posting time [plausible, verify]. Use `timestamp_created`, and note it in the methodology.

---

## 13. Resolved decisions (2026-09-29)

1. **Compute:** CPU only. Laya fine-tuning and 50K batch runs happen on Kaggle/Colab; local Laya is for the 5K subset and development.
2. **Language:** English only for v1. Use `language=english` on the Steam fetch and the `laya` English checkpoint (421M, 512 ctx). The Helldivers 2 bomb was heavily multilingual, so the methodology card must say *"English-language reviews only"* and show the English share of total reviews.
3. **Control games:** Gollum (known-bad, small) and Cities: Skylines II (organic on-topic burst, large).
4. **Hosting:** replay-only static site. Live runs are local-only, behind a spend guard.

## 14. Still to verify during build
- Whether Jev gives per-item answers with array state and packed questions, and the maximum questions per request.
- Current Jev rate limits after the waitlist was lifted.
- Whether Jev's terms allow using its outputs to fine-tune Laya.
- Laya reviews/s on your CPU.
- The Cities: Skylines II appid, and how many English reviews it had in its launch window.
