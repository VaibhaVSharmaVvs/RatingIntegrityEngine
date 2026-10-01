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

---

## M9. Phase 4: corpus analysis (2026-09-30)

### M9a. Most Helldivers 2 bomb reviews were edited afterwards

Full HD2 pull (366,270 English reviews, Apr–Jun 2024). "Edited" = `timestamp_updated − timestamp_created > 1 h`.

| Day (created) | Reviews | Edited share | Positive, unedited | Positive, edited |
|---|---|---|---|---|
| 2024-04-10 (baseline) | 1,800 | 29% | 95.5% | 74.3% |
| 2024-05-02 | 968 | 33% | 93.2% | 73.7% |
| **2024-05-03** | 36,031 | **78.8%** | **16.1%** | 75.4% |
| **2024-05-04** | 62,032 | **77.3%** | **13.8%** | 81.9% |
| **2024-05-05** | 76,705 | **76.2%** | **9.5%** | 86.1% |
| 2024-05-06 (reversal) | 78,136 | 23.4% | 91.4% | 78.1% |
| 2024-05-07 | 22,317 | 10.9% | 97.5% | 65.5% |

Bomb-day edits (134,815 reviews): edit lag median **3 days** (p25 2, p75 53). Most flipped to positive right after Sony's 6 May reversal. **Steam's current `voted_up` shows the bomb largely reversed:** bomb days now read 63–68% positive overall.

Consequences: (1) the pipeline analyses reviews **as they stand today** (current text and current verdict, consistent with each other), and the methodology card must say so (PLAN C13); (2) burst detection works on volume (3 May ≈ 40× the median day); (3) edit status is a useful inspector/timeline signal, but not an integrity penalty (editing a review is legitimate).

Cities: Skylines II for comparison: launch day 2023-10-24 had 3,551 English reviews at 48% positive, 25 Oct 3,963 at 62%, then decaying (median day 103). That is an organic launch burst.

### M9b. Burst detection on real corpora (`BurstConfig` defaults: 7-day trailing baseline excluding flagged hours, robust z ≥ 6, ≥ 5/h, ≥ 30 reviews)

| Corpus | Bursts | Main windows | Change points (daily % positive) | Time |
|---|---|---|---|---|
| HD2 full (366,270) | 8 | **negative 2024-05-03 05h → 05-08 03h** (119 h, 69,399 reviews, peak 1,483/h, z = 332, baseline 6/h); positive 05-03 07h → 05-09 05h (214,123); plus small blips (Apr 29, May 8–10) | 2024-05-01, 2024-05-26 | 0.9 s |
| HD2 50K sample | 3 | negative 05-03 05h → 05-07 04h (9,400); positive 05-03 07h → 05-09 05h (29,180) | 2024-04-26 | 0.9 s |
| HD2 5K sample | 2 | negative 05-03 08h → 05-06 07h (927); positive 05-03 12h → 05-08 05h (2,793) | none | 0.8 s |
| CS2 full (20,818) | 2 | positive **2023-11-21 18h → 11-23 03h** (686), which coincides with the Steam Autumn Sale start. The **launch spike (Oct 24) is not a burst**: it starts the series, so there is no baseline | none | 0.6 s |
| Gollum (297) | 0 | | none | 0.5 s |

**Phase 4 exit criterion "burst detection places a window in early May 2024": ✅** at every sample size.

### M9c. Suspicion factor bias found and fixed (HD2 5K, same Jev answers via the cached backend)

| Version | Top clusters | Suspicious (> 0.5) | Penalised | Actions changed | CS2 penalised |
|---|---|---|---|---|---|
| v0: corpus lift | 3-review duplicates, "33% within 15 min" | 42 | 577 | 97 | 6 |
| v1: anchor review excluded + min size 10 to penalise | "2 of 46 within 15 min (vs 0.0%)" still scored 0.99 | 34 | 502 | 90 | 0 |
| **v2: permutation null** (random same-size corpus subsets, 24 draws) + new accounts at half weight | coordinated counter-wave slogans: "Just doing my part", "MAJOR ORDER COMPLETE", "Democracy prevails", "managed democracy" | 32 | **264** | **14** | **0** |

