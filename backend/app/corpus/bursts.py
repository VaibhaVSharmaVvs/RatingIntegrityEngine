"""Burst detection (MVP_SPEC §6.4): hourly volume per verdict vs a trailing baseline.

For each verdict series (positive, negative) hourly counts are compared with a
trailing baseline (median / MAD of the previous `baseline_hours`). Hours already
flagged as a burst are left out of later baselines, so a multi-day bomb cannot
contaminate its own baseline and stop being detected (a plain rolling median is
only robust to <50% contamination: 3.5 days of a 7-day window).

Flagged hours are merged into windows. Each window with enough reviews becomes a
`Burst`. Change points in the daily share of positive reviews come from `ruptures`
PELT and are reported separately, for the timeline.

Verdicts are *current* Steam verdicts: many HD2 bomb reviews were later edited to
positive (MEASUREMENTS M9a), so bursts are detected per verdict and on volume.
"""

import itertools
from dataclasses import dataclass, field
from datetime import datetime

import numpy as np
import polars as pl
import ruptures

from app.models import BurstConfig

MAD_TO_SD = 1.4826


@dataclass
class Burst:
    verdict: str  # 'positive' | 'negative'
    start: datetime  # first hour, inclusive
    end: datetime  # last hour, inclusive (hour start)
    size: int
    peak_hour: datetime
    peak_count: int
    peak_z: float
    baseline_per_hour: float
    member_ids: list[int] = field(default_factory=list)

    @property
    def hours(self) -> int:
        return int((self.end - self.start).total_seconds() // 3600) + 1


def hourly_counts(reviews: pl.DataFrame) -> pl.DataFrame:
    """Hour x verdict counts over the full span, zero-filled."""
    r = reviews.filter(pl.col("created_at").is_not_null() & pl.col("rating_norm").is_not_null())
    r = r.with_columns(
        hour=pl.col("created_at").dt.truncate("1h"),
        verdict=pl.when(pl.col("rating_norm") >= 0.5)
        .then(pl.lit("positive"))
        .otherwise(pl.lit("negative")),
    )
    hours = pl.datetime_range(r["hour"].min(), r["hour"].max(), "1h", time_zone="UTC", eager=True)
    grid = pl.DataFrame({"hour": hours}).join(
        pl.DataFrame({"verdict": ["positive", "negative"]}), how="cross"
    )
    counts = r.group_by("hour", "verdict").agg(pl.len().alias("n"))
    return (
        grid.join(counts, on=["hour", "verdict"], how="left")
        .with_columns(pl.col("n").fill_null(0))
        .sort("verdict", "hour")
    )


def robust_z(counts: np.ndarray, cfg: BurstConfig) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(z, flagged, baseline_median) per hour. Baselines skip already-flagged hours."""
    n = counts.size
    z = np.zeros(n)
    base = np.full(n, np.nan)
    flagged = np.zeros(n, dtype=bool)
    history: list[float] = []  # unflagged counts, oldest first
    for i in range(n):
        window = history[-cfg.baseline_hours :]
        if len(window) >= cfg.min_history_hours:
            med = float(np.median(window))
            mad = float(np.median(np.abs(np.asarray(window) - med)))
            scale = max(MAD_TO_SD * mad, cfg.min_scale)
            z[i] = (counts[i] - med) / scale
            base[i] = med
            flagged[i] = z[i] >= cfg.z_threshold and counts[i] >= cfg.min_hour_count
        if not flagged[i]:
            history.append(float(counts[i]))
    return z, flagged, base


def detect_bursts(reviews: pl.DataFrame, cfg: BurstConfig) -> list[Burst]:
    """`reviews` needs `id`, `created_at` (UTC), `rating_norm`."""
    if reviews.filter(pl.col("created_at").is_not_null()).height == 0:
        return []
    hc = hourly_counts(reviews)
    rev = reviews.filter(
        pl.col("created_at").is_not_null() & pl.col("rating_norm").is_not_null()
    ).with_columns(
        hour=pl.col("created_at").dt.truncate("1h"),
        positive=pl.col("rating_norm") >= 0.5,
    )
    bursts: list[Burst] = []
    for verdict in ("negative", "positive"):
        series = hc.filter(pl.col("verdict") == verdict)
        hours = series["hour"].to_list()
        counts = series["n"].to_numpy().astype(float)
        z, flagged, base = robust_z(counts, cfg)
        idx = np.flatnonzero(flagged)
        if idx.size == 0:
            continue
        # Merge flagged hours separated by at most `merge_gap_hours` unflagged hours.
        groups, start = [], idx[0]
        for prev, cur in itertools.pairwise(idx):
            if cur - prev > cfg.merge_gap_hours + 1:
                groups.append((start, prev))
                start = cur
        groups.append((start, idx[-1]))
        for a, b in groups:
            members = rev.filter(
                pl.col("hour").is_between(hours[a], hours[b])
                & (pl.col("positive") == (verdict == "positive"))
            )["id"].to_list()
            if len(members) < cfg.min_burst_reviews:
                continue
            peak = a + int(np.argmax(counts[a : b + 1]))
            bursts.append(
                Burst(
                    verdict=verdict,
                    start=hours[a],
                    end=hours[b],
                    size=len(members),
                    peak_hour=hours[peak],
                    peak_count=int(counts[peak]),
                    peak_z=round(float(z[peak]), 1),
                    baseline_per_hour=round(float(np.nanmean(base[a : b + 1])), 2),
                    member_ids=members,
                )
            )
    return sorted(bursts, key=lambda x: x.start)


def change_points(reviews: pl.DataFrame, cfg: BurstConfig) -> list[str]:
    """Dates where the daily share of positive reviews shifts (ruptures PELT, l2)."""
    daily = (
        reviews.filter(pl.col("created_at").is_not_null() & pl.col("rating_norm").is_not_null())
        .group_by(day=pl.col("created_at").dt.date())
        .agg(pl.len().alias("n"), (pl.col("rating_norm") >= 0.5).mean().alias("pos"))
        .filter(pl.col("n") >= cfg.min_daily_reviews)
        .sort("day")
    )
    if daily.height < 2 * cfg.min_segment_days:
        return []
    signal = daily["pos"].to_numpy().reshape(-1, 1)
    var = float(signal.var()) or 1e-6
    pen = cfg.change_point_penalty * np.log(daily.height) * var
    algo = ruptures.Pelt(model="l2", min_size=cfg.min_segment_days).fit(signal)
    ends = algo.predict(pen=pen)[:-1]  # last element is the series end
    days = daily["day"].to_list()
    return [days[i].isoformat() for i in ends]
