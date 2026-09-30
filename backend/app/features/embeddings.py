"""Sentence embeddings + nearest semantic neighbour (MVP_SPEC §6.2).

Embeddings are the slow part of S1, so they are cached per (dataset, model, max length)
as `.npy` and computed once. The embedder is injectable: tests use a cheap stand-in
instead of downloading MiniLM.
"""

import hashlib
import logging
import re
from functools import lru_cache
from pathlib import Path
from typing import Protocol

import faiss
import numpy as np

log = logging.getLogger("embeddings")


class Embedder(Protocol):
    name: str

    def encode(self, texts: list[str]) -> np.ndarray:
        """L2-normalised float32 matrix, one row per text."""
        ...


class SentenceTransformerEmbedder:
    def __init__(self, model: str, max_seq_len: int, batch_size: int = 64) -> None:
        self.name = f"{model}@{max_seq_len}"
        self.model_name = model
        self.max_seq_len = max_seq_len
        self.batch_size = batch_size

    def encode(self, texts: list[str]) -> np.ndarray:
        model = _load(self.model_name)
        model.max_seq_length = self.max_seq_len
        # Sort by length so batches pad less; restore input order afterwards.
        order = np.argsort([len(t) for t in texts], kind="stable")
        emb = model.encode(
            [texts[i] for i in order],
            batch_size=self.batch_size,
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        ).astype(np.float32)
        out = np.empty_like(emb)
        out[order] = emb
        return out


@lru_cache(maxsize=2)
def _load(model: str):
    from sentence_transformers import SentenceTransformer

    log.info("loading %s on cpu", model)
    return SentenceTransformer(model, device="cpu")


def cache_path(cache_dir: Path, dataset_id: str, embedder_name: str) -> Path:
    slug = re.sub(r"[^\w.-]+", "_", embedder_name)
    return cache_dir / f"{dataset_id}__{slug}.npy"


def embed_cached(
    texts: list[str], embedder: Embedder, cache_dir: Path, dataset_id: str
) -> tuple[np.ndarray, bool]:
    """(embeddings, cache_hit). The cache is keyed on content too, so a changed
    dataset with a reused id is never served stale vectors."""
    path = cache_path(cache_dir, dataset_id, embedder.name)
    digest = hashlib.blake2b("\x00".join(texts).encode(), digest_size=16).hexdigest()
    meta = path.with_suffix(".sha")
    if path.exists() and meta.exists() and meta.read_text() == digest:
        emb = np.load(path)
        if emb.shape[0] == len(texts):
            return emb, True
    emb = embedder.encode(texts)
    path.parent.mkdir(parents=True, exist_ok=True)
    np.save(path, emb)
    meta.write_text(digest)
    return emb, False


def nearest_neighbours(emb: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """For each row: (index of most similar *other* row, its cosine similarity).

    Exact inner-product search on normalised vectors. Rows with an identical twin get
    cosine 1.0 against it, which is correct: exact copies are the nearest neighbours.
    """
    n = emb.shape[0]
    if n < 2:
        return np.full(n, -1), np.zeros(n, dtype=np.float32)
    index = faiss.IndexFlatIP(emb.shape[1])
    index.add(emb)
    sims, idx = index.search(emb, 2)
    # Usually column 0 is the row itself; with exact twins FAISS may order the twin
    # first. Take the best hit that isn't the query row.
    self_first = idx[:, 0] == np.arange(n)
    nn = np.where(self_first, idx[:, 1], idx[:, 0])
    cos = np.where(self_first, sims[:, 1], sims[:, 0])
    return nn.astype(np.int64), np.clip(cos, -1.0, 1.0).astype(np.float32)
