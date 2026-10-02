# Results (Phase 7 evaluation)

Every number below was measured. Method notes, corrections and run ids are in `docs/MEASUREMENTS.md` M11–M12. Each benchmark is also recorded in the `benchmarks` table and shown on the app's `/benchmarks` page.
- **Settings:** question set v4, policy v3 defaults, one Jev call per review, unless a row says otherwise.
- **Reproduce:** run the `tools/bench_*.py` scripts. Policy experiments reuse a run's answers at $0 (`tools/sweep_cached.py`).

Status: **complete except** human agreement (two raters still need to label `/label`, set `hd2-300`). Owner decisions taken on 2026-10-02 are applied as defaults (§8, MEASUREMENTS M13).

## 1. Synthetic attacks (MVP_SPEC §10, row 1)

**Data:**
- 4,999 real Helldivers 2 reviews from April 2024 (the month before the bomb), plus 690 injected attack reviews with exact ground truth.
- The attack pulls the raw rating from 87.8% to 80.2% (−7.66 pp).

**Measures:**
- **Discounted:** the share of an attack's reviews that lost weight (downweighted or excluded).
- **Pull removed:** 1 − (adjusted shift / raw shift), each measured against the clean run on the same reviews.
- **Collateral:** organic reviews pulled into a penalised cluster only when the attack is present.

| Method | Template flood | Paraphrase flood | Coordinated burst | Astroturf flood | Spam | **Pull removed** | Collateral | Jev cost |
|---|---|---|---|---|---|---|---|---|
| (a) Heuristics only | 99% | 26% | 17% | 77% | 8% | 22% | 153 | $0 |
| (b) Jev v4 (current defaults) | 99% (all downweight, weight 0.25) | 100% | 17% | 77% | 90% | **45%** | 127 | $0.655 |
| Jev v4, off-topic factor ½ | 99% (excluded) | 100% | 17% | 77% | 90% | 54% | 132 | (reused) |
| Jev v4, off-topic ½ + similarity ½ | 99% (excluded) | 100% | 17% | 77% | 90% | **55%** | **74** | (reused) |
| **Jev v4, new defaults** (weights ½, semantic penalty inside bursts only) | 99% (excluded) | 100% (downweighted) | 17% | 77% | 90% | **51%** | 74 | (reused) |

**Cluster ARI among injected reviews** (Jev v4): duplicate 0.30, semantic 0.23, burst 0.68.

**What it shows:**
- **System One doubles what heuristics catch** (22% → 45% of the pull removed), mostly through the off-topic judgment: the paraphrase flood goes from 26% discounted to 100%.
- **Two suspicion factors act as vetoes.** Suspicion is a geometric mean, so one factor near zero sinks it.
  - On-topic copy-paste campaigns score `offtopic_mean` ≈ 0 and escape the "copy inside a suspicious burst → exclude" rule.
  - Varied bursts score `similarity` ≈ 0 and escape the cluster penalty.
  - Halving both factors' weights fixes the first. It removes 55% of the attack's pull and nearly halves collateral, with every control and real game within 0.1 pp (MEASUREMENTS M12a).
- **The coordinated burst of varied, on-topic complaints is not discounted.** It is detected exactly (200 reviews in 3 h, z = 52, 78% new accounts). But the engine, by design, does not downweight genuine-sounding complaints on timing alone. That design is what protects real launch backlashes (§3). Publishing this limit is the honest outcome: a determined attacker who writes varied, on-topic complaints from new accounts moves the adjusted rating as much as the raw one.

## 2. Ablations (§10)

On the attack benchmark, with 45% of the pull removed as the reference:

| Ablation | Result |
|---|---|
| (a) heuristics only | 22% of the pull removed (§1) |
| (b) + System One (Jev) | 45% |
| (c) + System One (Laya zero-shot) | On the 300-review label set (the full benchmark would take ~20 h on CPU): Laya downweights 96% and calls 97% "not about the game". Cohen's κ against Jev ≈ 0 on every question (about_game −0.01, overall 0.00): chance level |
| (d) + Laya fine-tuned on Jev labels | not run: out of the MVP (Phase 8, owner decision) |
| (e) leave one signal out | off-game 30% · contradiction 46% · spam weight 46% (spam still 90% excluded by the deterministic rule) · copied text 46% · low experience 45% · cluster penalty 44% (and **collateral 127 → 0**) · in-burst copy escalation 46% (astroturf excluded 77% → 66%) |
| (f) Jev pack 1 / 5 / 10 | 45% / 42% / 43%. Decision agreement with pack 1: 98.8% (repeat noise) / 91.2% / 90.8%. Tokens ×1 / 0.888 / 0.87. **Packing stays rejected:** about 7× the noise in changed decisions, to save 11–13% |

**Repeat noise:** two identical runs agree on 98.8% of decisions (62 of 4,999), and the adjusted rating moves 0.05 pp. This replaces the 2.6% from M7c, which was policy v1 on 60 states.

## 3. Control games (§10)

On-topic negatives = negative reviews System One judges to be about the game. A false positive = such a review was downweighted or excluded.

