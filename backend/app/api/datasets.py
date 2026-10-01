import asyncio
import json
import logging
from datetime import date

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import ValidationError

from app.api.deps import AppState, get_state
from app.ingest import csv_loader
from app.ingest.steam_fetcher import PullState, SteamFetcher, parse_date
from app.ingest.steam_import import import_pull
from app.ingest.store import create_dataset, insert_reviews, set_dataset_status
from app.models import (
    CsvPreview,
    DatasetDetail,
    DatasetOut,
    HourIndex,
    SteamFetchRequest,
    UploadLimits,
)

router = APIRouter(prefix="/datasets", tags=["datasets"])
log = logging.getLogger("datasets")

_COLUMNS = "id, name, source, rating_scale, status, error, n_reviews, created_at, source_params"


def _row_to_dataset(row: tuple) -> DatasetOut:
    fields = dict(zip(_COLUMNS.split(", "), row, strict=True))
    fields["source_params"] = json.loads(fields["source_params"] or "{}")
    return DatasetOut(**fields)


def fetch_dataset(state: AppState, dataset_id: str) -> DatasetOut:
    with state.db.cursor() as cur:
        row = cur.execute(f"SELECT {_COLUMNS} FROM datasets WHERE id = ?", [dataset_id]).fetchone()
    if row is None:
        raise HTTPException(404, f"dataset {dataset_id} not found")
    return _row_to_dataset(row)


def _limits(state: AppState) -> csv_loader.Limits:
    s = state.settings
    return csv_loader.Limits(
        max_rows=s.max_upload_rows, max_expanded_bytes=int(s.max_upload_expanded_mb * 2**20)
    )


async def _read_upload(file: UploadFile, state: AppState) -> bytes:
    """Read at most the cap plus one byte: an oversized file is never held whole."""
    cap = int(state.settings.max_upload_mb * 2**20)
    data = await file.read(cap + 1)
    if len(data) > cap:
        raise HTTPException(
            413, f"file is over the {state.settings.max_upload_mb:g} MB upload limit"
        )
    return data


@router.get("/upload-limits", response_model=UploadLimits)
def upload_limits(state: AppState = Depends(get_state)) -> UploadLimits:
    s = state.settings
    return UploadLimits(max_mb=s.max_upload_mb, max_rows=s.max_upload_rows)


@router.get("", response_model=list[DatasetOut])
def list_datasets(state: AppState = Depends(get_state)) -> list[DatasetOut]:
    with state.db.cursor() as cur:
        rows = cur.execute(f"SELECT {_COLUMNS} FROM datasets ORDER BY created_at DESC").fetchall()
    return [_row_to_dataset(r) for r in rows]


@router.get("/{dataset_id}", response_model=DatasetDetail)
def get_dataset(dataset_id: str, state: AppState = Depends(get_state)) -> DatasetDetail:
    ds = fetch_dataset(state, dataset_id)
    with state.db.cursor() as cur:
        hist = cur.execute(
            "SELECT rating_raw, count(*) FROM reviews WHERE dataset_id = ? AND rating_raw IS NOT NULL "
            "GROUP BY 1 ORDER BY 1",
            [dataset_id],
        ).fetchall()
        timeline = cur.execute(
            "SELECT CAST(date_trunc('day', created_at) AS DATE) AS day, count(*), avg(rating_norm) "
            "FROM reviews WHERE dataset_id = ? AND created_at IS NOT NULL GROUP BY 1 ORDER BY 1",
            [dataset_id],
        ).fetchall()
    return DatasetDetail(
        **ds.model_dump(),
        histogram=[{"rating": r, "count": c} for r, c in hist],
        timeline=[{"day": d.isoformat(), "count": c, "mean_rating": m} for d, c, m in timeline],
    )


