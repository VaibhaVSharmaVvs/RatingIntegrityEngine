from datetime import UTC, datetime, timedelta

import numpy as np
import polars as pl
import pytest

from app.corpus.bursts import change_points, detect_bursts
from app.corpus.clusters import top_phrases
from app.corpus.suspicion import NullModel, geometric_mean, score_cluster
from app.decide.policy import Decision, apply_cluster_rules
from app.models import ActionCode, BurstConfig, PolicyThresholds, SuspicionConfig

T0 = datetime(2024, 4, 1, tzinfo=UTC)


def reviews_from_hourly(
    counts: list[int], positive_share: float = 0.0, seed: int = 0
) -> pl.DataFrame:
    rng = np.random.default_rng(seed)
    rows = []
    for h, n in enumerate(counts):
        for k in range(n):
            rows.append(
                (
                    T0 + timedelta(hours=h, seconds=int(3600 * k / max(n, 1))),
                    float(rng.random() < positive_share),
                )
            )
    return pl.DataFrame(
        {"created_at": [r[0] for r in rows], "rating_norm": [r[1] for r in rows]},
        schema={"created_at": pl.Datetime("us", "UTC"), "rating_norm": pl.Float64},
    ).with_row_index("id")


# --- bursts -------------------------------------------------------------------------


def test_detects_a_burst_and_its_window() -> None:
    rng = np.random.default_rng(1)
    counts = list(rng.poisson(5, 24 * 10))
    counts[24 * 8 : 24 * 8 + 12] = [200] * 12  # a 12-hour bomb on day 9
    bursts = detect_bursts(reviews_from_hourly(counts), BurstConfig())
    assert len(bursts) == 1
    b = bursts[0]
    assert b.verdict == "negative"
    assert b.start == T0 + timedelta(hours=24 * 8) and b.hours == 12
    assert b.size == 12 * 200 and b.peak_z > 50


def test_long_burst_does_not_contaminate_its_own_baseline() -> None:
    """A 4-day bomb inside a 7-day baseline window: a plain rolling median would stop
    flagging it after 3.5 days. Flagged hours are excluded from the baseline."""
    rng = np.random.default_rng(2)
    counts = list(rng.poisson(5, 24 * 14))
    counts[24 * 7 : 24 * 11] = [150] * 96
    bursts = detect_bursts(reviews_from_hourly(counts), BurstConfig())
    assert len(bursts) == 1 and bursts[0].hours == 96


def test_no_bursts_in_steady_poisson_traffic() -> None:
    rng = np.random.default_rng(3)
    counts = list(rng.poisson(8, 24 * 90))  # 90 days, no events
    assert detect_bursts(reviews_from_hourly(counts), BurstConfig()) == []


def test_bursts_are_per_verdict() -> None:
    """A 95%-positive spike is reported as a positive burst, and its 5% negatives are a
    genuine (smaller) negative spike too: each verdict is judged against its own baseline."""
    rng = np.random.default_rng(4)
    counts = list(rng.poisson(6, 24 * 10))
    counts[24 * 8 : 24 * 8 + 6] = [300] * 6
    bursts = {
        b.verdict: b
        for b in detect_bursts(reviews_from_hourly(counts, positive_share=0.95), BurstConfig())
    }
    assert set(bursts) == {"positive", "negative"}
    assert bursts["positive"].size > 10 * bursts["negative"].size


def test_no_baseline_no_burst_at_series_start() -> None:
    """A launch spike (CS2) has no history to compare with, so it is not a burst."""
    counts = [300] * 24 + [10] * 24 * 5
    assert detect_bursts(reviews_from_hourly(counts), BurstConfig()) == []


def test_change_point_on_a_step_in_positive_share() -> None:
    days = 40
    counts = [20] * 24 * days
    df = reviews_from_hourly(counts, positive_share=0.9, seed=5)
    df = df.with_columns(
        rating_norm=pl.when(pl.col("created_at") >= T0 + timedelta(days=20))
        .then(0.0)
        .otherwise(pl.col("rating_norm"))
    )
    cps = change_points(df, BurstConfig())
    assert cps == [(T0 + timedelta(days=20)).date().isoformat()]


# --- suspicion ----------------------------------------------------------------------


def test_geometric_mean_skips_missing_and_floors_zeros() -> None:
    assert geometric_mean({"a": 0.5, "b": None}, 0.02) == pytest.approx(0.5)
    assert geometric_mean({"a": 1.0, "b": 0.0}, 0.04) == pytest.approx(0.2)
    assert geometric_mean({"a": None}, 0.02) == 0.0


