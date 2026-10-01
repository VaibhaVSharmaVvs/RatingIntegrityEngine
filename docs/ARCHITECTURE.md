# Architecture

How the Rating Integrity Engine turns a review corpus into an integrity-adjusted rating, and how the live screen shows it happening. Design rationale lives in [`MVP_SPEC.md`](MVP_SPEC.md); measured numbers in [`MEASUREMENTS.md`](MEASUREMENTS.md).

## System overview

```mermaid
flowchart LR
  subgraph Browser["Browser · React 19 + Vite"]
    UI["Live analysis screen<br/>grid · timeline · ticker · clusters"]
    Store["Zustand run store<br/>+ cell drip"]
    DS{{"DataSource"}}
    UI <--> Store
    Store <--> DS
  end

  subgraph API["FastAPI (Python 3.12)"]
    REST["REST<br/>/datasets · /runs · /clusters · /reviews"]
    SSE["SSE<br/>/runs/{id}/events"]
    Orch["Run orchestrator<br/>one asyncio task per run"]
    Bus["Event bus<br/>+ replay recorder"]
    Orch --> Bus --> SSE
  end

  subgraph S1C["System One backends · one wire protocol"]
    Jev["Jev<br/>api.typesafe.ai (hosted)"]
    Laya["laya-serve<br/>local :8000"]
  end

  DB[("DuckDB<br/>data/rie.duckdb")]
  Files[("embedding caches<br/>replays/*.jsonl.gz")]
  Steam["Steam appreviews API"]

  DS -- "LiveApi: fetch + EventSource" --> REST
  DS -- "LiveApi" --> SSE
  DS -. "StaticBundle (public demo)" .-> Files
  REST --> DB
  Orch --> DB
  Orch --> Files
  Orch -- "httpx client" --> Jev
  Orch -- "httpx client" --> Laya
  REST -- "background fetch" --> Steam
```

- **One client, two models.** Jev and `laya-serve` speak the same HTTP protocol, so switching backend changes `base_url` and `model`, not code (`backend/app/systemone/client.py`).
- **No queue.** A single-user app runs one asyncio task per run. Every event is recorded with its time offset, so a finished run can be replayed with no backend and no API key. That is how the public demo works.

## The pipeline (S0 → S4)

```mermaid
flowchart TB
  S0["<b>S0 Ingest</b><br/>normalise ratings to [0,1]<br/>sort by time → grid index<br/>hash author IDs with a salt"]
  S1["<b>S1 Deterministic features</b> (seconds)<br/>MinHash/LSH near-duplicates · promo regex<br/>length · emoji · MiniLM embeddings"]
  S2["<b>S2 System One judgments</b> (the animated part)<br/>6 typed questions per review → probabilities<br/>informativeness · rating support · topic<br/>spam/promo · templated · campaign language"]
  S3["<b>S3 Corpus analysis</b><br/>bursts: robust z vs 7-day baseline + PELT change points<br/>duplicate clusters (LSH) · semantic clusters (UMAP → HDBSCAN)<br/>suspicion vs a permutation null"]
  S4["<b>S4 Decide</b><br/>integrity score → KEEP / DOWNWEIGHT / FLAG / EXCLUDE<br/>top-3 reason codes · weighted rating<br/>bootstrap 95% CI · n_eff"]
  S0 --> S1 --> S2 --> S3 --> S4
  S1 -. "embeddings overlap S2" .-> S3
```

| Stage | Code | Output |
|---|---|---|
| S0 | `backend/app/ingest/` | `reviews` rows; `id` = chronological position = grid index |
| S1 | `backend/app/features/` | `features` rows; later copies marked (still judged) |
| S2 | `backend/app/systemone/` | `judgments` rows (versioned question sets, `questions_v*.py`) |
| S3 | `backend/app/corpus/` | `clusters`, `cluster_members`; every suspicion factor stored |
| S4 | `backend/app/decide/` | `decisions` rows; summary with raw, adjusted, CI, `n_eff` |

