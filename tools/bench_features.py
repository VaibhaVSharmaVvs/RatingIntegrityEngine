"""Phase 2 exit criteria: time S1 on real reviews, cold and warm (MEASUREMENTS M5).

Reads the parquet parts of a Steam pull (a pull still in progress works too), runs the
real S1 code on up to --n reviews, and prints timings and feature counts. The cold run
uses an empty scratch cache; the warm run reuses it.

Usage (from backend/):
    uv run python ../tools/bench_features.py --pull 553850_2024-04-01_2024-06-30 --n 50000
"""

import argparse
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.core.config import settings
from app.features.embeddings import SentenceTransformerEmbedder
from app.features.extract import deterministic_features, feature_counts, semantic_features
from app.ingest.steam_fetcher import load_pull
from app.ingest.steam_import import steam_to_reviews
from app.models import FeatureConfig


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--pull", required=True)
    p.add_argument("--n", type=int, default=50_000)
    p.add_argument("--skip-embeddings", action="store_true")
    p.add_argument("--cache-dir", type=Path, default=None, help="persist the cache (default: temp)")
    args = p.parse_args()

    raw = load_pull(settings.steam_pulls_dir / args.pull).head(args.n)
    t = time.perf_counter()
    reviews = steam_to_reviews(raw).with_row_index("id")
    print(
        f"normalise (clean_text, PII scrub): {time.perf_counter() - t:.1f}s for {reviews.height} reviews"
    )
    cfg = FeatureConfig()

    frame, timings = deterministic_features(reviews, cfg)
    print(f"deterministic: {timings}  total {sum(timings.values()):.1f}s")
    for k, v in feature_counts(frame, cfg).items():
        print(f"  {k:<24} {v}")

    if args.skip_embeddings:
        return
    texts = reviews["text"].fill_null("").to_list()
    embedder = SentenceTransformerEmbedder(cfg.embedding_model, cfg.embedding_max_seq_len)
    with tempfile.TemporaryDirectory() as tmp:
        cache = args.cache_dir or Path(tmp)
        for label in ("first", "second"):
            t = time.perf_counter()
            sem = semantic_features(texts, embedder, cache, "bench")
            total = time.perf_counter() - t
            print(
                f"semantic {label}: {sem.timings_s}  total {total:.1f}s  "
                f"({len(texts) / sem.timings_s['embeddings']:.0f} reviews/s embedding)  cache_hit={sem.cache_hit}"
            )
    near = (sem.nn_cosine_max >= 0.95).sum()
    print(f"  reviews with a semantic neighbour at cosine >= 0.95: {near}")


if __name__ == "__main__":
    main()
