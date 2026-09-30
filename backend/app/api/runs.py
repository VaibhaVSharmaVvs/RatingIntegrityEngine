import asyncio
import json

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import FileResponse
from sse_starlette.sse import EventSourceResponse

from app.api.datasets import fetch_dataset
from app.api.deps import AppState, get_state
from app.ingest.store import new_id
from app.models import ActionCode, RunCreate, RunOut, RunSummary
from app.pipeline import Pipeline

router = APIRouter(prefix="/runs", tags=["runs"])

IMPLEMENTED_BACKENDS = {"mock"}
_COLUMNS = (
    "id, dataset_id, backend, model_version, status, error, config, started_at, finished_at, "
    "stats, cost_usd, tokens_in"
)


def _fetch_run(state: AppState, run_id: str) -> RunOut:
    with state.db.cursor() as cur:
        row = cur.execute(f"SELECT {_COLUMNS} FROM runs WHERE id = ?", [run_id]).fetchone()
    if row is None:
        raise HTTPException(404, f"run {run_id} not found")
    f = dict(zip(_COLUMNS.split(", "), row, strict=True))
    stats = f.pop("stats")
    return RunOut(
        **f | {"config": RunCreate.model_validate_json(f["config"])},
        summary=RunSummary.model_validate_json(stats) if stats else None,
    )


@router.post("", response_model=RunOut, status_code=201)
async def create_run(req: RunCreate, state: AppState = Depends(get_state)) -> RunOut:
    ds = fetch_dataset(state, req.dataset_id)
    if ds.status != "ready":
        raise HTTPException(409, f"dataset is {ds.status}, not ready")
    if req.backend not in IMPLEMENTED_BACKENDS:
        raise HTTPException(422, f"backend '{req.backend}' is not implemented yet")
    run_id = new_id("run")
    with state.db.cursor() as cur:
        cur.execute(
            "INSERT INTO runs (id, dataset_id, backend, config, status) VALUES (?, ?, ?, ?, 'queued')",
            [run_id, req.dataset_id, req.backend, req.model_dump_json()],
        )
    bus = state.events.create(run_id)
    pipeline = Pipeline(state.db, run_id, req, bus)
    state.pipelines[run_id] = pipeline

    async def run() -> None:
        try:
            await pipeline.run()
        finally:
            state.pipelines.pop(run_id, None)

    task = asyncio.create_task(run())
    state.tasks.add(task)
    task.add_done_callback(state.tasks.discard)
    return _fetch_run(state, run_id)


@router.get("/{run_id}", response_model=RunOut)
def get_run(run_id: str, state: AppState = Depends(get_state)) -> RunOut:
    return _fetch_run(state, run_id)


@router.get("/{run_id}/events")
async def run_events(run_id: str, state: AppState = Depends(get_state)) -> EventSourceResponse:
    stream = state.events.stream(run_id)
    if stream is None:
        _fetch_run(state, run_id)  # 404 if the run doesn't exist
        raise HTTPException(404, "no event stream for this run")

    async def sse():
        async for line in stream:
            yield {
                "event": line.event.type,
                "data": json.dumps({"t": line.t, **line.event.model_dump(mode="json")}),
            }

    return EventSourceResponse(sse(), ping=15)


@router.get("/{run_id}/grid")
def run_grid(run_id: str, state: AppState = Depends(get_state)) -> Response:
    """Uint8 action codes, one per review, in grid (chronological) order."""
    live = state.pipelines.get(run_id)
    if live is not None:
        return Response(live.grid.tobytes(), media_type="application/octet-stream")
    run = _fetch_run(state, run_id)
    ds = fetch_dataset(state, run.dataset_id)
    grid = np.zeros(ds.n_reviews, dtype=np.uint8)
    with state.db.cursor() as cur:
        rows = cur.execute(
            "SELECT review_id, action FROM decisions WHERE run_id = ?", [run_id]
        ).fetchall()
    for rid, action in rows:
        grid[rid] = ActionCode[action]
    return Response(grid.tobytes(), media_type="application/octet-stream")


@router.get("/{run_id}/replay")
def run_replay(run_id: str, state: AppState = Depends(get_state)) -> FileResponse:
    path = state.events.replay_path(run_id)
    if not path.exists():
        _fetch_run(state, run_id)
        raise HTTPException(404, "replay not available yet (run still in progress?)")
    return FileResponse(path, media_type="application/gzip", filename=f"{run_id}.jsonl.gz")
