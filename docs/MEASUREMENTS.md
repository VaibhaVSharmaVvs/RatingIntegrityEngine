# Measurements

Measured numbers only. Each entry states date, machine, command and raw output. Estimates belong in `PLAN.md`, not here.

**Dev machine:** Intel i7-1255U (10 cores / 12 threads), 15.6 GB RAM, Windows 11, no GPU. Python 3.12.14, torch 2.14.0+cpu.

---

## M1. Laya CPU throughput, question set v1 (2026-09-30)

- Model: `laya==0.3.21`, checkpoint `english` (revision `55cf4c4e`), served by `laya-serve` with `LAYA_MODELS=english LAYA_DEVICE=cpu LAYA_MAX_LOADED=1`.
- Workload: 40 real Gollum Steam reviews (random sample, seed 7), 6 questions each (`app/systemone/questions_v1.py`), one request per review, one untimed warm-up request.
- Command: `uv run python ../tools/bench_throughput.py --backend laya --n 40 --concurrency <c>`
- A Steam pull (network-bound) was running at the same time.

| Concurrency | Wall | Reviews/s | Questions/s | p50 latency | p95 latency | Input tokens/review |
|---|---|---|---|---|---|---|
| 1 | 500.3 s | 0.08 | 0.5 | 10.18 s | 23.47 s | 1,390 |
| 4 | 548.0 s | 0.07 | 0.4 | 50.48 s | 74.86 s | 1,518 |

Concurrency gives no speedup: the server is CPU-bound, so latency grows about 5× instead.

**Caveat:** the two rows sampled *different* reviews (hence the different token counts). `load_pull` de-duplicated with an order-unstable `unique()`. It is now order-stable and sorted; re-run to get strictly comparable rows.

**Implication:** at 0.08 reviews/s, 5K reviews take about 17 h and 50K about 174 h. Local CPU Laya is only usable for the 200-review dev set (PLAN C8).

**Response shape:** laya-serve returns the documented Jev fields plus extras: `answer_confidence`, `action.act_probability`, and a `confidence` on noul answers. The client must ignore unknown fields.

**Calibration warning at startup:** "this checkpoint ships invalid temperatures or values outside [0.5, 5]; using choice:11+=0.1006 -> 0.5. Treat confidence from the affected entries as uncalibrated." (PLAN C11)

## M1b. Laya zero-shot sanity check and packing probe (2026-09-30)

Command: `uv run python ../tools/smoke_systemone.py --backend laya [--packed 5]` (3 short smoke questions, not v1). The server reports `model=laya-rl-agent` whatever the request's `model` says, so store the **response** model field (PLAN C3).

| # | Review (verdict) | Expected | informativeness (0–3) | spam_promo | campaign_language |
|---|---|---|---|---|---|
| 0 | PSN account requirement… Refunded. (Not rec.) | some specifics, not spam, not campaign | 1.09 | 0.081 | 0.027 |
| 1 | Stratagem combos… 60 hours, still fun. (Rec.) | detailed | 1.40 | 0.027 | 0.023 |
| 2 | "bad" (Not rec.) | none | 1.07 | 0.108 | 0.008 |
| 3 | Everyone go review bomb this… (Not rec.) | campaign | 0.74 | 0.143 | **0.932** ✅ |
| 4 | Free keys at discord.gg/xxxx (Rec.) | spam | 0.75 | **0.497** ❌ | 0.243 |

Single-request tokens: 267 + 264 + 210 + 246 + 240 = 1,227. Latency after the first call: 0.6–0.8 s for 3 questions.

**Packed (5 reviews, array state, namespaced questions `r{i}_*`, 1 request):** 22,459 ms, **3,780 input tokens**. Every item got near-identical answers (informativeness 0.56–0.59, spam 0.95–0.96, campaign 0.93–0.94). **Packing is broken on Laya**: it does not answer per item, and it costs about 3× the tokens of single requests. Jev packing is still to be measured.

