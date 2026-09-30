"""Build the fixed 200-review dev set for question tuning (PLAN Phase 3).

Stratified so that tuning sees every kind of review the product must handle, not just
the common ones. Deterministic given the pulls and --seed. The manifest (review ids +
stratum) is written to data/devsets/ (gitignored: Steam review ids link to people).
Phase 7 must exclude these ids from every final evaluation set.

Usage (from backend/):
    uv run python ../tools/make_devset.py            # build + import as a dataset
"""

import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

import polars as pl

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.core.config import settings
from app.core.db import Database
from app.features.extract import deterministic_features
from app.ingest.steam_fetcher import load_pull
from app.ingest.steam_import import steam_to_reviews
from app.ingest.store import create_dataset, insert_reviews
from app.models import FeatureConfig

HD2 = ("Helldivers 2", "553850_2024-04-01_2024-06-30")
GOLLUM = ("The Lord of the Rings: Gollum", "1265780_2023-05-01_2023-07-31")


def ts(day: str) -> datetime:
    return datetime.fromisoformat(day).replace(tzinfo=UTC)


# (stratum, size, filter). Filled in order, without replacement.
STRATA = [
    ("hd2_short", 15, lambda f: f["n_tokens"] <= 3),
    ("hd2_long", 15, lambda f: f["n_tokens"] >= 150),
    ("hd2_links_or_promo", 10, lambda f: f["has_url"] | (f["promo_hits"] != "[]")),
    (
        "hd2_later_copy",
        10,
        lambda f: (f["dup_of"] >= 0) & (f["dup_of"] != f["id"]) & (f["n_tokens"] >= 8),
    ),
    ("hd2_pre_bomb", 35, lambda f: f["created_at"] < ts("2024-05-03")),
    (
        "hd2_bomb",
        45,
        lambda f: (
            (f["created_at"] >= ts("2024-05-03")) & (f["created_at"] < ts("2024-05-06T12:00:00"))
        ),
    ),
    (
        "hd2_counter_wave",
        35,
        lambda f: (
            (f["created_at"] >= ts("2024-05-06T12:00:00")) & (f["created_at"] < ts("2024-05-11"))
        ),
    ),
    ("hd2_later", 15, lambda f: f["created_at"] >= ts("2024-05-11")),
]
GOLLUM_N = 20


def load(subject: str, pull: str) -> pl.DataFrame:
    raw = load_pull(settings.steam_pulls_dir / pull)
    reviews = steam_to_reviews(raw).with_row_index("id").with_columns(pl.col("id").cast(pl.Int32))
    feats, _ = deterministic_features(reviews, FeatureConfig())
    return reviews.join(feats, left_on="id", right_on="review_id").with_columns(
        pl.lit(subject).alias("subject")
    )


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--seed", type=int, default=2024)
    p.add_argument("--name", default="Dev set v1 (200, tuning only)")
    args = p.parse_args()

    hd2 = load(*HD2).filter(pl.col("text").str.len_chars() > 0)
    picked: list[pl.DataFrame] = []
    taken: set[str] = set()
    for name, size, rule in STRATA:
        pool = hd2.filter(rule(hd2) & ~pl.col("ext_id").is_in(list(taken)))
        if pool.height < size:
            raise SystemExit(f"stratum {name}: only {pool.height} candidates for {size}")
        chosen = pool.sample(size, seed=args.seed).with_columns(pl.lit(name).alias("stratum"))
        taken.update(chosen["ext_id"].to_list())
        picked.append(chosen)
    gollum = load(*GOLLUM).filter(pl.col("text").str.len_chars() > 0)
    picked.append(
        gollum.sample(GOLLUM_N, seed=args.seed).with_columns(
            pl.lit("gollum_control").alias("stratum")
        )
    )
    dev = pl.concat(picked, how="diagonal_relaxed")
    print(dev.group_by("stratum").len().sort("stratum"))
    print(f"total {dev.height}, positive share {dev['rating_norm'].mean():.2f}")

    out_dir = settings.data_dir / "devsets"
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "version": "v1",
        "seed": args.seed,
        "built_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "pulls": {HD2[0]: HD2[1], GOLLUM[0]: GOLLUM[1]},
        "reviews": dev.select("ext_id", "stratum", "subject").to_dicts(),
    }
    (out_dir / "dev_v1.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")

    frame = dev.with_columns(
        meta=pl.struct("subject", "stratum").map_elements(json.dumps, return_dtype=pl.String)
    ).select(
        "ext_id",
        "author_hash",
        "text",
        "rating_raw",
        "rating_norm",
        "created_at",
        "updated_at",
        "lang",
        "meta",
    )
    db = Database(settings.db_path)
    ds = create_dataset(
        db,
        name=args.name,
        source="steam",
        rating_scale="binary",
        source_params={
            "devset": "v1",
            "seed": args.seed,
            "note": "tuning only; never report metrics on it",
        },
    )
    insert_reviews(db, ds, frame)
    print(f"dataset {ds}  manifest {out_dir / 'dev_v1.json'}")


if __name__ == "__main__":
    main()