Root cause: a cluster is a subset of the corpus, and the window starts at a member. Against the corpus-wide rate, any coincidence at a 15-minute scale looked like a 100x lift. The null model asks the right question: more concentrated than a random set of the same size?

**Borderline to watch:** a "great community" cluster (31 reviews, likely genuine praise) sits at suspicion 0.50, exactly at the penalty threshold (> 0.5 required). Phase 7 should check threshold robustness.

HD2's two bursts score 0.18–0.23: their wording is diverse (0% within cosine 0.8 of the centroid) and new accounts are no higher than the corpus. **By design, a diverse mass protest by real owners is not "coordinated"**. Its memes, slogans and copies are handled per review and by the slogan clusters.

### M9d. Phase 4 results and sensitivity (all from the same Jev answers, $0 via `backend: "cached"`)

| Run | KEEP / DOWN / FLAG / EXCL | Raw → adjusted (95% CI) |
|---|---|---|
| **HD2 5K, full S0–S4 (Jev v2)** | 2,987 / 1,707 / 301 / 4 | **76.4% → 72.9% (71.5–74.2)** |
| HD2 5K, cluster rules off | 2,997 / 1,701 / 301 / 0 | 76.4% → 72.9% (71.5–74.3) |
| HD2 5K, platform policy *not* off-topic | 2,987 / 1,707 / 301 / 4 | 72.9% (30 vs 32 suspicious clusters) |
| HD2 5K, grey-zone FLAG 0.1 (now the default) | 2,965 / 1,697 / **333** / 4 | 72.9% (+32 FLAGs, +0.6%) |
| HD2 5K, in-burst copies → FLAG | 2,987 / 1,707 / 305 / 0 | 72.9% |
| **CS2 5K control (organic backlash)** | 4,595 / 289 / 116 / 0 | 59.6% → 58.8% (57.5–60.3); **0 reviews penalised by clusters** ✅ |
| **Gollum control (known-bad)** | 259 / 32 / 6 / 0 | 35.7% → 34.4% (29.1–40.1); **not inflated** ✅ |
| HD2 50K, heuristic backend | 38,617 / 11,058 / 66 / 265 | 77.2% → 75.4% (75.0–75.8); 1,152 clusters, 267 suspicious, 5,836 penalised (no off-topic factor without System One) |

**The honest takeaway:** on HD2 the cluster stage changes the aggregate by < 0.1 pp. The coordinated slogans are already downweighted per review (low informativeness). Clusters add *explanation* here; their rating impact has to be shown on coordinated campaigns that look informative (Phase 7 synthetic attacks). Platform-policy-as-off-topic makes no difference on this data. The grey-zone FLAG was first disabled on an unmeasured worry ("thousands of FLAGs"); measured at +0.6%, it is now enabled as the spec intended.

Jev spend for Phase 4: HD2 5K $0.252 + CS2 5K $0.264 + Gollum $0.016 = **$0.53**. Every sensitivity run was $0 (cached).

### M9e. Scale

- UMAP (cosine, 10-D, seeded) + HDBSCAN on 50,006 × 384: **3.3 min cold** (UMAP 154 s + HDBSCAN 45 s), **54 s with UMAP cached**. 481 clusters, 56% of reviews clustered, identical clusters on rerun. **Exit criterion (< 10 min) ✅**
- Full 50K run (heuristic backend, warm caches): **48 s end to end**. S1 8.4 s, S3 38 s (HDBSCAN 20.5 s, top phrases 3.2 s, bursts 0.4 s).
- Embedding the 50K cold took 780 s, contended with test runs (cf. M5: 433–518 s idle).

## M10. Phase 5: live analysis screen (2026-10-01)

Chrome 154, dev laptop (12 logical cores), DPR 1.25, grid canvas 1412 × 568 device px. Dev overlay `?fps=1` records every rAF interval and the grid's paint + composite time per frame (`window.__rieFrames`). Single sessions; CPU timings vary about ±35% on this laptop, so treat them as ranges.

