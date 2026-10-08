<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.svg">
    <img alt="Rating Integrity Engine" src="docs/assets/banner-light.svg" width="640">
  </picture>
</p>

<p align="center">
  Fast, typed AI judgments on every review, corpus analysis for bursts and coordinated clusters,<br>
  and an <b>integrity-adjusted rating with a confidence interval</b> under a documented, auditable method.
</p>

<p align="center">
  <a href="#overview">Overview</a> ·
  <a href="#why-it-exists">Why</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#tech-stack">Tech stack</a> ·
  <a href="#results-so-far">Results</a> ·
  <a href="#run-it-locally">Run it</a> ·
  <a href="#credits">Credits</a>
</p>

<p align="center">
  <img alt="The live analysis screen: a grid of 5,000 Helldivers 2 reviews coloured by action, an hourly timeline with the May 2024 review bomb shaded, and the integrity-adjusted rating with its confidence interval" src="docs/assets/screenshot.jpg" width="900">
  <br><sub>A finished Jev run on 5,000 Helldivers 2 reviews (Apr–Jun 2024). The shaded burst is the May 2024 review bomb. The screenshot is from an earlier policy version (72.5%); under the current rules the same reviews give 77.5% (table below).</sub>
</p>

---

## Overview

Give it a review corpus (a Steam game's reviews, or a CSV of your own). A **System One model** answers nine typed questions about every review, at speed: whether it is about the product at all, whether its verdict comes from using it, whether the text supports or contradicts the verdict, how informative it is, what it is about, whether it is promotional, templated or campaign language, and whether it tries to sway its judge. Deterministic signals add near-duplicates, promo links and notes addressed to the model. Corpus analysis then finds what no single review shows: **bursts** in time and **coordinated clusters** of near-identical wording.

Each review gets an action (**keep**, **downweight**, **flag** for a human, or **exclude**) with its top three reason codes. The output is three ratings side by side: the **raw** rating, the **integrity-adjusted rating** (bootstrap 95% CI, effective sample size, methodology card), and the **platform-policy** rating, which applies Steam's written review-bomb rules to the same reviews.

Watching it run is part of the product. Thousands of squares fill in live, one per review in time order, so a review bomb shows up as a solid band of colour.

> **Not the "true" rating.** The adjusted number is the rating under this documented method, and every threshold and weight behind it is recorded with the run and shown on its results page. English-language reviews only.

## Why it exists

Online ratings mix real opinion with low-evidence noise: review bombs about things outside the product, copy-pasted slogans, spam, and one-word reviews that tell a reader nothing. Platforms usually handle this either by hiding everything in a time window, which also buries legitimate complaint waves, or with opaque models that give no reason for a decision.

This project tests a third approach:

- **Typed judgments, not essays.** System One models return calibrated probabilities for structured questions. That is fast and cheap enough to cover *every* review (about $0.35 per 5,000 reviews on Jev with question set v5), and the probabilities themselves are the explanation.
- **Evidence over suppression.** Organic negative waves must survive. Only deterministic evidence can exclude a review. A burst on its own is never a reason to exclude.
- **Honest uncertainty.** A rating comes with a CI and `n_eff`, and controls check that the method neither inflates a genuinely bad game nor suppresses a real backlash.

It is a personal portfolio project: a public, replay-only demo of eight Steam games (five review bombs and three games with a genuine reception as controls) where every review is judged visibly and three ratings are compared, including what Steam itself shows. Local Laya is benchmarked against hosted Jev; training it to bring the per-run cost to $0 is the future-exploration phase.

## How it works

| Stage | What happens | Speed |
|---|---|---|
| **S0 Ingest** | Normalise ratings to [0, 1], sort by time (the grid order), hash author IDs with a salt | seconds |
| **S1 Features** | MinHash/LSH near-duplicates, promo-link regex, length and emoji signals, MiniLM sentence embeddings | seconds |
| **S2 System One** | Nine typed questions per review (set v5) via [Jev](https://typesafe.ai) or [Laya](https://github.com/NandhaKishorM/laya); concurrent and spend-guarded | the live part |
| **S3 Corpus** | Bursts (robust z-score vs a 7-day baseline, PELT change points), duplicate clusters, semantic clusters (UMAP → HDBSCAN), suspicion scored against a permutation null | ~1–3 min at 50K |
| **S4 Decide** | Integrity score → action plus reason codes; weighted rating, bootstrap CI, `n_eff`, Steam label bands; the Steam-policy emulation | < 1 s |

The question set is versioned (`backend/app/systemone/questions_v*.py`, default v5) and tuned only on a held-out dev set. Text written to sway the judge is stripped before System One sees it.

## Architecture

```mermaid
flowchart LR
  UI["React live screen<br/>canvas grid · timeline · ticker"] -- "REST + SSE" --> API["FastAPI<br/>run orchestrator"]
  API --> P["S0 Ingest → S1 Features → S2 System One → S3 Corpus → S4 Decide"]
  P -- "one httpx client,<br/>same protocol" --> M["Jev (hosted) · laya-serve (local)"]
  P --> DB[("DuckDB")]
  P --> R[("replay recordings")]
  R -. "public demo: no backend, no key" .-> UI
```

Every run's event stream is recorded, so the public demo replays real runs with no backend and no API key. The full diagrams, covering system, pipeline, run data flow and the live-screen render path, are in **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Tech stack

| Layer | Choices |
|---|---|
| **Judgment models** | Jev (TypeSafe System One, hosted), Laya (open-source System One, local via `laya-serve`) |
| **Backend** | Python 3.12 · uv · FastAPI · sse-starlette · Pydantic v2 · httpx + aiolimiter + tenacity |
| **Data** | DuckDB · Polars · PyArrow · NumPy · SciPy |
| **Text & corpus** | datasketch (MinHash/LSH) · sentence-transformers (all-MiniLM-L6-v2) · FAISS · UMAP · scikit-learn HDBSCAN · ruptures (PELT) · lingua |
| **Frontend** | React 19 · TypeScript · Vite · Tailwind CSS v4 · shadcn/ui on Base UI · Zustand · TanStack Query · Canvas 2D |
| **Quality** | pytest · Ruff · Vitest · Testing Library · oxlint · types generated from the backend models (JSON Schema → TS) |
| **Ops** | Docker Compose · GitHub Actions CI with a leak check · Cloudflare Workers static assets for the public demo · Kaggle/Colab T4 for GPU work (CPU-only otherwise) |

## Results so far

All numbers were measured; see [`docs/RESULTS.md`](docs/RESULTS.md) and [`docs/MEASUREMENTS.md`](docs/MEASUREMENTS.md). Three ratings per game: raw, the engine's integrity-adjusted rating, and Steam's written review-bomb rules applied to the same reviews. "Steam shows" is Steam's own score for the window, with Valve's off-topic filter.

| Game (window) | Raw | Integrity-adjusted | Steam rules | Steam shows | Before the bomb |
|---|---|---|---|---|---|
| Helldivers 2 (Apr–Jun 2024, account requirement) | 76.4% | 77.5% | 89.0% | 77.7% | 88.0% |
| Borderlands 2 (Apr–Aug 2025, EULA) | 33.8% | 37.7% | 50.7% | 28.7% | 91.1% |
| Metro 2033 Redux (Dec 2018–Mar 2019, another game) | 48.8% | 62.9% | 61.5% | 49.1% | 93.8% |
| Total War: ROME II (Aug–Oct 2018, culture war) | 32.3% | 35.7% | 42.2% | 61.3% | 66.3% |
| DOOM Eternal (Oct–Dec 2022, soundtrack dispute) | 76.1% | **82.3%** | 83.1% | 91.8% | 91.1% |
| Cities: Skylines II · Gollum · FM26 (genuine reception) | 59.6 · 35.7 · 38.0% | 59.2 · 34.3 · 37.2% | 59.9 · 34.4 · 38.4% | 59.8 · 34.4 · 38.4% | — |

- **Attack benchmark** (4,999 real reviews + 690 injected, exact ground truth): the engine removes 52% of the attack's pull on the rating, against 22% for heuristics alone. A burst of varied, on-topic complaints is detected but not discounted, by design. Genuine on-topic complaints are discounted 0.3–0.6% of the time.
- **Adversarial text:** one added sentence claiming legitimacy laundered 30–39% of off-topic reviews before the defence and 0–7% after it; a note addressed to the model is now excluded. A paraphrased claim of experience still launders 40%, a stated limit.
- **Cost:** about $0.07 of Jev per 1,000 reviews, one call per review. The public demo replays recorded runs and costs nothing to serve.

## Run it locally

```bash
cp .env.example .env            # TYPESAFE_API_KEY (for Jev) and a random AUTHOR_HASH_SALT

# backend (from backend/)
uv sync --all-groups            # add --extra laya for the local model
uv run uvicorn app.main:app --reload --port 8001

# frontend (from frontend/), opens http://localhost:5173
npm install && npm run dev

# or everything at once
docker compose up --build       # add --profile laya for laya-serve
```

Pull a Steam dataset (resumable) and import it:

```bash
uv run python -m app.ingest.steam_fetcher --appid 553850 --from 2024-04-01 --to 2024-06-30
uv run python -m app.ingest.steam_import --pull <dir under data/raw/steam> --name "Helldivers 2" --sample 5000
```

Then open the app, pick a product (or upload a CSV or Excel file) and replay its recorded run ($0), or start a live Jev run after its cost pre-flight. $0 heuristic and cached runs go through the API (`POST /runs`). Finished runs replay automatically; add `?play=end` to see the final state, or `?fps=1` for the frame meter.

**Tests:** `uv run pytest` (backend) · `npm test` (frontend). Tests never touch the network or the real `.env`.

## Repository layout

```
backend/    FastAPI app: ingest (S0) · features (S1) · systemone (S2) · corpus (S3) · decide (S4)
frontend/   React app: live grid, timeline, ticker, clusters; DataSource = LiveApi | StaticBundle
tools/      benchmarks, probes, dev-set evaluation, type export
notebooks/  Kaggle/Colab GPU work
docs/       spec, plan, research, measurements, architecture
data/       local only (gitignored): DuckDB, caches, replays, raw pulls
```

## Documentation

| Doc | Contents |
|---|---|
| [Architecture](docs/ARCHITECTURE.md) | System, pipeline, run data flow and live-screen diagrams |
| [Product & technical spec](docs/MVP_SPEC.md) | Source of truth for design decisions |
| [Phased plan](docs/PLAN.md) | Phases, exit criteria, what was delivered and how it deviated |
| [Results](docs/RESULTS.md) | The evaluation: attacks, controls, known incidents, adversarial text |
| [Measurements](docs/MEASUREMENTS.md) | Every measured number, with method, as a dated log |
| [Run index](docs/RUNS.md) | Every run, with the showcase runs first |
| [Research findings](docs/RESEARCH_FINDINGS.md) | Datasets, prior work, platform policies |

## Status

Phases 0–7 and 9 are done: the pipeline end to end, the live screen, drill-downs and results, the evaluation (see [RESULTS](docs/RESULTS.md)) and the public replay-only demo, live at **https://rating-integrity-engine.vaibhavvs.workers.dev**. Open: human-agreement labels (being collected) and the demo video. Phase 10, future exploration, is training and fine-tuning Laya on labels that never come from Jev, to bring the per-run cost to $0. See [the plan](docs/PLAN.md).

## Public demo (static)

**Live:** https://rating-integrity-engine.vaibhavvs.workers.dev

The public demo is a static site: the showcase runs replayed from exported files, with no backend, database or API key.

```bash
# with the API running on :8001 (from backend/)
uv run python ../tools/export_bundle.py           # writes frontend/public/bundle (gitignored)
# from frontend/
npm run build:static && npm run check:static      # dist/ is the site; the check fails on any key or backend URL
```

- **Hosting: Cloudflare Workers static assets** (free: unlimited static requests and bandwidth, 20,000 files, 25 MiB per file). `frontend/wrangler.jsonc` serves `dist/` with no Worker script, and its single-page-app setting answers client-side routes with `index.html` and a 200.

  ```bash
  npx wrangler@4 login           # once, from frontend/
  npm run deploy:preview         # build + leak check + upload a version with a preview URL (not live)
  npm run deploy                 # build + leak check + deploy to rating-integrity-engine.<account>.workers.dev
  ```

  The bundle comes from the local database, so deploys run from a local machine, not from CI. Other hosts: `vercel.json` (Vercel) and `404.html` (GitHub Pages) are kept; `.assetsignore` keeps `404.html` out of the Workers upload. Netlify would need a `_redirects` file with `/* /index.html 200`, which Workers rejects as a redirect loop, so it is not shipped.
- **Subfolder sites:** for a GitHub Pages project site, build with `VITE_BASE=/<repo>/`.

## Responsible use

- The UI and docs talk about *integrity weight* and *low evidential value*, never about "fake" reviews, and never name reviewers. Author IDs are salted hashes from ingest onward.
- Steam review data is used under Steam's terms for personal, non-commercial use and is **not redistributed** in this repository. The public demo's bundle is exported locally and publishes review text without any reviewer identity, scrubbed of e-mails, links, phone numbers and handles (owner decision, 2026-10-08). `export_bundle.py --text none` builds a demo without text.
- An adjusted rating is a method's output, not a verdict on any reviewer or product.

## Credits

- **[TypeSafe](https://typesafe.ai)** for Jev, the hosted System One model used for the typed judgments.
- **[Laya](https://github.com/NandhaKishorM/laya)** by [@NandhaKishorM](https://github.com/NandhaKishorM) (Apache-2.0), the open-source System One model and `laya-serve`.
- **[Steam](https://partner.steamgames.com/doc/store/getreviews)** (Valve) for the public `appreviews` endpoint behind the demo datasets.
- **Open-source building blocks:** FastAPI, DuckDB, Polars, sentence-transformers and the [all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) model, UMAP, scikit-learn, ruptures, datasketch, FAISS, React, Vite, Tailwind CSS, shadcn/ui, Base UI, Zustand, TanStack Query, Lucide icons and the Geist typeface.

Built by **Vaibhav Sharma**.
