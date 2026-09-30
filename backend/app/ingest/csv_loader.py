"""CSV upload with an explicit column mapping (MVP_SPEC §6.1)."""

import io
import json
from typing import Any

import polars as pl
from pydantic import BaseModel

from app.ingest.normalize import (
    RatingScale,
    clean_text,
    detect_language,
    detect_rating_scale,
    hash_author,
    normalize_rating,
)

PREVIEW_ROWS = 10


class ColumnMapping(BaseModel):
    text: str
    rating: str
    timestamp: str | None = None
    author: str | None = None
    ext_id: str | None = None
    extras: list[str] = []


def read_csv(data: bytes) -> pl.DataFrame:
    return pl.read_csv(io.BytesIO(data), infer_schema_length=10_000, try_parse_dates=False)


def preview(data: bytes) -> dict[str, Any]:
    df = read_csv(data)
    guesses: dict[str, str] = {}
    for col in df.columns:
        try:
            guesses[col] = detect_rating_scale(df[col])
        except (ValueError, pl.exceptions.InvalidOperationError):
            continue
    return {
        "columns": df.columns,
        "n_rows": df.height,
        "rows": df.head(PREVIEW_ROWS).to_dicts(),
        "rating_scale_guesses": guesses,
    }


def _parse_timestamp(col: pl.Series) -> pl.Series:
    if col.dtype.is_numeric():
        return pl.from_epoch(col.cast(pl.Int64), time_unit="s").dt.replace_time_zone("UTC")
    parsed = col.cast(pl.String).str.to_datetime(strict=False, time_zone="UTC")
    if parsed.null_count() > col.null_count():
        bad = col.filter(parsed.is_null() & col.is_not_null()).head(3).to_list()
        raise ValueError(f"unparseable timestamps, e.g. {bad}")
    return parsed


def load(
    data: bytes, mapping: ColumnMapping, salt: str, rating_scale: RatingScale | None = None
) -> tuple[pl.DataFrame, RatingScale]:
    df = read_csv(data)
    used = [mapping.text, mapping.rating, mapping.timestamp, mapping.author, mapping.ext_id]
    missing = [c for c in [*used, *mapping.extras] if c and c not in df.columns]
    if missing:
        raise ValueError(f"columns not in CSV: {missing}")

    scale = rating_scale or detect_rating_scale(df[mapping.rating])
    texts = [clean_text(t) for t in df[mapping.text].cast(pl.String).to_list()]
    out = pl.DataFrame(
        {
            "text": texts,
            "rating_raw": df[mapping.rating].cast(pl.Float64),
            "rating_norm": normalize_rating(df[mapping.rating], scale),
            "lang": [detect_language(t) for t in texts],
        }
    )
    if mapping.timestamp:
        out = out.with_columns(created_at=_parse_timestamp(df[mapping.timestamp]))
    if mapping.author:
        authors = df[mapping.author].cast(pl.String).to_list()
        out = out.with_columns(
            author_hash=pl.Series([hash_author(a, salt) if a else None for a in authors])
        )
    if mapping.ext_id:
        out = out.with_columns(ext_id=df[mapping.ext_id].cast(pl.String))
    if mapping.extras:
        out = out.with_columns(
            meta=pl.Series(
                [json.dumps(r, default=str) for r in df.select(mapping.extras).to_dicts()]
            )
        )
    return out, scale
