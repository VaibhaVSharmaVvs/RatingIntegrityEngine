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
  <br><sub>A finished Jev run on 5,000 Helldivers 2 reviews (Apr–Jun 2024). The shaded burst is the May 2024 review bomb. This run predates the current policy defaults, hence 72.5% rather than the 72.9% below.</sub>
</p>

---

## Overview

Give it a review corpus (a Steam game's reviews, or a CSV of your own). A **System One model** answers six typed questions about every review, at speed: how informative it is, whether the text supports its verdict, what it is about, and whether it is promotional, templated or campaign language. Deterministic signals add near-duplicates and promo links. Corpus analysis then finds what no single review shows: **bursts** in time and **coordinated clusters** of near-identical wording.

Each review gets an action (**keep**, **downweight**, **flag** for a human, or **exclude**) with its top three reason codes. The output is the raw rating next to the **integrity-adjusted rating**, with a bootstrap 95% CI, an effective sample size and a methodology card.

Watching it run is part of the product. Thousands of squares fill in live, one per review in time order, so a review bomb shows up as a solid band of colour.

> **Not the "true" rating.** The adjusted number is the rating under this documented method, and every threshold and weight behind it is visible and adjustable. English-language reviews only.

## Why it exists

Online ratings mix real opinion with low-evidence noise: review bombs about things outside the product, copy-pasted slogans, spam, and one-word reviews that tell a reader nothing. Platforms usually handle this either by hiding everything in a time window, which also buries legitimate complaint waves, or with opaque models that give no reason for a decision.

This project tests a third approach:

- **Typed judgments, not essays.** System One models return calibrated probabilities for structured questions. That is fast and cheap enough to cover *every* review (about $0.25 per 5,000 reviews on Jev), and the probabilities themselves are the explanation.
- **Evidence over suppression.** Organic negative waves must survive. Only deterministic evidence can exclude a review. A burst on its own is never a reason to exclude.
- **Honest uncertainty.** A rating comes with a CI and `n_eff`, and controls check that the method neither inflates a genuinely bad game nor suppresses a real backlash.

It is a portfolio project: a public, replay-only demo that judges 50K Steam reviews visibly, finds the Helldivers 2 review bomb (May 2024), and compares hosted Jev with local Laya on cost, latency and accuracy.

## How it works

| Stage | What happens | Speed |
|---|---|---|
| **S0 Ingest** | Normalise ratings to [0, 1], sort by time (the grid order), hash author IDs with a salt | seconds |
| **S1 Features** | MinHash/LSH near-duplicates, promo-link regex, length and emoji signals, MiniLM sentence embeddings | seconds |
| **S2 System One** | Six typed questions per review via [Jev](https://typesafe.ai) or [Laya](https://github.com/NandhaKishorM/laya); concurrent and spend-guarded | the live part |
| **S3 Corpus** | Bursts (robust z-score vs a 7-day baseline, PELT change points), duplicate clusters, semantic clusters (UMAP → HDBSCAN), suspicion scored against a permutation null | ~1–3 min at 50K |
| **S4 Decide** | Integrity score → action plus reason codes; weighted rating, bootstrap CI, `n_eff`, Steam label bands | < 1 s |

The question set is versioned (`backend/app/systemone/questions_v*.py`) and tuned only on a held-out dev set.

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
| **Ops** | Docker Compose · Kaggle/Colab T4 for GPU work (CPU-only otherwise) |

## Results so far

All numbers were measured; see [`docs/MEASUREMENTS.md`](docs/MEASUREMENTS.md). Evaluation against injected attacks and human labels is [Phase 7](docs/PLAN.md).

| Run | Raw → adjusted (95% CI) |
|---|---|
| Helldivers 2, 5K subset, Jev, full pipeline | 76.4% → **72.9%** (71.5–74.2%) · bursts found **3–8 May 2024** |
| Cities: Skylines II control (organic backlash) | 59.6% → 58.8% · **0 reviews penalised** by clusters |
| LOTR: Gollum control (genuinely poor game) | 35.7% → 34.4% · **not inflated** |

- **Scale:** UMAP + HDBSCAN on 50K reviews in 3.3 min on a laptop CPU. A full 50K heuristic run takes 48 s end to end.
- **Live screen:** a 50K replay renders at 60 fps (grid paint p95 0.4 ms).
- **Cost:** about $0.25 of Jev per 5,000 reviews, one call per review.

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

Then open the app and start a $0 heuristic run, or a Jev run after its cost pre-flight. Finished runs replay automatically; add `?play=end` to see the final state, or `?fps=1` for the frame meter.

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
| [Measurements](docs/MEASUREMENTS.md) | Every measured number, with method |
| [Research findings](docs/RESEARCH_FINDINGS.md) | Datasets, prior work, platform policies |

## Status

Phases 0–5 are done: backend pipeline end to end, plus the live analysis screen. Next up: drill-downs, results and export (Phase 6, the demoable MVP), then evaluation and benchmarks (Phase 7), then the public replay-only demo (Phase 9). See [the plan](docs/PLAN.md).

## Responsible use

- The UI and docs talk about *integrity weight* and *low evidential value*, never about "fake" reviews, and never name reviewers. Author IDs are salted hashes from ingest onward.
- Steam review data is used under Steam's terms for personal, non-commercial use and is **not redistributed** in this repository.
- An adjusted rating is a method's output, not a verdict on any reviewer or product.

## Credits

- **[TypeSafe](https://typesafe.ai)** for Jev, the hosted System One model used for the typed judgments.
- **[Laya](https://github.com/NandhaKishorM/laya)** by [@NandhaKishorM](https://github.com/NandhaKishorM) (Apache-2.0), the open-source System One model and `laya-serve`.
- **[Steam](https://partner.steamgames.com/doc/store/getreviews)** (Valve) for the public `appreviews` endpoint behind the demo datasets.
- **Open-source building blocks:** FastAPI, DuckDB, Polars, sentence-transformers and the [all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) model, UMAP, scikit-learn, ruptures, datasketch, FAISS, React, Vite, Tailwind CSS, shadcn/ui, Base UI, Zustand, TanStack Query, Lucide icons and the Geist typeface.

Built by **Vaibhav Sharma**.
