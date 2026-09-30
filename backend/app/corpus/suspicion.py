"""Cluster suspicion (MVP_SPEC §6.4): a geometric mean of stored, explainable factors.

Every factor is in [0, 1] and is kept so the UI caption is generated from data:
"127 reviews · 91% within 14 min · 84% similar wording · 93% same verdict".

- time_concentration: is the cluster more concentrated in time than a *random* set of
  the same number of corpus reviews? For each scale (15 min ... 3 days) compare the
  densest window's count of other reviews (the anchor review that starts the window
  is not evidence) with the same statistic averaged over random same-size subsets
  of the corpus: 1 - null / observed. A plain lift over the corpus-wide rate is
  biased: the cluster is part of the corpus, so any coincidence at a small scale
  looked like a huge lift (MEASUREMENTS M9c). Burst clusters use their own rate vs
  their trailing baseline instead: 1 - baseline / observed.
- similarity: share of members whose embedding is within `similar_cosine` of the
  cluster centroid.
- rating_homogeneity: (majority-verdict share - 0.5) / 0.5.
- new_account_share: lift of (single-review account or low playtime) over the corpus
  base rate, 1 - base / share; None when the source has no account data.
- offtopic_mean: mean probability that the review's topic is in `offtopic_topics`;
  None when there are no System One answers (heuristic backend).

Missing factors are skipped rather than zeroed, and each factor is floored at
`factor_floor`, so one absent signal cannot zero the whole score.
Factors can be weighted (`factor_weights`): new accounts are supporting evidence at
half weight, so coordination among established accounts is not vetoed by "no new
accounts".
"""

from dataclasses import dataclass, field
from datetime import datetime

import numpy as np

from app.models import SuspicionConfig


@dataclass
class ClusterStats:
    kind: str
    members: np.ndarray
    size: int
    t_start: datetime | None
    t_end: datetime | None
    factors: dict[str, float | None]
    suspicion: float
    caption: str
    window: dict = field(default_factory=dict)  # densest window, for the caption/UI
    top_phrases: list[str] = field(default_factory=list)


def geometric_mean(
    factors: dict[str, float | None], floor: float, weights: dict[str, float] | None = None
) -> float:
    weights = weights or {}
    items = [
        (max(floor, min(1.0, v)), weights.get(k, 1.0)) for k, v in factors.items() if v is not None
    ]
    total = sum(w for _, w in items)
    if not items or total <= 0:
        return 0.0
    return float(np.exp(sum(w * np.log(v) for v, w in items) / total))


def _densest_window(times: np.ndarray, width: np.timedelta64) -> tuple[int, int]:
    """(start index, count) of the densest [t, t + width) window in sorted times."""
    ends = np.searchsorted(times, times + width, side="left")
    counts = ends - np.arange(times.size)
    i = int(np.argmax(counts))
    return i, int(counts[i])


class NullModel:
    """Densest-window counts for random same-size subsets of the corpus (cached)."""

    def __init__(self, corpus_times_sorted: np.ndarray, samples: int, seed: int) -> None:
        self.times = corpus_times_sorted
        self.samples = samples
        self.rng = np.random.default_rng(seed)
        self._cache: dict[tuple[int, float], float] = {}

    def expected_others(self, n: int, hours: float) -> float:
        key = (n, hours)
        if key not in self._cache:
            width = np.timedelta64(int(hours * 3600), "s")
            if n < 2 or self.times.size < n:
                self._cache[key] = 0.0
            else:
                draws = [
                    _densest_window(np.sort(self.rng.choice(self.times, n, replace=False)), width)[
                        1
                    ]
                    - 1
                    for _ in range(self.samples)
                ]
                self._cache[key] = float(np.mean(draws))
        return self._cache[key]