| Game | Raw | Adjusted | Move | Raw inside 95% CI | On-topic negatives discounted |
|---|---|---|---|---|---|
| Cities: Skylines II (5K, Oct–Dec 2023) | 59.6% | 59.2% | −0.4 pp | yes | **0.3%** (6 of 1,994) |
| The Lord of the Rings: Gollum | 35.7% | 34.3% | **−1.4 pp** (target < 5 pp ✅) | yes | 0.5% (1 of 187) |
| Football Manager 26 (launch → now) | 38.0% | 37.2% | −0.7 pp | yes | 0.6% (60 of 9,389) |

**Caveat:** no burst was detected in any control. These are launch windows, and the burst detector needs 3 days of history for its baseline. Organic bursts are therefore protected by the per-review judgments here, not tested against the cluster rules.

## 4. Known incidents (§10)

Three ratings, from M11:

| Game | Raw | Adjusted | Steam policy | Reference (English, earlier window) |
|---|---|---|---|---|
| Helldivers 2 (5K, bomb 2024-05-03 → 05-06) | 76.4% | 77.6% | 89.0% | 88.0% |
| Borderlands 2 (EULA, 2025) | 33.8% | 37.4% | 50.7% | 91.1% |
| Metro 2033 Redux (Exodus exclusivity) | 48.8% | 62.9% | 61.5% | 93.8% |

- **Burst location:** the burst detector locates the HD2 bomb window, and the Steam-policy emulation removes 2024-05-03 08h → 05-06 07h (2,117 reviews, 78% of negatives off-topic). The emulated Steam policy recovers the pre-bomb level.
- **Why the engine moves HD2 little:** most HD2 bomb reviews still talk about the game.

## 5. Reviews that argue for their own legitimacy (§10)

**Data:** 150 real reviews, each judged as written and with one added sentence.
- **Set v1:** common wordings.
- **Set v2:** wordings no detection pattern lists.

**Laundered:** share of the 100 off-topic ones that crossed above the downweight line.

| Configuration | v1: claim before / after / note to the AI | v2: paraphrased experience claim / note to "the system" / "verified veteran" |
|---|---|---|
| v4, before (no defence) | 39% / 30% / 35% | 53% / 48% / 11% |
| v4 + stripping of matched text | 2% / 2% / 0% (note excluded) | not reached by the patterns |
| **v5 + stripping (new default)** | **5% / 7% / 0%** | **40% / 0% / 0%** |
| identical repeat (noise) | 2–5% | 1–2% |

**What does the work:**
- Deterministic patterns strip common claims and notes before System One sees the text. A note addressed to the model is excluded: it appeared in 1 of 420,582 genuine reviews.
- The v5 question `influence_attempt` catches wordings the patterns miss, counted only above 0.5. On 4,999 genuine reviews it changes decisions at the noise level and downweights 8 (0.16%), all in-game jokes vouching for the review.

**Remaining limit:** a paraphrased claim of experience ("hundreds of hours in it, my own time in the trenches") reads like a genuine reviewer's. Catching it would downweight about 1.6% of genuine reviews, so it is left as a stated limit.

## 6. Human agreement (§10)

- **Set:** 300 HD2 reviews (200 uniform + 100 from the bomb window), labelled blind at `/label`.
- **Questions:** six, mirroring System One's: about the game, verdict from playing, contradicts, spam, copied, overall weight.
- **Scoring:** `tools/bench_agreement.py` gives Cohen's κ per question for human–human, human–Jev and human–Laya, overall and per stratum.

*Pending: needs two raters.*

## 7. Not run

- **YelpZip:** no access was granted.
- **Optional LLM-every-review baseline:** not part of the product; skipped.

## 8. Owner decisions (2026-10-02), now defaults

1. **Suspicion weights halved** (off-topic ½, similarity ½).
   - Genuine reviews keep their weight: with account data a genuine on-topic wave stays below the penalty, and without it genuine reviews stay KEEP. Both are tested.
2. **Text written to sway the judge** (§5).
   - It is stripped before judging; a note to the model is excluded deterministically.
   - Question set v5 adds `influence_attempt` with a heavy weight (0.6, above 0.5). v5 costs about 10% more tokens.
3. **Semantic clusters penalise only inside bursts.**
   - In normal periods their "suspicious" clusters were organic fan memes (312 of 4,999 genuine April reviews flagged or downweighted).
   - Attack removal 55% → 51%; real games within 0.1 pp.
4. **Varied, on-topic coordinated campaigns are not discounted** (§1). The help page states this, the legitimacy limit and the paraphrased-experience limit.

The six showcase runs and their replays still use the settings they were recorded with. Re-recording them on v5 needs about $2.9 of Jev. With v4 answers reused, the new policy moves each showcase rating by at most 0.13 pp.

## Phase 7 spend

Jev **$2.16** (Phase 7) + **$0.69** (decisions, M13):
- attack pair $0.655
- adversarial set $0.047
- pack 5 $0.581
- pack 10 $0.570
- repeat-noise run $0.307

Every policy experiment reused answers at $0.
