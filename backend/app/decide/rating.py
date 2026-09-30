"""Integrity-adjusted rating with honest uncertainty (MVP_SPEC §6.5).

adjusted = Σwᵢrᵢ / Σwᵢ,  n_eff = (Σw)² / Σw²,  95% CI from a weighted bootstrap.
Ratings are `rating_norm` in [0, 1] (for Steam: share of positive reviews).
"""

import numpy as np


def weighted_mean(r: np.ndarray, w: np.ndarray) -> float:
    total = w.sum()
    return float((w * r).sum() / total) if total > 0 else float("nan")


def n_eff(w: np.ndarray) -> float:
    sq = (w**2).sum()
    return float(w.sum() ** 2 / sq) if sq > 0 else 0.0


def bootstrap_ci(
    r: np.ndarray,
    w: np.ndarray,
    resamples: int = 1000,
    seed: int = 7,
    level: float = 0.95,
    chunk: int = 100,
) -> tuple[float, float]:
    """Percentile CI of the weighted mean, resampling reviews with replacement.

    Chunked so 50K reviews x 1,000 resamples never materialises 50M indices at once.
    """
    n = len(r)
    if n == 0:
        return (float("nan"), float("nan"))
    rng = np.random.default_rng(seed)
    wr = w * r
    stats = np.empty(resamples)
    for start in range(0, resamples, chunk):
        size = min(chunk, resamples - start)
        idx = rng.integers(0, n, size=(size, n), dtype=np.int32)
        num, den = wr[idx].sum(axis=1), w[idx].sum(axis=1)
        stats[start : start + size] = np.divide(num, den, out=np.full(size, np.nan), where=den > 0)
    alpha = (1 - level) / 2
    lo, hi = np.nanquantile(stats, [alpha, 1 - alpha])
    return (float(lo), float(hi))


# Steam's store labels, from its documented review-score bands.
_STEAM_BANDS = [
    (0.95, 500, "Overwhelmingly Positive"),
    (0.80, 50, "Very Positive"),
    (0.80, 10, "Positive"),
    (0.70, 10, "Mostly Positive"),
    (0.40, 10, "Mixed"),
    (0.20, 10, "Mostly Negative"),
]


def steam_label(pct_positive: float, n: float) -> str | None:
    """Map a share of positive reviews (and review count) to Steam's label."""
    if n < 10 or np.isnan(pct_positive):
        return None
    for threshold, min_n, label in _STEAM_BANDS:
        if pct_positive >= threshold and n >= min_n:
            return label
    # Below 20% positive.
    if n >= 500:
        return "Overwhelmingly Negative"
    return "Very Negative" if n >= 50 else "Negative"
