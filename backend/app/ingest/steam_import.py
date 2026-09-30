"""Turn a completed Steam pull (Parquet parts) into a dataset.

Sampling is stratified by UTC day with proportional allocation, so the shape of the
timeline (the bomb burst) survives down-sampling. Uniform-per-day sampling would
flatten exactly the signal the demo is about.

Usage (from backend/):
    uv run python -m app.ingest.steam_import --pull 553850_2024-04-01_2024-06-30 \\
        --name "Helldivers 2, Apr-Jun 2024" --sample 50000
"""

import argparse
import json
from pathlib import Path

import polars as pl

from app.core.config import settings
from app.core.db import Database
from app.ingest.normalize import STEAM_LANGUAGES, clean_text
from app.ingest.steam_fetcher import load_pull
from app.ingest.store import create_dataset, insert_reviews

META_FIELDS = [
    "votes_up",
    "votes_funny",
    "weighted_vote_score",
    "comment_count",
    "steam_purchase",
    "received_for_free",
    "refunded",
    "written_during_early_access",
    "primarily_steam_deck",
    "author_num_games_owned",
    "author_num_reviews",
    "author_playtime_forever",
    "author_playtime_at_review",
]


def stratified_sample(df: pl.DataFrame, n: int, seed: int = 7) -> pl.DataFrame:
    """Proportional per-day sample of about `n` rows (exact when n >= len(df))."""
    if n >= df.height:
        return df
    frac = n / df.height
    day = pl.from_epoch("timestamp_created", time_unit="s").dt.date()
    return (
        df.with_columns(_day=day, _r=pl.int_range(pl.len()).shuffle(seed=seed).over(day))
        .filter(pl.col("_r") < (pl.len().over("_day") * frac).round().cast(pl.Int64))
        .drop("_day", "_r")
    )


def steam_to_reviews(df: pl.DataFrame) -> pl.DataFrame:
    """Map fetcher records onto the `reviews` table columns."""
    meta = df.select(pl.struct(META_FIELDS).alias("m"))["m"].to_list()
    return df.select(
        pl.col("ext_id"),
        pl.col("author_hash"),
        pl.col("text").map_elements(clean_text, return_dtype=pl.String),
        pl.col("voted_up").cast(pl.Float64).alias("rating_raw"),
        pl.col("voted_up").cast(pl.Float64).alias("rating_norm"),
        pl.from_epoch("timestamp_created", time_unit="s")
        .dt.replace_time_zone("UTC")
        .alias("created_at"),
        pl.from_epoch("timestamp_updated", time_unit="s")
        .dt.replace_time_zone("UTC")
        .alias("updated_at"),
        pl.col("language").replace_strict(STEAM_LANGUAGES, default=None).alias("lang"),
    ).with_columns(pl.Series("meta", [json.dumps(m) for m in meta], dtype=pl.String))


def import_pull(
    db: Database,
    pull_dir: Path,
    *,
    name: str,
    sample_n: int | None = None,
    dataset_id: str | None = None,
    create: bool = True,
) -> str:
    state = json.loads((pull_dir / "state.json").read_text())
    raw = load_pull(pull_dir)
    if sample_n:
        raw = stratified_sample(raw, sample_n)
    params = {
        "appid": state["appid"],
        "from_ts": state["from_ts"],
        "to_ts": state["to_ts"],
        "language": state["language"],
        "pull_dir": pull_dir.name,
        "sample_n": sample_n,
        "pulled_in_window": state["stored"],
    }
    if create:
        dataset_id = create_dataset(
            db, name=name, source="steam", rating_scale="binary", source_params=params
        )
    assert dataset_id is not None
    insert_reviews(db, dataset_id, steam_to_reviews(raw))
    return dataset_id


def main() -> None:
    p = argparse.ArgumentParser(description="Import a Steam pull as a dataset")
    p.add_argument("--pull", required=True, help="directory name under data/raw/steam")
    p.add_argument("--name", required=True)
    p.add_argument("--sample", type=int, default=None)
    args = p.parse_args()
    db = Database(settings.db_path)
    dataset_id = import_pull(
        db, settings.steam_pulls_dir / args.pull, name=args.name, sample_n=args.sample
    )
    print(dataset_id)


if __name__ == "__main__":
    main()
