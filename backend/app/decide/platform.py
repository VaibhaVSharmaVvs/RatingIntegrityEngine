"""Platform-policy rating: Steam's published review-score rules, emulated.

The third rating next to raw and integrity-adjusted (owner decision 2026-10-01). It
answers "what would the platform's own policy show?", using Valve's documented rules:

1. Key activations don't count (Sept 2016): reviews by customers who activated the
   game with a product key from outside Steam are left out of the score
   (`steam_purchase = false`).
2. Off-topic review bombs are excluded (March 2019): Steam detects a spike, Valve staff
   decide whether its focus is "unrelated to the likelihood that future purchasers will
   be happy", explicitly including DRM and EULA changes, and if so the **whole time
   window** is removed from the score, positive reviews included.

Emulation: our negative bursts stand in for Steam's spike detection; Valve's manual
decision is replaced by the share of the window's negative reviews whose verdict
System One judges not based on playing (`verdict_basis` < 0.5, question set v4). With
older question sets the `topic` choice (platform policy / developer conduct) is a
labelled proxy. A window is excluded when that share exceeds
`offtopic_window_share`.

Approximations, stated on the methodology card: English reviews only (Steam's score
uses all languages); our spike detector and Jev's judgment are not Valve's process.
"""

from dataclasses import dataclass, field
from datetime import datetime

import numpy as np

from app.models import PlatformPolicyConfig

PROXY_TOPICS = ("platform_policy", "developer_conduct")


@dataclass
class ExcludedWindow:
    start: datetime
    end: datetime
    negatives: int
    offtopic_share: float
    reviews_removed: int


@dataclass
class PlatformRating:
    rating: float | None
    counted: int
    key_activations_removed: int
    windows: list[ExcludedWindow] = field(default_factory=list)
    basis: str = "verdict_basis"  # or "topic_proxy" / "none"


def offtopic_verdicts(answers: dict[int, dict], n: int) -> tuple[np.ndarray, str]:
    """Per review: 1 if the verdict is not based on playing, 0 if it is, NaN if unknown."""
    out = np.full(n, np.nan)
    basis = "none"
    for rid, ans in answers.items():
        if "verdict_basis" in ans:
            out[rid] = float(ans["verdict_basis"]["noul"] < 0.5)
            basis = "verdict_basis"
        elif "topic" in ans:
            out[rid] = float(ans["topic"].get("choice") in PROXY_TOPICS)
            basis = "topic_proxy" if basis == "none" else basis
    return out, basis


def platform_rating(
    *,
    rating_norm: np.ndarray,
    created_at: np.ndarray,  # datetime64[us], NaT allowed
    steam_purchase: np.ndarray | None,  # bool per review; None when the source has no such data
    offtopic: np.ndarray,  # from offtopic_verdicts
    basis: str,
    bursts: list,  # app.corpus.bursts.Burst
    cfg: PlatformPolicyConfig,
    decided: np.ndarray | None = None,  # bool mask: only these reviews (live ticker)
) -> PlatformRating:
    keep = ~np.isnan(rating_norm)
    if decided is not None:
        keep &= decided
    key_removed = 0
    if cfg.purchasers_only and steam_purchase is not None:
        activated = ~steam_purchase & keep
        key_removed = int(activated.sum())
        keep &= steam_purchase

    windows: list[ExcludedWindow] = []
    if basis != "none":
        for b in bursts:
            if b.verdict != "negative":
                continue  # Steam reviews spikes of negative reviews
            members = np.asarray(b.member_ids)
            known = members[~np.isnan(offtopic[members])]
            if decided is not None:
                known = known[decided[known]]
            if known.size < cfg.min_judged_negatives:
                continue
            share = float(offtopic[known].mean())
            if share <= cfg.offtopic_window_share:
                continue
            start = np.datetime64(b.start.replace(tzinfo=None), "us")
            end = np.datetime64(b.end.replace(tzinfo=None), "us") + np.timedelta64(1, "h")
            in_window = (created_at >= start) & (created_at < end)
            removed = int((in_window & keep).sum())
            keep &= ~in_window
            windows.append(
                ExcludedWindow(b.start, b.end, int(known.size), round(share, 4), removed)
            )

    counted = int(keep.sum())
    rating = float(rating_norm[keep].mean()) if counted else None
    return PlatformRating(rating, counted, key_removed, windows, basis)