| Replay | Frames | Frame interval p50 / p95 | Frames > 20 ms | Grid paint p50 / p95 / max |
|---|---|---|---|---|
| HD2 50K heuristic (`run_323564cc8232`), 1×, per-cell RGB blend | 990 | 16.7 / 17.0 ms | 6 (screenshots taken mid-run) | 4.5 / 11.0 / 11.0 ms (12 paint frames) |
| **same, fade lookup table** | 418 | **16.7 / 16.9 ms (59.9 fps)** | 1 (33 ms) | **1.3 / 6.0 / 6.1 ms** (38 paint frames) |
| HD2 5K Jev (`run_f5c957411488`), 16×, fade lookup table | — | 60 fps overlay, p95 16.9 ms | — | max ≤ 1.7 ms |
| Mock run, live SSE (5K load test), fade lookup table | — | 60 fps overlay, p95 16.8 ms | — | max ≤ 1.0 ms |

- **Exit criterion (≥ 50 fps on a 50K replay) ✅** at ~60 fps.
- **Spec target "redraw < 5 ms at 50K": met at p50, missed at the worst frame (6.1 ms).** The worst case is every one of the 50K cells fading in the same frame. That happens because the heuristic run emits all 50K decisions at once. Jev-paced runs paint ≤ 1.7 ms. The fade lookup table (25 action pairs × 16 steps) halved the worst frame from 11 ms. Node microbench (Vitest): a whole-grid 50K fade paints in < 5 ms median.
- **Reveal pacing (owner feedback 2026-10-01: "the cell filling is too fast").** Finished runs now auto-play with the grid filling in 30 s. Each batch drips in cell by cell. Counters and rating are released only once their batch is on screen. Cells flash and settle over 320 ms.

| Replay (default 30 s fill, flash fade) | Fill time | Frame interval p95 | Frames > 20 ms | Grid paint p50 / p95 / max |
|---|---|---|---|---|
| HD2 5K Jev (`run_f5c957411488`) | ~30 s (pending 4,999 → 0 at ~170/s); corpus stage 87 s → ~2 s | 16.9 ms (60.0 fps) | — | — / 0.5 / 1.6 ms |
| HD2 50K heuristic (`run_323564cc8232`) | ~31 s (~1,680/s) | 16.9 ms (60.0 fps, 2,218 frames) | 0 | 0.2 / 0.4 / **2.4 ms** (spec < 5 ms ✅) |

Dripping removed the whole-grid fade frames, so the worst paint went from 6.1 to 2.4 ms. **Heuristic recordings show a flat live rating** (75.4% from the first event). `_decide_heuristic` filled the whole grid before emitting, so every live rating already covered all 50K decisions. Fixed in `pipeline.py` (grid filled per emitted chunk; test `test_heuristic_live_rating_covers_only_reviews_decided_so_far`). Runs recorded before the fix keep the flat rating, so re-run to get a moving one ($0, ~1 min).
- Rendering design: one pixel per review in an offscreen `ImageData`, scaled up crisp (`imageSmoothingEnabled = false`) with a pre-drawn gap overlay. Only changed and still-fading cells are repainted. SSE events are batched into one store update per animation frame.

---

## M10. Methodology v3: the length bias, and what can justifiably move a rating (2026-10-01)

### M10a. The spec's weights penalised brevity, and brevity tracks positive verdicts

Phase 4 runs, question set v2, spec weights (informativeness 0.30, rating support 0.25):

| Corpus | Negatives downweighted | Positives downweighted | Median length neg / pos |
|---|---|---|---|
| HD2 5K | 19.5% | **38.7%** | 105 / 53 chars |
| CS2 5K | 3.5% | **7.4%** | 257 / 152 chars |
| Gollum | 8.4% | **15.1%** | 259 / 277 chars |

Same Jev answers (cached backend, $0), with informativeness and rating-support weights set to 0:

| Corpus | Raw | Adjusted, spec weights | Adjusted, those two weights off |
|---|---|---|---|
| HD2 5K | 76.4% | 72.9% | **76.4%** |
| CS2 5K | 59.6% | 58.8% | **59.5%** |
| Gollum | 35.7% | 34.4% | **35.7%** |

**Nearly all the downward movement reported in M8/M9 was a verbosity adjustment, not integrity.** The owner chose option B: evidence quality is shown, not weighted.

### M10b. Alternatives the owner proposed, measured before deciding (v2 answers, $0)

