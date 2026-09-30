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
