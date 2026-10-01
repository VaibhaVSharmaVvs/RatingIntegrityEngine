import asyncio
import json

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import FileResponse
from sse_starlette.sse import EventSourceResponse

from app.api.datasets import fetch_dataset
from app.api.deps import AppState, get_state
from app.ingest.store import new_id
from app.models import (
    ActionCode,
    ClusterDetail,
    ClusterOut,
    ClusterReview,
    PreflightOut,
    RunCreate,
    RunOut,
    RunSummary,
)
from app.pipeline import COST_CAP_SLACK, Pipeline
from app.systemone import preflight
from app.systemone import questions as question_sets
from app.systemone.backend import SystemOneBackend, backend_spec
from app.systemone.cached import CachedBackend
from app.systemone.client import SystemOneClient
from app.systemone.questions_v1 import build_state, verdict_words

router = APIRouter(prefix="/runs", tags=["runs"])

IMPLEMENTED_BACKENDS = {"mock", "heuristic", "jev", "laya", "cached"}
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
    try:
        if req.backend in ("jev", "laya"):
            backend = make_systemone_backend(req, state)
        elif req.backend == "cached":
            if not req.reuse_judgments_from:
                raise ValueError("backend 'cached' needs reuse_judgments_from=<run id>")
            backend = CachedBackend(
                state.db, req.reuse_judgments_from, req.dataset_id, req.question_set
            )
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


@router.get("", response_model=list[RunOut])
def list_runs(
    dataset_id: str | None = None, limit: int = 50, state: AppState = Depends(get_state)
) -> list[RunOut]:
    """Most recent runs first."""
    sql = "SELECT id FROM runs"
    params: list = []
    if dataset_id:
        sql += " WHERE dataset_id = ?"
        params.append(dataset_id)
    sql += " ORDER BY started_at DESC NULLS FIRST, id LIMIT ?"
    params.append(min(max(limit, 1), 500))
    with state.db.cursor() as cur:
        ids = [r[0] for r in cur.execute(sql, params).fetchall()]
    return [_fetch_run(state, i) for i in ids]


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


_CLUSTER_COLS = (
    "cluster_id, kind, size, t_start, t_end, suspicion, time_concentration, mean_similarity, "
    "rating_homogeneity, new_account_share, offtopic_mean, caption, top_phrases, window_info"
)


def _cluster_row(row: tuple) -> ClusterOut:
    (cid, kind, size, t0, t1, susp, tc, sim, homog, new, off, caption, phrases, window) = row
    return ClusterOut(
        cluster_id=cid,
        kind=kind,
        size=size,
        t_start=t0,
        t_end=t1,
        suspicion=susp,
        factors={
            "time_concentration": tc,
            "similarity": sim,
            "rating_homogeneity": homog,
            "new_account_share": new,
            "offtopic_mean": off,
        },
        caption=caption or "",
        top_phrases=json.loads(phrases or "[]"),
        window=json.loads(window or "{}"),
    )


@router.get("/{run_id}/clusters", response_model=list[ClusterOut])
def list_clusters(
    run_id: str, kind: str | None = None, limit: int = 100, state: AppState = Depends(get_state)
) -> list[ClusterOut]:
    """Clusters ranked by suspicion (most suspicious first)."""
    _fetch_run(state, run_id)
    sql = f"SELECT {_CLUSTER_COLS} FROM clusters WHERE run_id = ?"
    params: list = [run_id]
    if kind:
        sql += " AND kind = ?"
        params.append(kind)
    sql += " ORDER BY suspicion DESC, size DESC LIMIT ?"
    params.append(min(max(limit, 1), 1000))
    with state.db.cursor() as cur:
        return [_cluster_row(r) for r in cur.execute(sql, params).fetchall()]


@router.get("/{run_id}/clusters/{cluster_id}", response_model=ClusterDetail)
def get_cluster(
    run_id: str, cluster_id: int, sample: int = 12, state: AppState = Depends(get_state)
) -> ClusterDetail:
    run = _fetch_run(state, run_id)
    with state.db.cursor() as cur:
        row = cur.execute(
            f"SELECT {_CLUSTER_COLS} FROM clusters WHERE run_id = ? AND cluster_id = ?",
            [run_id, cluster_id],
        ).fetchone()
        if row is None:
            raise HTTPException(404, f"cluster {cluster_id} not found")
        members = [
            r[0]
            for r in cur.execute(
                "SELECT review_id FROM cluster_members WHERE run_id = ? AND cluster_id = ? ORDER BY 1",
                [run_id, cluster_id],
            ).fetchall()
        ]
        hourly = cur.execute(
            "SELECT date_trunc('hour', r.created_at) AS hour, count(*) FROM cluster_members m "
            "JOIN reviews r ON r.dataset_id = ? AND r.id = m.review_id "
            "WHERE m.run_id = ? AND m.cluster_id = ? AND r.created_at IS NOT NULL GROUP BY 1 ORDER BY 1",
            [run.dataset_id, run_id, cluster_id],
        ).fetchall()
        actions = dict(
            cur.execute(
                "SELECT d.action, count(*) FROM cluster_members m JOIN decisions d "
                "ON d.run_id = m.run_id AND d.review_id = m.review_id "
                "WHERE m.run_id = ? AND m.cluster_id = ? GROUP BY 1",
                [run_id, cluster_id],
            ).fetchall()
        )
        rows = cur.execute(
            "SELECT r.id, r.text, r.rating_norm, r.created_at, d.action, d.reasons FROM cluster_members m "
            "JOIN reviews r ON r.dataset_id = ? AND r.id = m.review_id "
            "LEFT JOIN decisions d ON d.run_id = m.run_id AND d.review_id = m.review_id "
            "WHERE m.run_id = ? AND m.cluster_id = ? ORDER BY hash(r.id) LIMIT ?",
            [run.dataset_id, run_id, cluster_id, min(max(sample, 0), 100)],
        ).fetchall()
    base = _cluster_row(row)
    return ClusterDetail(
        **base.model_dump(),
        hourly=[{"hour": h.isoformat(), "count": c} for h, c in hourly],
        actions=actions,
        sample=[
            ClusterReview(
                review_id=i,
                text=t,
                rating_norm=rn,
                created_at=ca,
                action=a,
                reasons=json.loads(rs or "[]"),
            )
            for i, t, rn, ca, a, rs in rows
        ],
        member_ids=members,
    )