| Idea | HD2 | CS2 | Gollum | Verdict |
|---|---|---|---|---|
| Upweight informative reviews (weight 1 + informativeness, 1x–2x) | −2.5 pp | −1.6 pp | −0.3 pp | Same bias from the other side: a weighted mean only sees *relative* weights. Negatives are more informative (HD2 mean 0.52 vs 0.32) |
| Playtime buckets (<2 h ×0.5, <10 h ×0.75, <50 h ×1, 50 h+ ×1.25) | +0.7 pp | +1.8 pp | **+2.4 pp** | Survivorship bias: inflates the known-bad control. 49% of Gollum's negatives (34% of CS2's) were written under 2 h |

Both rejected as weights. Effort is shown as an evidence badge; playtime is used only as an experience floor combined with an off-game verdict.

HD2 bomb reviewers were real players (full pull): median playtime at review for negatives was 76 h before the bomb, **56 h during** (May 3–5) and 61 h after. Free copies 1.5–2.0% throughout, and first reviews 7–15%. **No playtime- or incentive-based rule should move HD2.**

### M10c. Question set v3 (`about_game`) on the dev set

Two runs, $0.023, 1,395 tokens per review (+131 over v2). `about_game` mean 0.77; 16.5% of dev reviews < 0.5; test-retest mean |Δ| 0.010 (max 0.08). Share "not about the game": HD2 bomb 27%, counter-wave 20%, short 27%, **Gollum 0%**. Lowest scores: "F*CK SONY" 0.06, "♥♥♥♥ sony" 0.08, "Arrowhead" 0.08, political asides 0.06, developer-doxxing complaints 0.09–0.15, "Freedom, Good. Sony, Bad." 0.23. Symmetric: positive company-aimed reviews too ("Sony actually pulled back, WE DID IT" 0.21). Game-lore memes ("FOR DEMOCRACY!!!") 0.62–0.69 count as about the game. One iteration was enough.

### M10d. Policy v3 (option B + off-game 0.6 + contradiction 0.5 + experience floor 0.2), live Jev runs

| Run | KEEP / DOWN / FLAG / EXCL | Raw → adjusted (95% CI) | Downweighted neg / pos | Cost |
|---|---|---|---|---|
| **HD2 5K** | 4,041 / 789 / 165 / 4 | 76.4% → **77.7% (76.5–78.9)** | 22.5% / 13.8% | $0.280 |
| CS2 5K control | 4,873 / 127 / 0 / 0 | 59.6% → 59.2% (57.8–60.6); raw inside CI ✅ | 1.3% / 3.4% | $0.292 |
| Gollum control | 281 / 16 / 0 / 0 | 35.7% → 34.3% (29.0–39.9); raw inside CI ✅ | 2.6% / 10.4% | $0.018 |

Top reasons: HD2 OFF_TOPIC (402 positives such as "democracy", 215 negatives such as "Review redacted for potential treason"), COORDINATED_CLUSTER 58, CONTRADICTS_VERDICT 63. Gollum's dip comes from ironic "Recommended" reviews of a bad game ("And we wept, Precious…"), which is justified. **Known false positives for the contradiction rule:** mixed reviews ("cool game, but connecting to friends' squads is virtually impossible", Recommended). Measure its precision with the Phase 7 hand labels. FLAG fell from 301 to 165 on HD2 because low confidence now only counts on questions that carry weight.

**Live ticker:** raw and adjusted are now computed over the reviews decided so far (chronological batches), so both trace the rating through time (`test_live_rating_moves_through_time`).

---

## M11. Three ratings: raw, integrity-adjusted, platform policy (2026-10-01)

