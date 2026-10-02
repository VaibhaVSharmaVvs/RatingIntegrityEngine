# Rating Integrity Engine: Product Research Findings

*Researched 2026-09-29. Source: `idea.txt`. [V] means confirmed in a source; [U] means unverified, check before external use.*

> ⚠️ Review datasets contain PII (reviewer names, user IDs, steamids). Anonymize them before sharing. The prices and vendor claims below are from research agents' web lookups. Re-verify them before relying on them.

---

## 1. Verdict

**It can be built. A demoable MVP takes about 4 weeks with 2 engineers, or about 6 weeks with 1.** All the parts exist as mature open-source tools, and the public data is good enough for both a credible benchmark and a strong visual demo.

Three points in the idea's framing need correcting:

1. **"System One Model" is a real product, and a very new one.** It is TypeSafe AI's **Jev**, launched 2026-09-15 and still waitlist-only. Its own docs say it is **sensitive to adversarial content** ("text that argues for its own classification can move the answer"). Spam and fake reviews are adversarial by definition. **Don't build the architecture around one 2-week-old vendor.** Build a vendor-neutral judgment layer and make Jev one backend in a bake-off.
2. **Cost is not the differentiator.** Every non-frontier architecture costs **under ~$50 per 1M reviews**. The pitch should rest on throughput, calibrated structured judgments, explainability and auditability, not "cheaper than GPT".
3. **A consumer product is a proven failure mode.** Fakespot (shut down by Mozilla, July 2025) and ReviewMeta (offline, early 2026) both died from scraping fragility and no revenue. The opening is **B2B: compliance and audit evidence on data the client owns**.

---

## 2. What "System One Model" is

| Item | Finding |
|---|---|
| Vendor / model | TypeSafe AI (SF) — **Jev** (`jev-1.13.0`), launched 2026-09-15 [V] |
| Interface | `POST https://api.typesafe.ai/v1/systemone`. Input is text or JSON "state" plus typed questions: **Choice** (≤255 options), **Score** (numeric range), **Noul** (yes/no probability). Output is calibrated probabilities only, with no text. |
| Price | **$0.042 per 1M input tokens, output free** [V] |
| Limits | 64k context, 250k tokens/s, 1,200 requests/min (the docs say limits are "adjusting dynamically") |
| Latency | 70–500 ms, "40–200× faster than LLMs" (**vendor claim**) |
| Documented weaknesses | Adversarial sensitivity, weak numeric reasoning, distraction by irrelevant state, no explanations |
| Compliance | SOC 2 Type II via Vanta [U]. ISO 27001 unknown. Zero data retention only by contract. **Get the attestation and a ZDR clause before sending review text.** |

Sources: docs.typesafe.ai/concepts/system-one, typesafe.ai/blog/introducing-system-one-models-and-jev, simonwillison.net/2026/Sep/21/jev/, VentureBeat coverage of prompt-injection risk.

**The fit with this idea is strong.** The idea's per-review output (Informational LOW, Duplicate-like HIGH…) maps directly onto Jev's Choice/Score/Noul primitives. **The risk is the adversarial weakness.** Mitigation: treat the judgment layer as *one signal among several*. The deterministic signals (MinHash duplicates, time bursts, rating distribution) cannot be argued with by review text.

---

## 3. Cost model

Assumes 100 input and 20 output tokens per review, excluding prompt overhead. Prices are as reported on vendor pricing pages, 2026-09 [verify].

| Architecture | 50K reviews | 1M reviews |
|---|---|---|
| A. Frontier LLM on every review (Claude Opus 5.5) | ~$40 (batch ~$20) | ~$800 (batch ~$400); ~+30% with the newer tokenizer |
| B. Small LLM on every review (Claude Haiku 4.5) | ~$10 (batch ~$5) | ~$200 (batch ~$100) |
| B. Cheapest small LLMs (gpt-6-luna, Gemini Flash-Lite) | $0.50–2.75 | $10–55 |
| B. Jev on every review | ~$0.21 | ~$4.20 |
| **C. Heuristics + embeddings first, then small LLM on ~20%** | ~$0.30–2 | **~$6–42** |
| C + frontier model on the hardest 5–20% | +$1–4 | +$20–80 |
| D. Fine-tuned encoder (ModernBERT/DeBERTa), self-hosted [U] | <$1 compute | <$5 compute + one-time labeling |

