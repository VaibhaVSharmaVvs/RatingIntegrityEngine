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