**Owner decision:** report three ratings side by side.
- **Raw**: every review as Steam reports it today.
- **Integrity-adjusted (engine)**: per-review judgment. Option B, `about_game` (terms and requirements that change the product count as about the game), contradiction, coordination, copies.
- **Platform policy (Steam's rules emulated)**: (1) key activations don't count (Valve, Sept 2016); (2) a negative spike whose negatives are mostly off-topic is removed **as a whole window**, positives included (Valve, Mar 2019, which explicitly lists DRM and EULA changes as off-topic). Our burst detector stands in for Steam's spike detection. Valve's manual review is replaced by `verdict_basis` (question set v4): the window is removed when > 50% of its judged negatives have a verdict not based on playing.

Sources: Valve's 2016 key-activation change (TechRaptor, store.steampowered.com/oldnews/24155) and the 2019 off-topic review-bomb policy (TechRaptor, The Next Web, Gamereactor).

### M11a. `verdict_basis` on the dev set (question set v4)

Two runs, $0.026, **1,528 tokens per review** (+133 over v3). Share "verdict not based on playing": HD2 bomb 71%, counter-wave 37%, pre-bomb 23%, **Gollum 5%**. Test-retest mean |Δ| 0.010. It adds what `about_game` let through: "Trying to force their playerbase to make a PlayStation Network account…" (verdict_basis 0.05, about_game 0.95), "not reinstalling until the Region restriction is lifted" (0.06), "horrible patches and now PSN linking" (0.23). Positive memes also score low; that is harmless here, because only negatives inside negative spikes are used.

### M11b. Results (Jev v4, one call per review)

| Game (window) | Raw | Integrity-adjusted (95% CI) | **Platform policy** (95% CI) | Windows removed by the emulation | Key activations removed | Cost |
|---|---|---|---|---|---|---|
| **Helldivers 2** (5K, Apr–Jun 2024) | 76.4% | 77.6% (76.4–78.8) | **89.0% (87.4–90.5)** | 2024-05-03 08h → 05-06 07h: 2,117 reviews, 78% of judged negatives off-topic | 1,175 | $0.307 |
| **Borderlands 2** (12,981, Apr–Aug 2025) | 33.8% | 37.4% (36.6–38.3) | **50.7% (49.1–52.3)** | 2025-04-25 (40); **05-19 → 05-22** (250 + 328, 90%); **06-05 → 06-11** EULA (3,834 at 84%, + 30) | 4,935 | $0.801 |
| Cities: Skylines II control (5K, Oct–Dec 2023) | 59.6% | 59.2% (57.8–60.6) | 59.9% (58.4–61.4) | **none** ✅ | 1,126 | $0.319 |
| Gollum control (297) | 35.7% | 34.3% (29.1–39.9) | 34.4% (27.9–41.4) | none ✅ | 111 | $0.019 |
| **Football Manager 26** (15,348, launch → now) | 38.0% | 37.2% (36.4–38.0) | 38.4% (37.4–39.3) | **none**: the launch backlash is genuine | 6,058 | $0.967 |
| Metro 2033 Redux (2,444, Dec 2018–Mar 2019) | — | — | — | **not run: TypeSafe returned HTTP 402 "no available API credits"** | | |

Reference levels (English, from our pulls): HD2 pre-bomb April 2024 88–91%, so **the Steam-policy rating lands on it**. BL2 and Metro English baselines are being pulled (Jan–Mar 2025; Sep–Nov 2018). **Correction:** the earlier "92–95%" (BL2) and "~90%" (Metro) came from Steam's review histogram, which counts **all languages**: its `l=english` parameter is the UI language, not a filter. Metro: 36,820 English reviews vs 103,493 in the histogram.

### M11c. What Valve actually did (all languages, `filter_offtopic_activity` 0 vs 1 totals)

| Game | Reviews / positive, including off-topic | Steam score view (off-topic removed) | Valve flagged an off-topic window? |
|---|---|---|---|
| Helldivers 2 | 1,164,767 / 880,895 | identical | **No.** The 2024 PSN bomb counts fully in Steam's score |
| Borderlands 2 | 320,304 / 283,697 | 312,660 / 279,932 | **Yes**: 7,644 reviews excluded, 49% positive. Positive share suggests the 2019 Epic window rather than the 2025 EULA bomb [unverified: windows aren't exposed] |
| Metro 2033 Redux | 142,391 / 131,422 | identical | No (its bomb predates the March 2019 policy) |
| Cities: Skylines II | 94,290 / 52,049 | 92,411 / 51,723 | Yes: 1,879 excluded (outside our Oct–Dec 2023 window or not; unknown) |
| FM26, Gollum | | identical | No |

**Steam's written rules and Valve's decisions differ.** By the policy's own wording (account requirements are DRM-like, EULA changes are named), HD2 May 2024 and BL2 June 2025 qualify, but HD2 was never flagged. The demo can say exactly that.

Spend this round (v3 + v4): HD2/CS2/Gollum v3 $0.59, BL2 v3 $0.73, dev-set v3/v4 $0.05, v4 five games $2.41 → **≈ $3.78**. Credits then ran out.