## M2. Steam `appreviews` behaviour (2026-09-30)

- No API key needed. The response includes PII (`steamid`, `personaname`, `profile_url`, avatar hash, hardware); the fetcher hashes `steamid` and drops the rest before writing.
- At 1 req/s, **HTTP 429 after ~140 consecutive pages**. Steam also soft-throttles by returning `success=1` with an empty page. Replaying the same cursor a few minutes later returned 100 reviews. (PLAN C10)
- Current English review totals (`query_summary`, `language=english`, `filter_offtopic_activity=0`):

| App | appid | Release | English reviews (all time) |
|---|---|---|---|
| Helldivers 2 | 553850 | 2024-02-08 | 822,993 (70.7% of 1,164,640 all-language). Negative share: 19.5% English vs 24.4% all languages |
| Cities: Skylines II | 949230 | 2023-10-24 | 46,741 |
| The Lord of the Rings: Gollum | 1265780 | 2023-05-25 | 688 |

## M3. Steam pulls

| Pull | Window (UTC) | Pages | Reviews seen | Stored (in window) | Status |
|---|---|---|---|---|---|
| Gollum 1265780 | 2023-05-01 → 2023-07-31 | 8 | 688 | 297 | done (reached first review) |
| Helldivers 2 553850 | 2024-04-01 → 2024-06-30 | | | | running |
| Cities: Skylines II 949230 | 2023-10-01 → 2023-12-31 | | | | queued after HD2 |

## M4. Jev (2026-09-30)

Documented limits (docs.typesafe.ai/models.md, 2026-09-30): `jev-latest` → `jev-1.13.0`, 40 req/s, 100K tokens/s, 64K context, $0.042 per 1M input tokens (output free), state counted once per request, each question counted separately.

### M4a. Smoke test (3 short questions, 1 review per request)

Command: `uv run python ../tools/smoke_systemone.py --backend jev`. Response `model` = `jev-1.13.0`.

| # | Review (verdict) | informativeness (0–3) | conf | spam_promo | campaign_language | Input tokens | Latency |
|---|---|---|---|---|---|---|---|
| 0 | PSN account requirement… Refunded. (Not rec.) | 1.14 | 0.78 | 0.10 | 0.09 | 413 | 659 ms (first) |
| 1 | Stratagem combos… 60 hours, still fun. (Rec.) | 1.89 | 0.89 | 0.04 | 0.02 | 412 | 346 ms |
| 2 | "bad" (Not rec.) | 0.26 | 0.74 | 0.08 | 0.03 | 394 | 323 ms |
| 3 | Everyone go review bomb this… (Not rec.) | 0.17 | 0.83 | **0.85** ⚠️ | **0.99** ✅ | 406 | 425 ms |
| 4 | Free keys at discord.gg/xxxx (Rec.) | 0.15 | 0.85 | **0.98** ✅ | 0.07 | 402 | 391 ms |

Every row ranks correctly, unlike Laya zero-shot (M1b). **Overlap:** the campaign call also scores 0.85 on spam, so the decision policy must not penalise the same review twice for correlated signals. Noul answers carry no `confidence` on Jev (Laya adds one). `output_tokens` is reported (55 per request) but is free.

### M4b. Packing probe (5 reviews, array state, namespaced questions)

Command: `... --backend jev --packed 5`. One request: 362 ms, **1,191 input tokens** (vs 2,027 for the five single requests: **−41%**), 294 output tokens.

| # | informativeness single → packed | spam single → packed | campaign single → packed |
|---|---|---|---|
| 0 | 1.14 → 1.44 | 0.10 → 0.05 | 0.09 → 0.05 |
| 1 | 1.89 → 2.08 | 0.04 → 0.03 | 0.02 → 0.02 |
| 2 | 0.26 → 0.11 | 0.08 → 0.04 | 0.03 → 0.02 |
| 3 | 0.17 → 0.40 | 0.85 → 0.33 | 0.99 → 0.99 |
| 4 | 0.15 → 0.00 | 0.98 → 0.98 | 0.07 → 0.04 |

