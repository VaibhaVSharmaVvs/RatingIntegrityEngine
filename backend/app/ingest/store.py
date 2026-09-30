"""Write a normalised review frame into DuckDB as a dataset."""

import json
import uuid
from typing import Any

import polars as pl

from app.core.db import Database
from app.ingest.normalize import RatingScale

REVIEW_COLUMNS = {
    "ext_id": pl.String,
    "author_hash": pl.String,
    "text": pl.String,
    "rating_raw": pl.Float64,
    "rating_norm": pl.Float64,
    "created_at": pl.Datetime("us", "UTC"),
    "updated_at": pl.Datetime("us", "UTC"),
    "lang": pl.String,
    "meta": pl.String,  # JSON text
}


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def create_dataset(
    db: Database,
    *,
    name: str,
    source: str,
    rating_scale: RatingScale,
    source_params: dict[str, Any] | None = None,
    status: str = "ready",
    dataset_id: str | None = None,
) -> str:
    dataset_id = dataset_id or new_id("ds")
    with db.cursor() as cur:
        cur.execute(
            "INSERT INTO datasets (id, name, source, source_params, rating_scale, status) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            [dataset_id, name, source, json.dumps(source_params or {}), rating_scale, status],
        )
    return dataset_id


def set_dataset_status(
    db: Database, dataset_id: str, status: str, error: str | None = None
) -> None:
    with db.cursor() as cur:
        cur.execute(
            "UPDATE datasets SET status = ?, error = ? WHERE id = ?", [status, error, dataset_id]
        )


def insert_reviews(db: Database, dataset_id: str, df: pl.DataFrame) -> int:
    """Insert reviews ordered by creation time; `id` becomes the grid index."""
    missing = {"text", "rating_norm"} - set(df.columns)
    if missing:
        raise ValueError(f"review frame missing columns: {sorted(missing)}")
    for col, dtype in REVIEW_COLUMNS.items():
        if col not in df.columns:
            df = df.with_columns(pl.lit(None, dtype=dtype).alias(col))
    frame = (
        df.select(pl.col(c).cast(t) for c, t in REVIEW_COLUMNS.items())
        .sort("created_at", "ext_id", nulls_last=True)
        .with_row_index("id")
        .with_columns(pl.col("id").cast(pl.Int32), pl.lit(dataset_id).alias("dataset_id"))
    )
    arrow = frame.to_arrow()  # noqa: F841 (referenced by name in SQL below)
    with db.cursor() as cur:
        cur.execute("BEGIN")
        cur.execute(
            "INSERT INTO reviews (dataset_id, id, ext_id, author_hash, text, rating_raw, "
            "rating_norm, created_at, updated_at, lang, meta) "
            "SELECT dataset_id, id, ext_id, author_hash, text, rating_raw, rating_norm, "
            "created_at, updated_at, lang, meta FROM arrow"
        )
        cur.execute(
            "UPDATE datasets SET n_reviews = (SELECT count(*) FROM reviews WHERE dataset_id = ?) "
            "WHERE id = ?",
            [dataset_id, dataset_id],
        )
        cur.execute("COMMIT")
    return frame.height