Caveats:
- **Prompt overhead dominates.** A 300-token instruction prompt multiplies input cost about 4×. Prompt caching and packing several reviews per call bring most of that back.
- **Jev throughput.** At 1,200 requests/min and one review per request, 1M reviews takes about 14 hours. You need to batch reviews per request (per-item answers not verified) or get enterprise limits.
- **Conclusion:** choose on **accuracy on labeled data, adversarial robustness, explainability and vendor compliance**, not price. Recommend a **bake-off on ~2K human-labeled reviews** comparing Haiku 4.5, a nano-class model, Jev and a fine-tuned encoder.

---

## 4. Market and competition

**Status of the landscape [V]:**
- **Dead consumer tools:** Fakespot (closed 2025-07-01), ReviewMeta (offline early 2026).
- **Platforms' in-house systems (black boxes, work only on their own data):**
  - Amazon: 275M fake reviews blocked in 2024.
  - Google Maps: 292M removed in 2025, using Gemini.
  - Yelp: ~500K AI-generated reviews filtered.
  - Trustpilot: 4.5M removed in 2024.
  - Steam: off-topic review-bomb exclusion since 2019.
  - Metacritic: 36-hour delay on user reviews.
  - Rotten Tomatoes: "Verified" audience score.
- **B2B players:**
  - Pasabi was acquired by Themis (Oct 2025), so the space is consolidating into fraud platforms.
  - The Transparency Company analyses reviews and also helps businesses recover wrongly removed ones.
  - Pangram sells AI-text detection.

**The gap:** nobody offers a **neutral, cross-platform, auditable integrity-adjusted rating with a published methodology**. The idea's "we don't claim it's the true rating, it's the rating under a documented methodology" framing is exactly the right answer to this gap.

**Regulation is creating demand [V]:**
- **US: FTC Consumer Review Rule** (since Oct 2024), up to ~$53K per violation.
  - Warning letters to 10 firms (Dec 2025).
  - TruHeight $4M judgment (Apr 2026).
  - Focus is on high-consequence services.
- **UK: DMCC Act** (since Apr 2025), fines up to 10% of global turnover.
  - Formal CMA cases since Mar 2026, including Feefo, which is itself a review platform.
  - Google and Amazon have signed undertakings.
- **EU: Omnibus Directive** requires businesses to *disclose how they check that reviews are genuine*.
  - A sweep found 55% of sites non-compliant.

**Market size:** there is no credible figure for fake-review detection specifically. Broad content moderation / trust & safety is estimated at $9.6–15B (2025), with 13–15% annual growth, from low-reliability paid reports. **Do a bottom-up estimate by segment instead**; don't quote a TAM.

**Likely buyers, ranked (inference):**
1. Mid-tier review platforms and marketplaces with CMA/FTC/EU exposure and no in-house ML. They need audit evidence.
2. Regulated service verticals: legal, property, healthcare, home services.
3. Brands and agencies; market-research firms that need clean sentiment data; alt-data investors, who will demand backtests.
4. Consumers and media. Low willingness to pay, as Fakespot and ReviewMeta showed.

---

## 5. Data for the MVP