@router.get("/{dataset_id}/hours", response_model=HourIndex)
def get_hours(dataset_id: str, state: AppState = Depends(get_state)) -> HourIndex:
    """Hourly buckets in grid order, for the live timeline strip."""
    fetch_dataset(state, dataset_id)
    with state.db.cursor() as cur:
        rows = cur.execute(
            "SELECT date_trunc('hour', created_at) AS hour, min(id), count(*) FROM reviews "
            "WHERE dataset_id = ? GROUP BY 1 ORDER BY 2",
            [dataset_id],
        ).fetchall()
    return HourIndex(
        hours=[h.isoformat() if h is not None else None for h, _, _ in rows],
        starts=[s for _, s, _ in rows],
        counts=[c for _, _, c in rows],
    )


@router.post("/csv/preview", response_model=CsvPreview)
async def preview_csv(
    file: UploadFile = File(...), state: AppState = Depends(get_state)
) -> CsvPreview:
    data = await _read_upload(file, state)
    try:
        return CsvPreview(**csv_loader.preview(data, _limits(state)))
    except csv_loader.UploadTooLarge as exc:
        raise HTTPException(413, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(422, f"could not read the file (CSV or XLSX): {exc}") from exc


@router.post("/csv", response_model=DatasetOut, status_code=201)
async def upload_csv(
    file: UploadFile = File(...),
    name: str = Form(...),
    mapping: str = Form(..., description="JSON ColumnMapping"),
    rating_scale: str | None = Form(None),
    state: AppState = Depends(get_state),
) -> DatasetOut:
    try:
        cols = csv_loader.ColumnMapping.model_validate_json(mapping)
    except ValidationError as exc:
        raise HTTPException(422, f"bad mapping: {exc}") from exc
    if rating_scale not in (None, "binary", "1-5", "1-10"):
        raise HTTPException(422, "rating_scale must be binary, 1-5 or 1-10")
    data = await _read_upload(file, state)
    try:
        df, scale = await asyncio.to_thread(
            csv_loader.load,
            data,
            cols,
            state.settings.author_hash_salt,
            rating_scale,
            _limits(state),
        )
    except csv_loader.UploadTooLarge as exc:
        raise HTTPException(413, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    dataset_id = create_dataset(
        state.db,
        name=name,
        source="csv",
        rating_scale=scale,
        source_params={"filename": file.filename, "mapping": cols.model_dump()},
    )
    await asyncio.to_thread(insert_reviews, state.db, dataset_id, df)
    return fetch_dataset(state, dataset_id)


@router.post("/steam", response_model=DatasetOut, status_code=202)
async def fetch_steam(req: SteamFetchRequest, state: AppState = Depends(get_state)) -> DatasetOut:
    try:
        from_ts, to_ts = parse_date(req.from_), parse_date(req.to, end_of_day=True)
    except ValueError as exc:
        raise HTTPException(422, f"bad date: {exc}") from exc
    if from_ts > to_ts or date.fromisoformat(req.from_) > date.today():
        raise HTTPException(422, "'from' must be on or before 'to' and not in the future")
    pull_dir = state.settings.steam_pulls_dir / f"{req.appid}_{req.from_}_{req.to}"
    name = req.name or f"Steam {req.appid}, {req.from_} to {req.to}"
    dataset_id = create_dataset(
        state.db,
        name=name,
        source="steam",
        rating_scale="binary",
        source_params=req.model_dump(by_alias=True),
        status="fetching",
    )

    def job() -> None:
        pull = PullState(appid=req.appid, from_ts=from_ts, to_ts=to_ts, language=req.language)
        SteamFetcher.resume_or_new(pull, pull_dir, state.settings.author_hash_salt).run()
        import_pull(
            state.db,
            pull_dir,
            name=name,
            subject=req.subject or name,
            sample_n=req.sample_n,
            dataset_id=dataset_id,
            create=False,
        )

    async def run_job() -> None:
        try:
            await asyncio.to_thread(job)
            set_dataset_status(state.db, dataset_id, "ready")
        except BaseException as exc:
            log.exception("steam fetch for %s failed", dataset_id)
            set_dataset_status(state.db, dataset_id, "failed", str(exc))

    task = asyncio.create_task(run_job())
    state.tasks.add(task)
    task.add_done_callback(state.tasks.discard)
    return fetch_dataset(state, dataset_id)
