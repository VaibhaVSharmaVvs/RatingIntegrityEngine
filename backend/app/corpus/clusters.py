"""Semantic and duplicate clusters, with c-TF-IDF top phrases (MVP_SPEC §6.4).

- Semantic: UMAP (cosine, 10-D) then HDBSCAN. The reduction is cached next to the
  embeddings; a fixed seed makes it reproducible (single-threaded, slower: accuracy
  and reproducibility over speed).
- Duplicate: S1's near-duplicate groups of size >= `dup_min_size`.
- Top phrases: class-based TF-IDF (as in BERTopic): term frequency within the
  cluster's concatenated text, weighted by log(1 + mean words per cluster / term
  frequency across clusters), so phrases common everywhere ("game") sink.
"""

import hashlib
import logging
import time
from pathlib import Path

import numpy as np
import polars as pl
from sklearn.cluster import HDBSCAN
from sklearn.feature_extraction.text import CountVectorizer

from app.models import ClusterConfig

log = logging.getLogger("clusters")


def _reduction_path(cache_dir: Path, dataset_id: str, emb: np.ndarray, cfg: ClusterConfig) -> Path:
    digest = hashlib.blake2b(emb.tobytes(), digest_size=8).hexdigest()
    key = f"{cfg.umap_neighbors}-{cfg.umap_components}-{cfg.umap_min_dist}-{cfg.seed}"
    return cache_dir / f"{dataset_id}__umap_{key}_{digest}.npy"


def reduce(
    emb: np.ndarray, cfg: ClusterConfig, cache_dir: Path, dataset_id: str
) -> tuple[np.ndarray, bool]:
    path = _reduction_path(cache_dir, dataset_id, emb, cfg)
    if path.exists():
        return np.load(path), True
    import umap  # slow import (numba); only when needed

    reducer = umap.UMAP(
        n_neighbors=cfg.umap_neighbors,
        n_components=cfg.umap_components,
        min_dist=cfg.umap_min_dist,
        metric="cosine",
        random_state=cfg.seed,
        unique=True,  # identical texts (e.g. 997 x "Just doing my part") map to one point
    )
    low = reducer.fit_transform(emb).astype(np.float32)
    path.parent.mkdir(parents=True, exist_ok=True)
    np.save(path, low)
    return low, False


def semantic_labels(low: np.ndarray, cfg: ClusterConfig) -> np.ndarray:
    """HDBSCAN labels per review; -1 = noise (in no semantic cluster)."""
    if low.shape[0] < cfg.hdbscan_min_cluster_size * 2:
        return np.full(low.shape[0], -1)
    model = HDBSCAN(
        min_cluster_size=cfg.hdbscan_min_cluster_size,
        min_samples=cfg.hdbscan_min_samples,
        copy=True,
    )
    return model.fit_predict(low)


def semantic_clusters(
    emb: np.ndarray, cfg: ClusterConfig, cache_dir: Path, dataset_id: str
) -> tuple[list[np.ndarray], dict[str, float]]:
    """Member index arrays per semantic cluster, plus timings."""
    t = time.perf_counter()
    if emb.shape[0] < cfg.umap_min_reviews:
        low, hit = emb, False  # small corpus: cluster the embeddings directly
    else:
        low, hit = reduce(emb, cfg, cache_dir, dataset_id)
    t_umap = time.perf_counter() - t
    t = time.perf_counter()
    labels = semantic_labels(low, cfg)
    t_hdb = time.perf_counter() - t
    groups = (
        [np.flatnonzero(labels == k) for k in range(labels.max() + 1)] if labels.max() >= 0 else []
    )
    return groups, {
        "umap": round(t_umap, 2),
        "umap_cache_hit": float(hit),
        "hdbscan": round(t_hdb, 2),
    }


def duplicate_clusters(features: pl.DataFrame, cfg: ClusterConfig) -> list[np.ndarray]:
    groups = (
        features.filter(pl.col("dup_group_id") >= 0)
        .group_by("dup_group_id")
        .agg(pl.col("review_id"))
        .filter(pl.col("review_id").list.len() >= cfg.dup_min_size)
        .sort("dup_group_id")
    )
    return [np.asarray(ids) for ids in groups["review_id"].to_list()]


def top_phrases(texts: list[str], clusters: list[np.ndarray], k: int) -> list[list[str]]:
    """c-TF-IDF: the k most characteristic 1-2-grams of each cluster."""
    if not clusters:
        return []
    docs = [" ".join(texts[i] for i in members) for members in clusters]
    try:
        vec = CountVectorizer(
            ngram_range=(1, 2), stop_words="english", min_df=1, max_features=50_000
        )
        tf = vec.fit_transform(docs).astype(np.float64)
    except ValueError:  # only stop words
        return [[] for _ in clusters]
    words_per_class = np.asarray(tf.sum(axis=1)).ravel()
    term_freq = np.asarray(tf.sum(axis=0)).ravel()
    idf = np.log1p(words_per_class.mean() / np.maximum(term_freq, 1))
    tf = tf.multiply(1 / np.maximum(words_per_class, 1)[:, None]).tocsr()
    scores = tf.multiply(idf).tocsr()
    vocab = np.asarray(vec.get_feature_names_out())
    out = []
    for row in range(scores.shape[0]):
        r = scores.getrow(row)
        order = np.argsort(-r.data)[:k]
        out.append(vocab[r.indices[order]].tolist())
    return out
