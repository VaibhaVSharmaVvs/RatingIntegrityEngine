from datetime import UTC, datetime, timedelta

import numpy as np

from app.corpus.bursts import Burst
from app.decide.platform import offtopic_verdicts, platform_rating
from app.models import PlatformPolicyConfig

T0 = datetime(2025, 6, 1, tzinfo=UTC)
CFG = PlatformPolicyConfig(min_judged_negatives=5)


def corpus(n_base=200, n_bomb=100, bomb_offtopic=1.0):
    """200 background reviews (90% positive) over 10 days, then a 100-review negative
    burst on day 11, of which `bomb_offtopic` share has a verdict not based on playing."""
    rng = np.random.default_rng(0)
    hours = np.concatenate([rng.uniform(0, 240, n_base), rng.uniform(250, 252, n_bomb)])
    rating = np.concatenate([(rng.random(n_base) < 0.9).astype(float), np.zeros(n_bomb)])
    created = (
        np.datetime64("2025-06-01T00:00:00") + (hours * 3600).astype("timedelta64[s]")
    ).astype("datetime64[us]")
    off = np.concatenate(
        [np.zeros(n_base), (np.arange(n_bomb) < bomb_offtopic * n_bomb).astype(float)]
    )
    burst = Burst(
        verdict="negative",
        start=T0 + timedelta(hours=250),
        end=T0 + timedelta(hours=251),
        size=n_bomb,
        peak_hour=T0 + timedelta(hours=250),
        peak_count=60,
        peak_z=40,
        baseline_per_hour=0.1,
        member_ids=list(range(n_base, n_base + n_bomb)),
    )
    return rating, created, off, burst


def test_offtopic_window_is_removed_whole_like_steam() -> None:
    rating, created, off, burst = corpus()
    p = platform_rating(
        rating_norm=rating,
        created_at=created,
        steam_purchase=None,
        offtopic=off,
        basis="verdict_basis",
        bursts=[burst],
        cfg=CFG,
    )
    assert len(p.windows) == 1 and p.windows[0].reviews_removed == 100
    assert p.rating == rating[:200].mean()  # back to the background level
    assert p.counted == 200


def test_on_topic_negative_burst_is_kept() -> None:
    """A genuine complaint wave (CS2-style) is not an off-topic bomb: it stays."""
    rating, created, off, burst = corpus(bomb_offtopic=0.2)
    p = platform_rating(
        rating_norm=rating,
        created_at=created,
        steam_purchase=None,
        offtopic=off,
        basis="verdict_basis",
        bursts=[burst],
        cfg=CFG,
    )
    assert p.windows == [] and p.rating == rating.mean()


def test_key_activations_do_not_count() -> None:
    rating = np.array([1.0, 1.0, 0.0, 0.0])
    created = np.array(["2025-06-01T00"] * 4, dtype="datetime64[us]")
    p = platform_rating(
        rating_norm=rating,
        created_at=created,
        steam_purchase=np.array([True, False, True, True]),
        offtopic=np.full(4, np.nan),
        basis="none",
        bursts=[],
        cfg=CFG,
    )
    assert p.key_activations_removed == 1 and p.rating == 1 / 3


def test_live_mask_only_counts_decided_reviews() -> None:
    rating, created, off, burst = corpus()
    decided = np.zeros(rating.size, dtype=bool)
    decided[:50] = True
    p = platform_rating(
        rating_norm=rating,
        created_at=created,
        steam_purchase=None,
        offtopic=off,
        basis="verdict_basis",
        bursts=[burst],
        cfg=CFG,
        decided=decided,
    )
    assert p.counted == 50 and p.windows == []  # bomb not judged yet


def test_verdict_basis_preferred_topic_is_a_labelled_proxy() -> None:
    v4 = {
        0: {"verdict_basis": {"type": "noul", "noul": 0.1}},
        1: {"verdict_basis": {"type": "noul", "noul": 0.9}},
    }
    off, basis = offtopic_verdicts(v4, 3)
    assert basis == "verdict_basis" and off[0] == 1 and off[1] == 0 and np.isnan(off[2])
    v3 = {
        0: {"topic": {"type": "choice", "choice": "platform_policy"}},
        1: {"topic": {"type": "choice", "choice": "gameplay"}},
    }
    off, basis = offtopic_verdicts(v3, 2)
    assert basis == "topic_proxy" and off.tolist() == [1.0, 0.0]
