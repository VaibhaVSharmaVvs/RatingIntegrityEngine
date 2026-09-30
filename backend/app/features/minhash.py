"""Exact and near-duplicate groups (MVP_SPEC §6.2): normalised hash + MinHash LSH.

Exact duplicates are collapsed to one representative *before* LSH. A template flood
of thousands of identical reviews would otherwise put thousands of items in one LSH
bucket and make candidate verification quadratic.

Candidates come from LSH at a looser bar than the near-dup threshold and are then
verified with the exact Jaccard of their shingle-hash sets, so precision does not
depend on MinHash estimation noise.

The hot path is NumPy, not datasketch's per-shingle Python hashing. That cost 6.1M
SHA-1 calls (~10 s) on 50K real reviews and swung 17-39 s with laptop throttling
(MEASUREMENTS M5c). datasketch still supplies the optimal band/row split for the
Jaccard threshold.
"""

import hashlib
import re
import zlib
from functools import lru_cache

import numpy as np
from datasketch import MinHashLSH

from app.models import FeatureConfig

_PUNCT = re.compile(r"[^\w\s]")
_WS = re.compile(r"\s+")
_U64 = np.uint64
# Buckets bigger than this are verified as a star (each member vs the first) instead of
# all pairs. Union-find keeps groups connected; only the per-pair scores get coarser.
_ALL_PAIRS_MAX_BUCKET = 64


def normalise(text: str) -> str:
    return _WS.sub(" ", _PUNCT.sub(" ", text.lower())).strip()


def _mix64(x: np.ndarray) -> np.ndarray:
    """splitmix64 finaliser: spreads packed shingle bytes over all 64 bits."""
    x = x ^ (x >> _U64(30))
    x = x * _U64(0xBF58476D1CE4E5B9)
    x = x ^ (x >> _U64(27))
    x = x * _U64(0x94D049BB133111EB)
    return x ^ (x >> _U64(31))


def shingle_hashes(text: str, k: int, unit: str = "char") -> np.ndarray:
    """Distinct uint32 hashes of the k-shingles of already-normalised text.

    Char shingles are UTF-8 byte k-grams (identical to character k-grams for English),
    packed and mixed in one vectorised pass. Texts shorter than k are one shingle.
    """
    if unit == "char" and k <= 8:
        data = np.frombuffer(text.encode(), dtype=np.uint8)
        if data.size <= k:
            return np.array([zlib.crc32(text.encode())], dtype=np.uint32)
        windows = np.lib.stride_tricks.sliding_window_view(data, k).astype(_U64)
        packed = (windows << (_U64(8) * np.arange(k, dtype=_U64))).sum(axis=1, dtype=_U64)
        with np.errstate(over="ignore"):
            return np.unique((_mix64(packed) & _U64(0xFFFFFFFF)).astype(np.uint32))
    tokens: str | list[str] = text if unit == "char" else text.split()
    join = "" if unit == "char" else " "
    if len(tokens) <= k:
        return np.array([zlib.crc32(join.join(tokens).encode())], dtype=np.uint32)
    grams = {join.join(tokens[i : i + k]) for i in range(len(tokens) - k + 1)}
    return np.fromiter((zlib.crc32(g.encode()) for g in grams), dtype=np.uint32)


@lru_cache(maxsize=4)
def _permutations(num_perm: int, seed: int = 1) -> tuple[np.ndarray, np.ndarray]:
    """Affine maps h -> a*h + b (mod 2^32) with odd a: bijections on uint32."""
    rng = np.random.default_rng(seed)
    a = (rng.integers(0, 1 << 31, num_perm, dtype=np.uint64) * 2 + 1).astype(np.uint32)
    b = rng.integers(0, 1 << 32, num_perm, dtype=np.uint64).astype(np.uint32)
    return a, b


def signature(hashes: np.ndarray, num_perm: int) -> np.ndarray:
    a, b = _permutations(num_perm)
    with np.errstate(over="ignore"):
        return (hashes[:, None] * a + b).min(axis=0)  # uint32 arithmetic wraps mod 2^32


@lru_cache(maxsize=8)
def lsh_params(threshold: float, num_perm: int) -> tuple[int, int]:
    """(bands, rows) minimising false positive + negative mass at the threshold."""
    lsh = MinHashLSH(threshold=threshold, num_perm=num_perm)
    return lsh.b, lsh.r