def _arrays(
    n: int, *, t_hours: np.ndarray, emb_same: np.ndarray, offtopic: np.ndarray, verdict: np.ndarray
):
    created = (
        np.datetime64("2024-04-01T00:00:00") + (t_hours * 3600).astype("timedelta64[s]")
    ).astype("datetime64[us]")
    rng = np.random.default_rng(0)
    emb = rng.normal(size=(n, 16))
    emb[emb_same] = emb[emb_same][0] + 0.01 * rng.normal(size=(emb_same.sum(), 16))
    emb /= np.linalg.norm(emb, axis=1, keepdims=True)
    return dict(
        created_at=created,
        null=NullModel(np.sort(created), samples=24, seed=0),
        rating_norm=verdict.astype(float),
        embeddings=emb,
        new_account=None,
        offtopic_prob=offtopic,
        cfg=SuspicionConfig(),
    )


def test_coordinated_offtopic_cluster_scores_high_and_captions_its_factors() -> None:
    n = 2000
    rng = np.random.default_rng(1)
    t = rng.uniform(0, 24 * 60, n)  # 60 days of background
    members = np.arange(100)
    t[members] = 24 * 30 + rng.uniform(0, 0.2, 100)  # 100 reviews in 12 minutes
    same = np.zeros(n, dtype=bool)
    same[members] = True
    offtopic = np.where(same, 0.9, 0.05)
    verdict = np.where(same, 0, rng.integers(0, 2, n))
    s = score_cluster(
        "semantic",
        members,
        **_arrays(n, t_hours=t, emb_same=same, offtopic=offtopic, verdict=verdict),
    )
    assert s.suspicion > 0.8
    # Lift is capped at corpus/cluster size (2000/100 = 20), so the factor tops out at 0.95.
    assert s.factors["time_concentration"] > 0.95 and s.factors["similarity"] == 1.0
    assert "100 reviews" in s.caption and "100 within 15 min" in s.caption
    assert "100% same verdict" in s.caption and "90% off-topic" in s.caption


def _organic_wave(with_accounts: bool):
    """CS2-style launch complaints: concentrated, negative, similar, but ON-topic, from
    ordinary accounts (the same new-account rate as the rest of the corpus)."""
    n = 2000
    rng = np.random.default_rng(2)
    t = rng.uniform(0, 24 * 60, n)
    members = np.arange(300)
    t[members] = 24 * 30 + rng.uniform(0, 48, 300)
    same = np.zeros(n, dtype=bool)
    same[members] = True
    offtopic = np.full(n, 0.03)  # performance / gameplay complaints
    verdict = np.where(same, 0, 1)
    arrays = _arrays(n, t_hours=t, emb_same=same, offtopic=offtopic, verdict=verdict)
    if with_accounts:
        arrays["new_account"] = np.random.default_rng(5).random(n) < 0.10
    return score_cluster("burst", members, burst_rate=(300 / 48, 1.4), **arrays)


def test_guardrail_organic_on_topic_complaint_wave_is_not_suspicious() -> None:
    """With account data (Steam), a genuine on-topic wave stays below the penalty."""
    s = _organic_wave(with_accounts=True)
    assert s.suspicion <= PolicyThresholds().cluster_penalty_threshold


def test_guardrail_genuine_reviews_keep_full_weight_without_account_data() -> None:
    """Without account data (e.g. a CSV) the same wave can just cross the threshold with
    the halved supporting weights (M12a); genuine on-topic reviews must still KEEP."""
    s = _organic_wave(with_accounts=False)
    genuine = Decision(ActionCode.KEEP, 0.95, [])
    d = apply_cluster_rules(
        genuine,
        suspicion=s.suspicion,
        cluster_kind="burst",
        later_copy=False,
        thresholds=PolicyThresholds(),
    )
    assert d.action is ActionCode.KEEP
    assert (
        d.integrity_score
        >= PolicyThresholds().downweight_below + PolicyThresholds().grey_zone_width
    )


# --- S4 cluster rules ---------------------------------------------------------------

T = PolicyThresholds()
T_NO_GREY = PolicyThresholds(grey_zone_width=0.0)  # isolate the penalty from the grey-zone FLAG


def test_penalty_applies_only_above_threshold() -> None:
    base = Decision(ActionCode.KEEP, 0.9, ["LOW_INFO"])
    assert (
        apply_cluster_rules(
            base, suspicion=0.4, cluster_kind="semantic", later_copy=False, thresholds=T_NO_GREY
        )
        is base
    )
    d = apply_cluster_rules(
        base, suspicion=0.8, cluster_kind="semantic", later_copy=False, thresholds=T_NO_GREY
    )
    assert d.integrity_score == pytest.approx(0.9 * (1 - 0.5 * 0.8))
    assert d.action is ActionCode.DOWNWEIGHT
    assert d.reasons[0] == "COORDINATED_CLUSTER"
    b = apply_cluster_rules(
        base, suspicion=0.8, cluster_kind="burst", later_copy=False, thresholds=T_NO_GREY
    )
    assert b.reasons[0] == "BURST_WINDOW"