**Guardrails built into the design:**
- System One output alone can never EXCLUDE a review. Exclusion needs a deterministic signal: a copy inside a suspicious burst or cluster, or a high spam probability *confirmed* by the promo-link match. Spam judged by System One alone is FLAGged for a human.
- Every threshold and weight lives in the run config (`PolicyThresholds`, `ActionWeights`), and every run stores its full config, question-set version and pinned model version.
- Cluster suspicion is judged against random same-size subsets of the corpus, never the corpus-wide rate, because a cluster is itself a subset.
- Copies inside a suspicious burst or cluster are escalated. Copies outside one stay DOWNWEIGHT, so an organic complaint wave survives.

## Data flow of a run

```mermaid
sequenceDiagram
  autonumber
  participant U as Browser
  participant A as FastAPI
  participant P as Pipeline task
  participant M as System One (Jev / Laya)
  participant D as DuckDB

  U->>A: POST /runs/preflight {dataset, backend}
  A-->>U: tokens, $ estimate, ETA
  U->>A: POST /runs {config, confirm_cost}
  A->>D: insert run (queued)
  A->>P: start asyncio task
  A-->>U: run_id
  U->>A: GET /runs/{id}/events (SSE)
  P->>D: S0/S1 read reviews, write features
  P-->>U: stage · features_done
  loop batches, concurrent, spend-guarded
    P->>M: POST /v1/systemone {state, questions}
    M-->>P: typed answers + probabilities
    P-->>U: judged {indices, actions} · counters · rating
  end
  P->>D: judgments
  P-->>U: cluster events (S3)
  P->>D: clusters, decisions, summary
  P-->>U: rating {final, ci} · done {summary}
  Note over P: the event stream is saved as replays/{run}.jsonl.gz
  U->>A: GET /runs/{id}/clusters/{cid} · /reviews/{rid}
  A->>D: query
  A-->>U: members, factors, review text
```

Spending money is gated twice. Every Jev run goes through the pre-flight, and a run above `MAX_RUN_COST_USD` needs `confirm_cost: true`. A running spend guard also stops the run if the cost passes the approved estimate by a slack factor. Policy experiments reuse a finished run's answers through `backend: "cached"`, at $0.

## The live screen

```mermaid
flowchart LR
  E["SSE event<br/>or planned replay event"] --> Drip["Cell drip<br/>reveals each batch cell by cell;<br/>holds counters/rating until<br/>their batch is on screen"]
  Drip --> Red["reduceEvents()<br/>pure reducer"]
  Red --> Grid["GridBuffer<br/>Uint8 actions · fade clock · tally"]
  Red --> State["stages · counters · rating ·<br/>clusters · summary"]
  Grid -- "gridVersion" --> Canvas["IntegrityGrid canvas<br/>1 px per review ImageData,<br/>scaled up crisp; repaints only<br/>changed or fading cells"]
  Grid -- "gridVersion" --> TL["TimelineStrip canvas<br/>hourly stacks by action"]
  State --> Panels["Ticker · counters ·<br/>stepper · cluster feed"]
```

- **Rendering budget.** 50K reviews replay at 60 fps, with grid paint p95 at 0.4 ms (MEASUREMENTS M10). Grid cells never go through React. Components subscribe to a version counter and read the mutable buffer directly.
- **Watchable by design.** Finished runs auto-play, and the grid fills in 30 s whatever the run's recorded pace. Each decision flashes in, and the rating moves with the cells that are visible.
- **Two data sources, one interface.** `LiveApi` talks to the backend (REST + `EventSource`). `StaticBundle` (Phase 9) plays exported bundles with no backend, for the public demo.

## Storage

| Store | Holds |
|---|---|
| `data/rie.duckdb` | datasets, reviews (hashed authors only), runs, features, judgments, clusters, decisions, labels. Access goes through `Database.cursor()` (UTC-pinned, thread-safe) |
| `data/cache/` | embedding caches (`.npy`) keyed by dataset and model |
| `data/replays/` | one `jsonl.gz` event recording per run |

`data/` and `.env` are never committed.