Jev answers per item under packing, unlike Laya. Only 5 items: an anecdote, not an agreement measurement. The Phase 3 dev-set test decides.

### M4c. Throughput, question set v1 (6 questions, 1 review per request)

Command: `uv run python ../tools/bench_throughput.py --backend jev --n 200 --concurrency <c>`, 200 Gollum reviews (seed 7, same sample both rows).

| Concurrency | Wall | Reviews/s | Questions/s | p50 | p95 | Input tokens/review | 429s |
|---|---|---|---|---|---|---|---|
| 8 | 9.0 s | 22.21 | 133.2 | 0.34 s | 0.42 s | 1,057 | 0 |
| 32 | 3.1 s | 64.41 | 386.5 | 0.44 s | 0.59 s | 1,057 | 0 |

Throughput at concurrency 32 is above the documented 40 req/s with no throttling (limits "adjusting dynamically"). Extrapolated from measured rates: 5K ≈ 1.3 min, 50K ≈ 13 min.

**Cost (computed from measured tokens):** 1,057 × $0.042/1M = $0.0000444 per review → **$0.22 per 5K, $2.22 per 50K**. That is above the $2 default spend guard (PLAN C9 confirmed).

**Spend on 2026-09-30:** ≈ 427K input tokens across all probes ≈ **$0.018**.

---

## M5. Phase 2: S1 deterministic and semantic features (2026-09-30)

### M5a. Shingle scheme for near-duplicate detection

Injected near-copies: 200 synthetic reviews (15–40 words), each with one word dropped and one word swapped. False groupings: all 31,878 pairs of real Gollum reviews with ≥ 8 words (253 reviews, different people).

| Scheme | Near-copy Jaccard (median) | Near-copies at J ≥ 0.7 | Real pairs at J ≥ 0.7 | Real pairs, max J |
|---|---|---|---|---|
| word 3-shingles (spec) | 0.69 | 45% | 0 | 0.16 |
| word 2-shingles | 0.79 | 79% | 0 | 0.19 |
| char 4-shingles | 0.86 | 98% | 0 | 0.30 |
| **char 5-shingles (chosen)** | **0.84** | **95%** | **0** | **0.24** |
| char 7-shingles | 0.80 | 89% | 0 | 0.20 |

Detection test (`test_duplicate_detection_recall_on_injected_copies`, char-5, LSH at 0.7): exact recall 100%, near recall 92%, 0% of 2,000 organic texts grouped.

**Caveat:** the false-grouping check uses one small game. Re-check on Helldivers 2 / Cities: Skylines II organic windows in Phase 7.

### M5b. Embedding model on CPU (i7-1255U, torch 2.14 CPU, 2,000 real reviews)

"NN agreement" = share of reviews whose top-1 nearest neighbour is the same as under MiniLM-L6 @ 128 tokens.

| Option | Reviews/s | 50K (extrapolated) | NN agreement |
|---|---|---|---|
| all-MiniLM-L6-v2 @128, torch | 93–97 (62 when the laptop is hot, same code and env) | 8.6–13 min | 1.00 (reference) |
| all-MiniLM-L6-v2 @64, torch | 127 | 6.5 min | 0.48 |
| paraphrase-MiniLM-L3-v2 @128 | 193 | 4.3 min | 0.19 |
| MiniLM-L6 ONNX fp32 | 86 | 9.7 min | 1.00 |
| MiniLM-L6 ONNX O3 (bs 32) | 88 | 9.5 min | 0.99 |
| MiniLM-L6 ONNX quint8 AVX2 (bs 128) | 102 | 8.2 min | 0.83 |
| torch threads 2 / 4 / 6 / 8 / 10 / 12 | 26 / 44 / 57 / 53 / 62 / 62 (hot run) | | |

