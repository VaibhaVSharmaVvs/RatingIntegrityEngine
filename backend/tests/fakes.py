import hashlib

import numpy as np


class HashingEmbedder:
    """Deterministic bag-of-words vectors: similar wording -> high cosine. No model."""

    name = "hashing-test@64"

    def __init__(self, dim: int = 64) -> None:
        self.dim = dim
        self.calls = 0

    def encode(self, texts: list[str]) -> np.ndarray:
        self.calls += 1
        out = np.zeros((len(texts), self.dim), dtype=np.float32)
        for i, t in enumerate(texts):
            for w in t.lower().split():
                h = int.from_bytes(hashlib.md5(w.encode()).digest()[:4], "little")
                out[i, h % self.dim] += 1.0
        norms = np.linalg.norm(out, axis=1, keepdims=True)
        return out / np.where(norms == 0, 1, norms)