def test_later_copy_in_suspicious_cluster_escalates_outside_stays() -> None:
    copy = Decision(ActionCode.DOWNWEIGHT, 0.8, ["NEAR_DUPLICATE"])
    inside = apply_cluster_rules(
        copy, suspicion=0.7, cluster_kind="burst", later_copy=True, thresholds=T
    )
    assert inside.action is ActionCode.EXCLUDE
    outside = apply_cluster_rules(
        copy, suspicion=0.2, cluster_kind="burst", later_copy=True, thresholds=T
    )
    assert outside.action is ActionCode.DOWNWEIGHT
    soft = PolicyThresholds(duplicate_in_burst_action="FLAG")
    assert (
        apply_cluster_rules(
            copy, suspicion=0.7, cluster_kind="burst", later_copy=True, thresholds=soft
        ).action
        is ActionCode.FLAG
    )


def test_cluster_rules_never_exclude_without_a_copy() -> None:
    """System One output (via offtopic in suspicion) can penalise, never EXCLUDE alone."""
    for base in (Decision(ActionCode.KEEP, 0.3, []), Decision(ActionCode.FLAG, 0.5, ["SPAM"])):
        d = apply_cluster_rules(
            base, suspicion=1.0, cluster_kind="semantic", later_copy=False, thresholds=T
        )
        assert d.action is not ActionCode.EXCLUDE


def test_stricter_base_action_is_kept() -> None:
    flagged = Decision(ActionCode.FLAG, 0.9, ["LOW_CONFIDENCE"])
    assert (
        apply_cluster_rules(
            flagged, suspicion=0.9, cluster_kind="semantic", later_copy=False, thresholds=T
        ).action
        is ActionCode.FLAG
    )


def test_grey_zone_flag() -> None:
    base = Decision(ActionCode.KEEP, 0.95, [])
    d = apply_cluster_rules(
        base, suspicion=0.9, cluster_kind="semantic", later_copy=False, thresholds=T
    )
    assert d.integrity_score == pytest.approx(0.5225) and d.action is ActionCode.FLAG
    off = PolicyThresholds(grey_zone_width=0.0)
    assert (
        apply_cluster_rules(
            base, suspicion=0.9, cluster_kind="semantic", later_copy=False, thresholds=off
        ).action
        is ActionCode.DOWNWEIGHT
    )


def test_top_phrases_are_cluster_specific() -> None:
    texts = (
        ["psn account required refund"] * 5
        + ["great gameplay with friends"] * 5
        + ["the game is fun"] * 10
    )
    phrases = top_phrases(texts, [np.arange(5), np.arange(5, 10)], k=6)
    assert "psn account" in phrases[0] and "account" in " ".join(phrases[0])
    assert any("gameplay" in p for p in phrases[1])


def test_a_lone_review_in_its_window_is_not_concentration() -> None:
    """3 identical reviews spread over weeks: the densest window holds only its anchor."""
    n = 2000
    rng = np.random.default_rng(3)
    t = rng.uniform(0, 24 * 60, n)
    members = np.array([0, 1, 2])
    t[members] = [24 * 5, 24 * 25, 24 * 45]
    same = np.zeros(n, dtype=bool)
    same[members] = True
    s = score_cluster(
        "duplicate",
        members,
        **_arrays(n, t_hours=t, emb_same=same, offtopic=np.full(n, 0.5), verdict=np.zeros(n)),
    )
    assert s.factors["time_concentration"] == 0.0
    assert "within" not in s.caption


def test_a_cluster_as_spread_as_the_corpus_is_not_concentrated() -> None:
    """46 reviews drawn at random from the corpus: a coincidence at a small scale must
    not read as coordination (the old corpus-lift scored this ~0.99)."""
    n = 2000
    rng = np.random.default_rng(4)
    t = np.concatenate([rng.uniform(24 * 30, 24 * 33, 1200), rng.uniform(0, 24 * 60, 800)])
    members = rng.choice(n, 46, replace=False)
    same = np.zeros(n, dtype=bool)
    same[members] = True
    s = score_cluster(
        "semantic",
        members,
        **_arrays(n, t_hours=t, emb_same=same, offtopic=np.full(n, 0.5), verdict=np.zeros(n)),
    )
    assert s.factors["time_concentration"] < 0.3


def test_weighted_geometric_mean() -> None:
    f = {"a": 1.0, "b": 1.0, "new_account_share": 0.0}
    assert geometric_mean(f, 0.02) == pytest.approx(0.02 ** (1 / 3))
    assert geometric_mean(f, 0.02, {"new_account_share": 0.5}) == pytest.approx(0.02 ** (0.5 / 2.5))