**Decision:** keep MiniLM-L6 @128 on torch. Every faster option changes the neighbourhoods a lot (quint8 is only ~5% faster and loses 17% agreement). The cold cost is hidden by running embeddings in the background, overlapped with S2, and cached per dataset. The ONNX extra was removed: it downgraded `transformers` and gave no speedup.

**Noise:** identical code and environment measured 93–97 reviews/s early and 62 later in the session. Laptop throughput varies by about ±35% under sustained load, so treat single CPU numbers here as ±35%.

### M5c. S1 on 49,497 real Helldivers 2 reviews (2024-05-06 18:20 → 2024-05-10 01:40 UTC), measured 2026-09-30

Command: `uv run python ../tools/bench_features.py --pull 553850_2024-04-01_2024-06-30 --n 50000`. This is the part of the pull finished at the time: the positive counter-wave after the PSN reversal, 93.1% positive.

| Step | Time |
|---|---|
| normalise (markup strip + PII scrub) | 3.0 s |
| heuristics (text + account) | 4.2 s |
| MinHash LSH (char-5, 128 perms) | 17.0 s |
| **deterministic total** | **21.1 s** |
| embeddings, cold | 517.8 s (96 reviews/s) |
| kNN (FAISS flat IP, 384-d) | 18.5 s |
| embeddings, warm (cache load) | 0.2 s |

Feature counts: 143 with a URL, **14 promo**, 13,462 low-info (≤ 3 tokens), **12,315 exact-duplicate reviews (25%)** in 1,390 near-dup groups, **466 excludable** (a later copy with ≥ 8 tokens), 724 low playtime, 8,358 single-review accounts, 12,312 with a semantic neighbour at cosine ≥ 0.95.

Largest duplicate groups (text, copies, share positive): "Just doing my part" 997 (0.99), "FOR DEMOCRACY" 967 (1.0), "!" 445, "Good game." 434, "Democracy!" 410, "Great game" 383, "We dive together or not at all" 331 (0.93). Among the 155 groups with ≥ 8 tokens (969 reviews): "MAJOR ORDER COMPLETE WE DIVE TOGETHER OR NOT AT ALL" 186, "That's one more victory for the right side of history" 93, "We don't like sony. We dive together, or we don't dive at all" 73. **Possible false positive:** "One of the best games that i have ever played!" 18. Generic praise that independent reviewers repeat; this is why `duplicate_action` is configurable.

### M5d. MinHash implementation: speed and accuracy (same 49,497 texts, frozen snapshot)

**Why rewritten:** profiling showed datasketch hashing each shingle with Python-level SHA-1: 6.1M calls, about 10 s of a 23 s run. Python shingling added 5 s. Being per-item Python, it also swung 17–39 s with laptop throttling.

Ground truth: the exact char-5 Jaccard of every candidate pair either method proposed. "Review recall" = share of reviews that have a true J ≥ 0.7 partner and end up grouped.

| Implementation | Time | Pair precision | Pair recall | Review recall | Reviews wrongly grouped |
|---|---|---|---|---|---|
| datasketch MinHash + LSH @0.7, estimate verify | 11.7 s (LSH only) | 0.859 | 0.790 | — | — |
| NumPy MinHash, LSH @0.7, estimate verify | 0.43 s (LSH only) | 0.880 | 0.715 | 0.756 | 153 |
| NumPy, LSH @0.6, estimate verify | 0.40 s | 0.843 | — | 0.866 | 228 |
| NumPy, LSH @0.5, estimate verify | 0.57 s | 0.832 | — | 0.891 | 263 |
| **Shipped: NumPy, LSH @0.5, exact-Jaccard verify** | **6.1–6.4 s (all of `duplicate_groups`)** | **1.0 by construction** | ≥ the row above | **≥ 0.891** | **0** |

The shipped version checks each candidate against the exact Jaccard of its shingle-hash sets (`np.intersect1d`). Every accepted pair is a true J ≥ 0.7 (minimum accepted `dup_score` = 0.700), apart from uint32 hash collisions, which are negligible at about 150 shingles per review. The recall figures are relative to true pairs *among candidates*. A brute-force all-pairs truth (≈ 7×10⁸ pairs) was not computed.