def time_concentration(
    member_times: np.ndarray, null: NullModel, cfg: SuspicionConfig
) -> tuple[float, dict]:
    """member_times: sorted datetime64[us]. Returns (factor, densest-window info)."""
    best: tuple[float, dict] = (0.0, {})
    n = member_times.size
    if n < 2:
        return best
    for hours in cfg.time_scales_hours:
        width = np.timedelta64(int(hours * 3600), "s")
        i, count = _densest_window(member_times, width)
        observed = count - 1  # the anchor review that starts the window is not evidence
        expected = null.expected_others(n, hours)
        value = 0.0 if observed <= 0 else max(0.0, 1.0 - max(expected, cfg.null_floor) / observed)
        if value > best[0] or not best[1]:
            best = (
                value,
                {
                    "hours": hours,
                    "count": count,
                    "expected": expected + 1,
                    "start": member_times[i],
                },
            )
    return best


def _fmt_window(hours: float) -> str:
    if hours < 1:
        return f"{int(hours * 60)} min"
    if hours < 48:
        return f"{hours:g} h"
    return f"{hours / 24:g} days"


def score_cluster(
    kind: str,
    members: np.ndarray,
    *,
    created_at: np.ndarray,  # datetime64[us] per review (NaT allowed)
    null: NullModel,
    rating_norm: np.ndarray,
    embeddings: np.ndarray | None,
    new_account: np.ndarray | None,  # bool per review, or None if no account data
    offtopic_prob: np.ndarray | None,  # per review, or None without System One
    cfg: SuspicionConfig,
    burst_rate: tuple[float, float] | None = None,  # (observed/h, baseline/h) for bursts
) -> ClusterStats:
    size = int(members.size)
    times = np.sort(created_at[members][~np.isnat(created_at[members])])
    factors: dict[str, float | None] = {}
    window: dict = {}

    if burst_rate is not None:
        observed, baseline = burst_rate
        factors["time_concentration"] = max(0.0, 1.0 - baseline / max(observed, 1e-9))
        window = {"rate": observed, "baseline": baseline}
    elif times.size:
        factors["time_concentration"], window = time_concentration(times, null, cfg)
    else:
        factors["time_concentration"] = None

    if embeddings is not None:
        e = embeddings[members]
        centroid = e.mean(axis=0)
        centroid /= max(np.linalg.norm(centroid), 1e-9)
        factors["similarity"] = float(np.mean(e @ centroid >= cfg.similar_cosine))
    else:
        factors["similarity"] = None

    r = rating_norm[members]
    r = r[~np.isnan(r)]
    majority = float(max(np.mean(r >= 0.5), np.mean(r < 0.5))) if r.size else 0.5
    factors["rating_homogeneity"] = (majority - 0.5) / 0.5

    new_share = None
    if new_account is not None:
        base = float(np.mean(new_account))
        new_share = float(np.mean(new_account[members]))
        factors["new_account_share"] = max(0.0, 1.0 - base / new_share) if new_share > 0 else 0.0
    else:
        factors["new_account_share"] = None

    offtopic = None
    if offtopic_prob is not None:
        offtopic = float(np.mean(offtopic_prob[members]))
        factors["offtopic_mean"] = offtopic
    else:
        factors["offtopic_mean"] = None

    suspicion = geometric_mean(factors, cfg.factor_floor, cfg.factor_weights)

    parts = [f"{size:,} reviews"]
    if burst_rate is not None:
        parts.append(f"{window['rate']:.0f}/h vs a baseline of {window['baseline']:.0f}/h")
    elif window and factors["time_concentration"]:
        parts.append(
            f"{window['count']:,} within {_fmt_window(window['hours'])} "
            f"(~{window['expected']:.1f} for a random {size:,})"
        )
    if factors["similarity"] is not None:
        parts.append(f"{factors['similarity']:.0%} similar wording")
    parts.append(f"{majority:.0%} same verdict")
    if new_share is not None:
        parts.append(f"{new_share:.0%} new accounts")
    if offtopic is not None:
        parts.append(f"{offtopic:.0%} off-topic")

    t_start = times[0].astype(datetime) if times.size else None
    t_end = times[-1].astype(datetime) if times.size else None
    return ClusterStats(
        kind=kind,
        members=members,
        size=size,
        t_start=t_start,
        t_end=t_end,
        factors={k: (round(v, 4) if v is not None else None) for k, v in factors.items()},
        suspicion=round(suspicion, 4),
        caption=" · ".join(parts),
        window={
            k: (v.astype(datetime).isoformat() if isinstance(v, np.datetime64) else v)
            for k, v in window.items()
        },
    )
