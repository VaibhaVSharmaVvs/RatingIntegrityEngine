# Rating Integrity Engine

Fast, structured AI judgments over large review corpora → an **integrity-adjusted rating** under a documented, auditable method.

> Not the "true" rating: the rating produced under this project's documented methodology.

**Status:** Phase 0 (setup). See [`docs/PLAN.md`](docs/PLAN.md).

## Quick start (local)

```bash
cp .env.example .env            # add TYPESAFE_API_KEY and a random AUTHOR_HASH_SALT

# backend
cd backend && uv sync --all-groups          # add --extra laya for the local model
uv run uvicorn app.main:app --reload --port 8001

# frontend
cd frontend && npm install && npm run dev    # http://localhost:5173

# or everything
docker compose up --build
```

## Docs
- [Product & technical spec](docs/MVP_SPEC.md)
- [Phased plan](docs/PLAN.md)
- [Research findings](docs/RESEARCH_FINDINGS.md)
