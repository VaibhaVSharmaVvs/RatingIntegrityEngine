"""S1 entry points, with stage timings.

S1 is split in two because the parts differ in cost by two orders of magnitude on CPU
(MEASUREMENTS M5):
- `deterministic_features`: heuristics + duplicates. Seconds for 50K. Runs before S2
  so its EXCLUDEs fill the grid immediately and skip System One entirely.
- `semantic_features`: embeddings + nearest neighbour. Minutes for 50K cold. The
  pipeline overlaps it with S2 (network-bound on Jev) and waits for it in S3.
"""

import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import polars as pl

from app.features.embeddings import Embedder, cache_path, embed_cached, nearest_neighbours
from app.features.heuristics import account_features, text_features
from app.features.minhash import duplicate_groups
from app.models import FeatureConfig

_INT_COLS = ("exact_group_id", "dup_group_id", "dup_of")


@dataclass
class SemanticResult:
    embeddings: np.ndarray
    nn_review_id: np.ndarray
    nn_cosine_max: np.ndarray
    cache_hit: bool
    timings_s: dict[str, float] = field(default_factory=dict)


def deterministic_features(
    reviews: pl.DataFrame, cfg: FeatureConfig
) -> tuple[pl.DataFrame, dict[str, float]]:
    """`reviews` needs `id`, `text`, `meta`, sorted by `id` (0..n-1)."""
    timings: dict[str, float] = {}
    t = time.perf_counter()
    text = text_features(reviews["text"])
    account = account_features(reviews["meta"], cfg)
    timings["heuristics"] = time.perf_counter() - t

    t = time.perf_counter()
    dups = duplicate_groups(reviews["text"].fill_null("").to_list(), cfg)
    timings["minhash"] = time.perf_counter() - t

    frame = pl.concat(
        [
            pl.DataFrame({"review_id": reviews["id"].cast(pl.Int32)}),
            text,
            account,
            pl.DataFrame({k: dups[k] for k in (*_INT_COLS, "dup_score")}).cast(
                {c: pl.Int32 for c in _INT_COLS}
            ),
        ],
        how="horizontal_extend",
    )
    return frame, {k: round(v, 3) for k, v in timings.items()}


def semantic_features(
    texts: list[str], embedder: Embedder, cache_dir: Path, dataset_id: str
) -> SemanticResult:
    timings: dict[str, float] = {}
    t = time.perf_counter()
    emb, hit = embed_cached(texts, embedder, cache_dir, dataset_id)
    timings["embeddings"] = time.perf_counter() - t
    t = time.perf_counter()
    # kNN is a pure function of the embeddings, so it is cached next to them and is
    # only valid when the embeddings themselves came from the cache.
    nn_path = cache_path(cache_dir, dataset_id, embedder.name).with_suffix(".nn.npz")
    if hit and nn_path.exists():
        cached = np.load(nn_path)
        nn_idx, nn_cos = cached["idx"], cached["cos"]
    else:
        nn_idx, nn_cos = nearest_neighbours(emb)
        np.savez(nn_path, idx=nn_idx, cos=nn_cos)
    timings["knn"] = time.perf_counter() - t
    return SemanticResult(
        emb, nn_idx, np.round(nn_cos, 4), hit, {k: round(v, 3) for k, v in timings.items()}
    )


def feature_counts(frame: pl.DataFrame, cfg: FeatureConfig) -> dict[str, int]:
    later_dup = (frame["dup_of"] >= 0) & (frame["dup_of"] != frame["review_id"])
    return {
        "reviews": frame.height,
        "with_url": int(frame["has_url"].sum()),
        "promo": int(frame["has_promo"].sum()),
        "low_info": int((frame["n_tokens"] <= cfg.low_info_max_tokens).sum()),
        "exact_dup_reviews": int((frame["exact_group_id"] >= 0).sum()),
        "near_dup_reviews": int((frame["dup_group_id"] >= 0).sum()),
        "dup_groups": int(frame.filter(pl.col("dup_group_id") >= 0)["dup_group_id"].n_unique()),
        "excludable_dups": int((later_dup & (frame["n_tokens"] >= cfg.dup_min_tokens)).sum()),
        "low_playtime": int(frame["low_playtime"].fill_null(False).sum()),
        "single_review_account": int(frame["single_review_account"].fill_null(False).sum()),
    }
