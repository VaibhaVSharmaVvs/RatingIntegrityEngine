"""CSV / XLSX upload with an explicit column mapping (MVP_SPEC §6.1).

An Excel workbook is read from its first sheet, header row first. The format is
detected from the bytes (XLSX is a zip archive), not from the file name.
"""

import io
import json
import zipfile
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


_ZIP = b"PK"
_CHUNK = 1 << 20


class UploadTooLarge(ValueError):
    """The file is over a size, decompressed-size or row cap (HTTP 413)."""


class Limits(BaseModel):
    max_rows: int | None = None
    max_expanded_bytes: int | None = None


def is_xlsx(data: bytes) -> bool:
    return data[:4] == _ZIP


def _check_expanded(data: bytes, cap: int) -> None:
    """Decompress every workbook part in chunks and stop at `cap` bytes. The sizes an
    archive declares can be forged, so they are not trusted."""
    total = 0
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            for info in zf.infolist():
                with zf.open(info) as part:
                    while chunk := part.read(_CHUNK):
                        total += len(chunk)
                        if total > cap:
                            raise UploadTooLarge(
                                f"the workbook expands to more than {cap // 2**20} MB when opened"
                            )
    except zipfile.BadZipFile as exc:
        raise ValueError(f"not a valid XLSX workbook: {exc}") from exc


def read_table(data: bytes, limits: Limits | None = None) -> pl.DataFrame:
    """CSV, or the first sheet of an XLSX workbook, within the upload caps."""
    limits = limits or Limits()
    if is_xlsx(data):
        if limits.max_expanded_bytes:
            _check_expanded(data, limits.max_expanded_bytes)
        df = pl.read_excel(io.BytesIO(data), sheet_id=1, infer_schema_length=10_000)
    else:
        # one row past the cap is enough to know it is over
        n = limits.max_rows + 1 if limits.max_rows else None
        df = pl.read_csv(
            io.BytesIO(data), infer_schema_length=10_000, try_parse_dates=False, n_rows=n
        )
    if limits.max_rows and df.height > limits.max_rows:
        raise UploadTooLarge(f"over the {limits.max_rows:,}-row upload limit")
    return df


def preview(data: bytes, limits: Limits | None = None) -> dict[str, Any]:
    df = read_table(data, limits)
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
    if col.dtype == pl.Date:  # an Excel date cell
        col = col.cast(pl.Datetime("us"))
    if isinstance(col.dtype, pl.Datetime):  # an Excel date-time cell (ms); naive means UTC
        col = col.dt.cast_time_unit("us")
        if col.dtype.time_zone is None:
            return col.dt.replace_time_zone("UTC")
        return col.dt.convert_time_zone("UTC")
    if col.dtype.is_numeric():
        return pl.from_epoch(col.cast(pl.Int64), time_unit="s").dt.replace_time_zone("UTC")
    parsed = col.cast(pl.String).str.to_datetime(strict=False, time_zone="UTC")
    if parsed.null_count() > col.null_count():
        bad = col.filter(parsed.is_null() & col.is_not_null()).head(3).to_list()
        raise ValueError(f"unparseable timestamps, e.g. {bad}")
    return parsed


def load(
    data: bytes,
    mapping: ColumnMapping,
    salt: str,
    rating_scale: RatingScale | None = None,
    limits: Limits | None = None,
) -> tuple[pl.DataFrame, RatingScale]:
    df = read_table(data, limits)
    used = [mapping.text, mapping.rating, mapping.timestamp, mapping.author, mapping.ext_id]
    missing = [c for c in [*used, *mapping.extras] if c and c not in df.columns]
    if missing:
        raise ValueError(f"columns not in the file: {missing}")

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