### M5e. Phase 2 exit criteria: result

Final run on 49,497 real HD2 reviews (2024-05-06 04:30 → 18:49 UTC, 91.9% positive):

| Criterion | Target | Measured | Status |
|---|---|---|---|
| Deterministic S1 (critical path) | — | **8.3 s** (heuristics 2.0 + MinHash 6.3) | ✅ |
| S1 warm (cached embeddings + kNN) | < 30 s | **≈ 8.5 s** (8.3 + 0.2) | ✅ |
| S1 cold | < 5 min | **8.3 s on the critical path**; embeddings 7.2–8.6 min (96–114 reviews/s) in the background, overlapped with S2 | ⚠️ Target missed as written; mitigated by design (see PLAN Phase 2) |
| Exact-copy recall (fixture) | 100% | 100% | ✅ |
| Near-copy recall (fixture) | ≥ 90% | 92% | ✅ |

Counts on this window: 115 with URL, 10 promo, 9,804 low-info, 11,191 exact-dup reviews, 12,659 near-dup reviews in 1,308 groups, **941 excludable**, 452 low playtime, 9,987 single-review accounts.

### M5f. Promo patterns on real reviews (precision check)

The first pattern set was hand-checked against every hit on real data:

| Corpus | Hits (v1) | Genuine advertising | False positives |
|---|---|---|---|
| Gollum (297) | 5 | 0 | 5: `stream_link`, reviewers linking their own YouTube review/gameplay video |
| HD2 (49,497) | 4 strong + self-promo | 0 | "free game" ×3 (F2P talk, "Sony finally giving us a free game"), "buy credits" ×1 (the game's premium currency) |

Changes: stream links and "check out my channel" became weak `SELF_PROMO_PATTERNS` (recorded in `promo_hits`, not counted as `has_promo`). `free_keys` no longer matches "free game(s)/skins", and `boosting` no longer matches "buy credits/coins". The real false-positive phrases are now regression tests.

After: `has_promo` = **0** on Gollum and **0** on HD2. Weak hits recorded: 5 and 9. **Precision on real data only.** Neither window appears to contain real advertising, so recall on real spam is unmeasured until the Phase 7 synthetic-attack injector. The "promo" counts in M5c and M5e predate this fix.

---

## M6. Accuracy-over-speed changes (owner direction, 2026-09-30)

### M6a. Embedding context length

Review lengths in MiniLM tokens (incl. special tokens):

| Corpus | Median | p90 | p99 | Truncated @128 | @256 | @512 |
|---|---|---|---|---|---|---|
| Gollum (297) | 67 | 283 | 1,634 | 30.6% | 11.8% | 4.7% |
| HD2 (49,497) | 18 | 99 | 407 | 7.0% | 2.4% | 0.6% |

Speed on 4,000 random HD2 reviews (two alternating runs each): @128 126–146 reviews/s, **@256 94–101 reviews/s** (about 30% slower; length-sorted batching limits the cost to long reviews). 128 → 256 changes exactly the truncated 7%: median cosine 1.0000, **min 0.604**, 7.0% below 0.99. → **Default is now 256**, MiniLM-L6's native training length. Beyond 256 the model is untrained, so longer reviews are still truncated (2.4% of HD2). Chunk-and-average is a candidate for Phase 4 if cluster quality shows it matters.

### M6b. LSH candidate bar and permutations (exact verification at J ≥ 0.7)

| Permutations | LSH bar (b, r) | Candidates | Time (cand + verify) | True pairs | Reviews grouped |
|---|---|---|---|---|---|
| 128 | 0.5 (25, 5) | 42,831 | 0.7 s | 2,623 | 1,763 |
| **128** | **0.4 (32, 4)** | 155,794 | 2.0 s | **2,630** | **1,763** |
| 128 | 0.3 (37, 3) | 830,363 | 7.0 s | 2,630 | 1,763 |
| 256 | 0.5 / 0.4 / 0.3 | 33K / 75K / 263K | 0.8 / 1.5 / 3.0 s | 2,629 / 2,630 / 2,630 | 1,762 / 1,763 / 1,763 |

Recall saturates at 0.4 with 128 permutations. **Default is now 0.4** (+7 pairs, about 1.3 s). 0.3 and 256 permutations find nothing more.

### M6c. Duplicates: DOWNWEIGHT and judge every review

Later copies default to **DOWNWEIGHT** and are **judged by System One** like every other review; the copy rule is a floor. Only byte-identical model inputs (same text *and* verdict) share one call. On the HD2 window, 49,497 reviews → 44,291 distinct inputs: **5,206 reused (10.5% fewer Jev calls)**, with no accuracy risk if Jev is deterministic for identical input (**verify in Phase 3**). Bootstrap resamples default 1,000 → 2,000.

---

## M7. Jev behaviour for the S2 client (2026-09-30)

### M7a. Determinism

`tools/jev_probe.py --n 30`: 60 real review states (30 HD2 + 30 Gollum), each sent twice, question set v1, pack=1. **Only 1/60 states returned identical answers**; max |Δ| over numeric fields 0.22. **Jev is not deterministic.** The docs don't mention determinism (docs.typesafe.ai/confidence.md). Cost $0.005.

### M7b. Token model for the pre-flight estimate (same 60 states)

Least squares: **input_tokens ≈ 893.1 + 0.2445 × len(state JSON)**. Residual SD 42.9 tokens, max |residual| 267. State length 96–3,078 chars; tokens 910–1,630; mean 984 per review. The intercept (~893) is the six v1 questions' own text, which dominates short reviews. Implemented in `app/systemone/preflight.py`.

### M7c. Test-retest noise and k-averaging

`tools/jev_noise.py --n 30 --repeats 6`: the same 60 states × 6 repeats = 360 calls, $0.015. A first run was **discarded**: its decision-stability numbers came from a biased sampler (the first 20 `itertools.permutations`). Its per-question numbers agreed with the valid run below.

| Question | Test-retest SD (mean over states) | Max SD |
|---|---|---|
| informativeness (0–3) | 0.020 (0.7% of range) | 0.080 |
| rating_support (0–3) | 0.020 (0.7%) | 0.094 |
| topic (choice) | same top choice in all 6 repeats for 100% of states | |
| spam_promo | 0.002 (0.2%) | 0.010 |
| templated | 0.010 (1.0%) | 0.029 |
| campaign_language | 0.004 (0.4%) | 0.027 |

Decision stability (policy v1 thresholds, 50 random disjoint pairs per state):

| Answers per review | Action differs between two independent estimates | |integrity Δ| mean / p95 |
|---|---|---|
| k = 1 | **2.6%** | 0.005 / 0.015 |
| k = 2 (mean) | **1.0%** | 0.003 / 0.011 |
| k = 3 (mean) | 1.4% | 0.003 / 0.008 |

Noise is small per answer. It matters only for reviews close to a threshold, and there it flips about 2.6% of decisions. k = 3 not beating k = 2 is within sampling noise at 60 states.

**Consequences:**
- **Reuse is now off by default** (`reuse_identical_inputs=false`). Sharing one draw across identical copies makes a borderline answer flip *all* copies together (e.g. 997 × "Just doing my part"). Independent calls split them in proportion to the probability. Cost: +10.5% calls on HD2 (M6c). **This corrects M6c**, which claimed reuse had "no accuracy risk"; that assumed determinism, which is false.
- **`samples_per_review` (k)** is available and defaults to 1. k = 2 halves decision flips for 2× cost. **Owner's call.**

---

## M8. Phase 3: dev set, packing, question set v2, first live run (2026-09-30)

### M8a. Dev set v1 (tuning only, never report metrics on it)

`tools/make_devset.py`, seed 2024: **200 reviews**. HD2 strata: short (≤ 3 tokens) 15, long (≥ 150) 15, links/promo 10, later copy 10, pre-bomb (Apr 1–May 2) 35, bomb (May 3–6 12:00) 45, counter-wave (May 6 12:00–10) 35, later (May 11+) 15. Gollum control: 20. 67% positive. The manifest (review ids + stratum) is in `data/devsets/dev_v1.json`, gitignored. **Phase 7 must exclude these ids from every metric set.**

### M8b. Packing on 200 real reviews (v1), agreement with pack=1

| Comparison | Decision agreement | Spearman informativeness / rating_support | Spearman spam / templated / campaign | Tokens |
|---|---|---|---|---|
| pack=1 vs pack=1 (**noise floor**) | 0.965 | 0.998 / 0.998 | 0.975 / 0.998 / 0.991 | 203,629 (identical both runs) |
| pack=5 | 0.875 | 0.965 / 0.942 | 0.822 / 0.922 / 0.922 | 168,589 (−17%) |
| pack=10 | 0.830 | 0.913 / 0.873 | 0.745 / 0.847 / 0.870 | 163,309 (−20%) |

**Packing rejected**: far below the ≥ 0.98 bar on every question, and it saves only 17–20% of tokens (question text is copied per item). This supersedes the 5-review M4b estimate of −41%. Cost of M8b: $0.031.

### M8c. v1 answers reviewed, and question set v2

42 dev reviews read against their v1 answers. This is **Claude's own judgement, not human labels**; Phase 7's 2-rater labels are the real test. Problems found:
1. `templated` tracked shortness: "good game" 0.88, "Pretty basic" 0.72; hd2_short stratum mean 0.68. **108/200 reviews carried both LOW_INFO and TEMPLATED** (double penalty).
2. `informativeness` asked for information "about the game", so specific platform-policy complaints scored lower, double-counting `topic`.
3. FLAG = 10/200 (5%), all from confidence < 0.5 on score questions. Left unchanged for now (FLAG counts as KEEP in the rating); revisit with Phase 7 labels.

v2 (`app/systemone/questions_v2.py`): specificity-based `informativeness` with `{what, examples}` levels; `templated` = copied/reusable text, with short own-words opinions explicitly excluded; `rating_support` notes that mixed reviews can support a verdict. Other questions unchanged.

| | v1 | v2 |
|---|---|---|
| Self-agreement (decisions, two runs) | 0.965 | **0.985** |
| Reviews with both LOW_INFO + TEMPLATED | 108 | **38** |
| Actions KEEP / DOWNWEIGHT / FLAG | 118 / 72 / 10 | 121 / 70 / 9 |
| Tokens per review (same 200 states) | 1,018 | 1,264 (+24%) |

Targeted checks (v1 → v2): short own-words opinions, `templated` "good game" 0.88→0.03, "Pretty basic" 0.72→0.04, "10/10 made me fall in love…" 0.40→0.16. Copypasta/slogans stay high: Cyberpunk quote 0.87→0.93, "FOR DEMOCRACY" 0.85→0.84, "MAJOR ORDER COMPLETE…" 0.76→0.70. Specific PSN complaints, `informativeness`: 2.52→2.85, 2.35→2.96, 2.87→3.00, 2.07→2.04 (unchanged). No-content texts stay ~0. One regression: ":fire:" DOWNWEIGHT→FLAG. **v2 is the default.** 1 of ≤ 3 tuning iterations used. Cost of v2 runs: $0.021.

### M8d. Pre-flight on the real headline datasets (`ds_a29ec91842df` 50K, `ds_9ce1a2947cbe` 5K; day-stratified from the full 366,270-review HD2 pull)

| Dataset | v1 k=1 | **v2 k=1 (default)** | v2 k=2 |
|---|---|---|---|
| 50K | $2.03, 20.8 min | **$2.55, 20.8 min** | $5.09, 41.7 min (needs confirm at the $4 limit) |
| 5K | $0.20, 2.1 min | $0.25, 2.1 min | $0.51, 4.2 min |

### M8e. First live Jev run through the full pipeline (HD2 5K live subset, v2, k=1, concurrency 32)

- **Pre-flight accuracy:** estimated $0.2545 / 6,060,568 tokens; **actual $0.2543 / 6,055,191 tokens (−0.1%)**.
- Jev: **4,999/4,999 HTTP 200, 0 retries, 0 throttling**. Model `jev-1.13.0`.
- Result: KEEP 3,076 · DOWNWEIGHT 1,623 · FLAG 300 · EXCLUDE 0. **Raw 76.4% → adjusted 73.2% positive (95% CI 71.8–74.5%)**, n_eff 4,113. Steam label "Mostly Positive" both. There is no burst/cluster logic yet (Phase 4). The drop comes from the positive counter-wave slogans being downweighted, while specific negative PSN complaints stay KEEP.
- **Throughput 18.3 reviews/s** (S2 267 s), against 64/s in the M4c benchmark. Requests per minute went 1,438 → 711 → 642 → 53 → 1,145 → 972. The trough coincides with MiniLM loading in the S1 background thread while the Laya dev-set benchmark saturated the CPU. Since Jev never throttled, the bottleneck is **client-side CPU contention** (the asyncio loop starved by torch + laya-serve), not the API. S1 embeddings took 350 s for 5K (normally about 50 s), for the same reason. To be re-measured with the CPU otherwise idle.

### M8f. Throughput re-tests (CPU otherwise idle, laya-serve stopped)

| Run (HD2 5K, v2, k=1, concurrency 32) | S2 time | Reviews/s | Retries | Latency p50 / p95 | Embeddings | Adjusted (95% CI) |
|---|---|---|---|---|---|---|
| #1 during the Laya benchmark, cold embeddings (M8e) | 267 s | 18.3 | 0 | — | 350 s | 73.2% (71.8–74.5) |
| #2 idle CPU, **warm** embedding cache | 124.7 s | **40.1** | 0 | 327 / 407 ms | 0.04 s | 73.2% (71.8–74.5) |
| #3 idle CPU, **cold** embeddings overlapped with S2 | 124.5 s | **40.1** | 0 | 334 / 435 ms | 67 s (background) | 73.2% (71.7–74.5) |

- **The S1/S2 overlap does not slow S2.** Runs #2 and #3 are both pinned at the client's 40 req/s limiter, Jev's documented limit, which we deliberately don't exceed although M4c showed 64/s. Run #1's slowdown came from laya-serve *plus* the embeddings saturating the laptop CPU together. Don't run Laya benchmarks during live Jev runs.
- **Test-retest of the aggregate is stable:** three runs gave identical 73.2% adjusted and CIs within 0.001, even though individual actions moved slightly (FLAG 300 / 308, from Jev noise, M7).
- **Projected 50K: 20.8 min, $2.55 (v2, k=1).** Phase 3 exit criterion (≤ 45 min) met.

### M8g. Laya zero-shot on the dev set (v1 questions, laptop CPU)

200 reviews in about 43 min (0.05–0.1 reviews/s, slowed while sharing the CPU), $0. Agreement with Jev v1 on the same states. This is **not accuracy**; no human labels yet.

| Question | Laya vs Jev |
|---|---|
| informativeness | Spearman 0.589 |
| rating_support | 0.481 |
| topic | 38.5% same choice |
| spam_promo / templated / campaign_language | 0.456 / 0.164 / 0.553 |
| decisions | 9.5% same action |

**Laya FLAGs 191/200:** its confidences are low across the board, consistent with the checkpoint's calibration warning (PLAN C11). Jev's confidence-based FLAG rule can't be applied to Laya as-is. The Phase 7 benchmark row needs either Laya-specific confidence handling or FLAG disabled for it.

**Phase 3 Jev spend:** probes $0.020 (M7) + dev-set runs $0.052 (M8b/c) + three 5K live runs $0.763 = **≈ $0.84**.