| Purpose | Dataset | Why | Access / license |
|---|---|---|---|
| **Benchmark metrics** | **YelpZip / YelpNYC** (Rayana & Akoglu, KDD'15). Zip: 608K reviews, 13% filtered. | The only set with fake labels **plus** user IDs, timestamps and ratings | **Request by email: start now.** Research-only [U]. Labels come from Yelp's filter, so they measure agreement with Yelp, not ground truth. |
| Text deception | Ott OpSpam (1.6K hotel reviews) | Classic gold-standard benchmark | CC BY-NC-SA: non-commercial |
| Templated / LLM text | Salminen Fake Reviews (40K, GPT-2), AiGen-FoodReview (20K, GPT-4) | Modern generated-text cases | CC BY 4.0 (Kaggle mirror) / MIT |
| **Visual demo (bursts, clusters)** | **Steam: Helldivers 2 (appid 553850), Apr–Jun 2024** | Known bomb: ~229K negative reviews in May 2024 vs ~16K the month before. The public API needs no key and returns timestamps, playtime and account review count. `filter_offtopic_activity=0` includes the bomb reviews. | Steam terms: personal / non-commercial. **Legal review before commercial use.** |
| Backup demo | Overwatch 2 (Aug 2023); Amazon Reviews 2023 (McAuley, 571M reviews) | Second incident; general corpus for synthetic injection | Research use [U] |

**Scraping is out.** IMDb, Google Play and Amazon terms all forbid it. For a product, **use client-supplied data**.

**Human agreement:** no dataset ships inter-annotator labels. Plan to **hand-label ~300 reviews with 2–3 raters** and report Cohen's or Fleiss' κ.

**Exact ground truth:** build a **synthetic attack injector** (template floods, paraphrased LLM floods, coordinated 1-star bursts) and inject it into clean data. This is also the best live-demo moment.

---

## 6. Technical approach, by signal

| Signal | Technique | Library |
|---|---|---|
| Duplicate / template | MinHash + LSH (Jaccard 0.6–0.8) + embedding cosine >0.9 | `datasketch`, `sentence-transformers` (MiniLM), FAISS / hnswlib |
| Semantic clusters | UMAP → HDBSCAN; c-TF-IDF labels for captions | `umap-learn`, `sklearn.HDBSCAN`, BERTopic |
| Burst / coordination | Rolling robust z-score per star level, Kleinberg bursts, change points in the mean rating | `burst_detection`, `ruptures` |
| Rating-distribution anomaly | Jensen–Shannon divergence against the item's own trailing baseline; dip test for bimodality; departure from the normal J-shaped distribution | `scipy`, `diptest` |
| Rating–text consistency | Sentiment model predicting 1–5 stars vs the given star; ambiguous cases go to the judgment layer | `nlptown/bert-base-multilingual-uncased-sentiment` |
| Informativeness | Length, lexical diversity, aspect nouns, numbers and entities, generic-phrase lexicon | spaCy, textstat |
| Spam / promo | Regex (URLs, phones, emails, coupons, "DM me") + TF-IDF logistic regression | `urlextract`, `phonenumbers`, sklearn |
| Group spam (when user IDs exist) | Reviewer–item graph: FRAUDAR, SpEagle, REV2 | PyGOD, networkx |
| **LLM-generated text** | **Weak feature only.** RAID (ACL 2024) shows detectors degrade 36–40% under simple attacks, they are biased against non-native writers, and short reviews are the worst case. It must **never** FLAG or EXCLUDE a review on its own. | Binoculars (optional) |

**Cluster suspicion score** = time concentration × wording similarity × rating homogeneity × share of new accounts. This produces the idea's "127 reviews, 91% in 14 min, 84% similar, 93% same rating" caption directly.

**Adjusted rating with honest uncertainty:**
- Weighted mean Σwᵢrᵢ/Σwᵢ, shown alongside the raw mean, a trimmed mean and a Bayesian average.
- **Bootstrap 95% CI** and **effective sample size** n_eff = (Σw)²/Σw².
- Display example: "7.4 → 8.1 (95% CI 7.9–8.3), n_eff 41,200 of 50,000".
- Every decision carries its **top-3 reason codes**.

**Design lesson from Steam:** exclude **off-topic** bursts, not all negative bursts. Real complaint waves must survive. Measure false positives on organic negative spikes explicitly.

---

## 7. MVP scope and stack

**In scope:**
- CSV upload (text, rating, timestamp, optional user ID).
- The pipeline above.
- Live square grid that recolors as reviews are processed.
- Clickable cluster drawer with a timeline sparkline.
- Raw vs adjusted rating with CI.
- Reason codes.
- Labeled benchmark page.
- Bundled Helldivers 2 and YelpZip samples.

**Out of scope for the MVP:** multi-tenant SaaS, scraping, reviewer-level public labels, real-time ingestion.

| Layer | Choice |
|---|---|
| Backend | Python 3.12, FastAPI, SSE (`sse-starlette`) for progress, process pool for jobs |
| Data | Polars + DuckDB (single-file store, fast drill-down SQL) |
| ML | sentence-transformers (CPU: ~1–2K reviews/s), datasketch, FAISS, UMAP/HDBSCAN, ruptures, nlptown |
| Judgment layer | **Pluggable interface**: Jev / Claude Haiku 4.5 / nano-class model / local Qwen via Ollama |
| Frontend | React + Vite + TS. The 50K-square grid uses Canvas2D `ImageData` (<5 ms redraw); SSE updates are batched every ~250 reviews. |
| Packaging | docker-compose, sample datasets bundled |

---

## 8. Plan

**Goal:** a demoable MVP that processes 50K reviews visually and reports a benchmarked integrity-adjusted rating, in about 4 weeks with 2 engineers.

| Week | Task (deliverable) | Key activities |
|---|---|---|
| 0 (now) | Data and vendor access | Email for YelpZip access; join the Jev waitlist and request SOC2 / ZDR terms; pull Helldivers 2 reviews via the Steam API; start hand-labeling 300 reviews |
| 1 | Pipeline skeleton | CSV ingest + PII hashing, DuckDB schema, heuristic signals, MinHash, SSE job endpoint, first grid render |
| 2 | Core detectors | Embeddings + FAISS, bursts / change points, rating–text model, UMAP/HDBSCAN + cluster metrics |
| 3 | Decisioning + UI | Weight rules, bootstrap CI, reason codes, cluster drawer, raw vs adjusted view |
| 4 | Evaluation + polish | Benchmark harness, ablations, judgment-layer bake-off, attack injector, performance at 50K rows |

**Evaluation (the "legitimate engineering story"):**
- **Metrics:** precision, recall, F1 and PR-AUC per review; cluster purity and ARI; |adjusted − clean rating| and CI coverage; **false-positive rate on organic negative bursts**; reviews per second; $ per 10K reviews.
- **Ablations:**
  - (a) heuristics only
  - (b) + embeddings and clusters
  - (c) + judgment layer on the ambiguous 5–20%
  - (d) LLM on every review
  - (e) leave-one-signal-out
- **Hypothesis to test, not claim:** (c) gets most of (d)'s quality at about 10% of the cost and much lower latency.

---

## 9. Risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| **Defamation.** Courts treat "this review is fake" as a factual claim; an Ohio appeals court let a defamation case over 62 alleged fake reviews proceed. | High | Never say "fake". Use "integrity weight" and "low evidential value". Never name reviewers. Keep evidence trails. **Have a lawyer review the wording before any public link.** |
| Adversarial text moving the model's judgment (a documented Jev weakness) | High | Deterministic signals weigh as much as model judgments; the model alone can never EXCLUDE; red-team with the injector |
| False positives against real complainers or non-native writers | High | Prefer DOWNWEIGHT over EXCLUDE; humans review FLAGs; publish error rates; run an FP test on organic bursts |
| Vendor immaturity (Jev is 2 weeks old, on a waitlist, with shifting limits) | Medium | Pluggable judgment layer; fallback to Haiku 4.5 or a local model |
| Dataset licenses are NC or research-only | Medium | Demo and benchmark only; client data for any commercial use; Legal sign-off |
| PII in reviews sent to third-party APIs | Medium | Hash IDs and strip names/emails at ingest; vendor DPA + ZDR |
| A published methodology gives attackers a playbook | Medium | Publish principles, keep thresholds private, version the models |
| Demo number looks cherry-picked (7.4 → 8.1) | Low–Medium | Always show the CI, n_eff and the ablation table next to the headline number |

---

## 10. Open decisions (for the team, not made here)

1. Positioning: B2B compliance and audit engine (recommended by this research) or a developer API or data product.
2. Whether to depend on Jev at all after the bake-off.
3. First target vertical for the demo narrative: gaming (Steam, strongest visuals) or local services (FTC/CMA focus, strongest buyer pull).
