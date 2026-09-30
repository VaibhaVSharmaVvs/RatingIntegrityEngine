import asyncio
import json

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import FileResponse
from sse_starlette.sse import EventSourceResponse

from app.api.datasets import fetch_dataset
from app.api.deps import AppState, get_state
from app.ingest.store import new_id
from app.models import ActionCode, PreflightOut, RunCreate, RunOut, RunSummary
from app.pipeline import COST_CAP_SLACK, Pipeline
from app.systemone import preflight
from app.systemone import questions as question_sets
from app.systemone.backend import SystemOneBackend, backend_spec
from app.systemone.client import SystemOneClient
from app.systemone.questions_v1 import build_state, verdict_words

router = APIRouter(prefix="/runs", tags=["runs"])

IMPLEMENTED_BACKENDS = {"mock", "heuristic", "jev", "laya"}
_COLUMNS = (
    "id, dataset_id, backend, model_version, status, error, config, started_at, finished_at, "
    "stats, cost_usd, tokens_in"
)


def make_systemone_backend(req: RunCreate, state: AppState) -> SystemOneBackend:
    spec = backend_spec(req.backend, state.settings, req.model, req.concurrency)
    transport = state.systemone_transport  # tests inject a fake server here
    return SystemOneBackend(
        SystemOneClient(spec, transport=transport),
        pack_size=req.pack_size,
        samples_per_review=req.samples_per_review,
        questions=question_sets.get(req.question_set),
    )


def run_preflight(req: RunCreate, state: AppState) -> preflight.Preflight:
    with state.db.cursor() as cur:
        ds = cur.execute(
            "SELECT name, source, rating_scale, source_params FROM datasets WHERE id = ?",
            [req.dataset_id],
        ).fetchone()
        rows = cur.execute(
            "SELECT text, rating_raw, rating_norm, meta FROM reviews WHERE dataset_id = ?",
            [req.dataset_id],
        ).fetchall()
    name, source, scale, params = ds
    default_subject = json.loads(params or "{}").get("subject") or name
    states = [
        build_state(
            json.loads(meta or "{}").get("subject") or default_subject,
            source,
            verdict_words(raw, norm, scale),
            text,
        )
        for text, raw, norm, meta in rows
    ]
    distinct = len({json.dumps(s, sort_keys=True, ensure_ascii=False) for s in states})
    s = state.settings
    price = 0.0
    rps = s.jev_requests_per_second
    if req.backend == "jev":
        from app.systemone.backend import JEV_PRICE_PER_MTOK

        price = JEV_PRICE_PER_MTOK
    return preflight.estimate(
        states,
        req,
        price_per_mtok=price,
        requests_per_second=rps,
        limit_usd=s.max_run_cost_usd,
        distinct_inputs=distinct,
    )


@router.post("/preflight", response_model=PreflightOut)
def preflight_run(req: RunCreate, state: AppState = Depends(get_state)) -> PreflightOut:
    """Cost / token / ETA estimate for a run, without starting it."""
    fetch_dataset(state, req.dataset_id)
    return PreflightOut(**run_preflight(req, state).as_dict())


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
    pf = run_preflight(req, state)
    if pf.needs_confirmation and not req.confirm_cost:
        raise HTTPException(
            402,
            {
                "message": (
                    f"estimated ${pf.est_cost_usd:.2f} exceeds MAX_RUN_COST_USD "
                    f"${pf.limit_usd:.2f}; resend with confirm_cost=true to proceed"
                ),
                "preflight": pf.as_dict(),
            },
        )
    run_id = new_id("run")
    with state.db.cursor() as cur:
        cur.execute(
            "INSERT INTO runs (id, dataset_id, backend, config, status) VALUES (?, ?, ?, ?, 'queued')",
            [run_id, req.dataset_id, req.backend, req.model_dump_json()],
        )
    bus = state.events.create(run_id)
    embedder = state.embedder_factory(req.features) if state.embedder_factory else None
    backend = None
    if req.backend in ("jev", "laya"):
        try:
            backend = make_systemone_backend(req, state)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
    pipeline = Pipeline(
        state.db,
        run_id,
        req,
        bus,
        cache_dir=state.settings.embeddings_cache_dir,
        embedder=embedder,
        backend=backend,
    )
    if req.backend in ("jev", "laya"):
        approved = max(pf.est_cost_usd, 0.0) if req.confirm_cost else pf.limit_usd
        pipeline.cost_cap_usd = max(approved, pf.est_cost_usd) * COST_CAP_SLACK
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