def exact_jaccard(a: np.ndarray, b: np.ndarray) -> float:
    """Jaccard of two sorted, distinct uint32 hash arrays."""
    inter = np.intersect1d(a, b, assume_unique=True).size
    return inter / (a.size + b.size - inter)


def candidate_pairs(sigs: np.ndarray, bands: int, rows: int) -> np.ndarray:
    """Row-index pairs (i < j) sharing at least one LSH band."""
    pairs = []
    for band in range(bands):
        keys = np.ascontiguousarray(sigs[:, band * rows : (band + 1) * rows])
        view = keys.view(np.dtype((np.void, keys.dtype.itemsize * rows))).ravel()
        _, inverse, counts = np.unique(view, return_inverse=True, return_counts=True)
        shared = np.flatnonzero(counts[inverse] > 1)
        if shared.size == 0:
            continue
        order = shared[np.argsort(inverse[shared], kind="stable")]
        bucket_ids = inverse[order]
        starts = np.flatnonzero(np.r_[True, bucket_ids[1:] != bucket_ids[:-1]])
        ends = np.r_[starts[1:], order.size]
        for s, e in zip(starts, ends, strict=True):
            members = order[s:e]
            if members.size <= _ALL_PAIRS_MAX_BUCKET:
                ii, jj = np.triu_indices(members.size, k=1)
                pairs.append(np.stack([members[ii], members[jj]], axis=1))
            else:
                pairs.append(np.stack([np.full(members.size - 1, members[0]), members[1:]], axis=1))
    if not pairs:
        return np.empty((0, 2), dtype=np.int64)
    return np.unique(np.sort(np.concatenate(pairs), axis=1), axis=0)


class _UnionFind:
    def __init__(self, n: int) -> None:
        self.parent = list(range(n))

    def find(self, x: int) -> int:
        root = x
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[x] != root:
            self.parent[x], x = root, self.parent[x]
        return root

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[max(ra, rb)] = min(ra, rb)  # root = earliest review


def duplicate_groups(texts: list[str], cfg: FeatureConfig) -> dict[str, np.ndarray]:
    """Per review (in input order, which is chronological):

    exact_group_id, dup_group_id: group ids (-1 = no group); ids are the group's
        earliest review index, so "keep the first" is `dup_of == own index`.
    dup_of: earliest review in the near-dup group (-1 = none).
    dup_score: best estimated Jaccard to another group member (0 if none).
    """
    n = len(texts)
    norm = [normalise(t) for t in texts]

    # Exact groups by normalised text.
    first_seen: dict[bytes, int] = {}
    rep = np.fromiter(
        (
            first_seen.setdefault(hashlib.blake2b(key.encode(), digest_size=16).digest(), i)
            for i, key in enumerate(norm)
        ),
        dtype=np.int64,
        count=n,
    )
    exact_size = np.bincount(rep, minlength=n)
    exact_group = np.where(exact_size[rep] > 1, rep, -1)
    dup_score = np.where(exact_group >= 0, 1.0, 0.0)

    uf = _UnionFind(n)
    for i in np.flatnonzero(rep != np.arange(n)).tolist():
        uf.union(i, int(rep[i]))

    # Near-dup LSH over one representative per exact group.
    reps = np.flatnonzero(rep == np.arange(n))
    if reps.size > 1:
        hashes = [
            shingle_hashes(norm[i], cfg.shingle_size, cfg.shingle_unit) for i in reps.tolist()
        ]
        sigs = np.stack([signature(h, cfg.minhash_perm) for h in hashes])
        bands, rows = lsh_params(cfg.lsh_candidate_jaccard, cfg.minhash_perm)
        for pi, pj in candidate_pairs(sigs, bands, rows).tolist():
            score = exact_jaccard(hashes[pi], hashes[pj])
            if score >= cfg.near_dup_jaccard:
                i, j = int(reps[pi]), int(reps[pj])
                uf.union(i, j)
                dup_score[i] = max(dup_score[i], score)
                dup_score[j] = max(dup_score[j], score)

    roots = np.fromiter((uf.find(i) for i in range(n)), dtype=np.int64, count=n)
    in_group = np.bincount(roots, minlength=n)[roots] > 1
    group = np.where(in_group, roots, -1)
    return {
        "exact_group_id": exact_group,
        "dup_group_id": group,
        "dup_of": group,
        "dup_score": np.round(dup_score, 4),
    }
