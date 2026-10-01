import numpy as np
import pytest

from app.decide.policy import decide
from app.decide.rating import bootstrap_ci, n_eff, steam_label, weighted_mean
from app.models import ActionCode, PolicyThresholds

LEVELS = {"informativeness": 4, "rating_support": 4}


def answers(
    inf=3.0,
    sup=3.0,
    spam=0.01,
    templated=0.01,
    offtopic=0.0,
    conf=0.9,
    contradicts=0.0,
    about_game=None,
) -> dict:
    a = {
        "informativeness": {"type": "score", "score": inf, "confidence": conf},
        "rating_support": {
            "type": "score",
            "score": sup,
            "probabilities": {"0": contradicts, "1": 0.0, "2": 0.0, "3": 1.0 - contradicts},
            "confidence": conf,
        },
        "topic": {
            "type": "choice",
            "choice": "gameplay",
            "probabilities": {"gameplay": 1 - offtopic, "off_topic": offtopic},
            "confidence": conf,
        },
        "spam_promo": {"type": "noul", "noul": spam},
        "templated": {"type": "noul", "noul": templated},
        "campaign_language": {"type": "noul", "noul": 0.01},
    }
    if about_game is not None:
        a["about_game"] = {"type": "noul", "noul": about_game}
    return a


T = PolicyThresholds()


def test_specific_on_topic_review_is_kept() -> None:
    d = decide(answers(), T, score_levels=LEVELS)
    assert d.action is ActionCode.KEEP
    assert d.integrity_score > 0.9
    assert d.reasons == []


def test_short_review_is_not_penalised_for_brevity() -> None:
    """Option B: "good game" is a real verdict. Low information is shown, not weighted."""
    d = decide(answers(inf=0.0, sup=0.5), T, score_levels=LEVELS)
    assert d.action is ActionCode.KEEP
    assert d.integrity_score == pytest.approx(1.0, abs=0.01)
    assert "LOW_INFO" not in d.reasons and "UNSUPPORTED_VERDICT" not in d.reasons


def test_text_contradicting_its_verdict_is_downweighted() -> None:
    d = decide(answers(sup=0.1, contradicts=0.95), T, score_levels=LEVELS)
    assert d.action is ActionCode.DOWNWEIGHT
    assert d.reasons[0] == "CONTRADICTS_VERDICT"


def test_review_only_about_the_company_is_downweighted() -> None:
    d = decide(answers(about_game=0.05), T, score_levels=LEVELS)
    assert d.action is ActionCode.DOWNWEIGHT
    assert d.reasons[0] == "OFF_TOPIC"
    assert decide(answers(about_game=0.95), T, score_levels=LEVELS).action is ActionCode.KEEP


def test_low_playtime_only_counts_with_an_off_game_verdict() -> None:
    """Quitting a bad game early is valid evidence (Gollum: 49% of negatives < 2 h)."""
    on_topic = decide(answers(about_game=0.95), T, score_levels=LEVELS, low_playtime=True)
    assert on_topic.action is ActionCode.KEEP and "LOW_EXPERIENCE" not in on_topic.reasons
    off = decide(answers(about_game=0.4), T, score_levels=LEVELS, low_playtime=True)
    off_played = decide(answers(about_game=0.4), T, score_levels=LEVELS, low_playtime=False)
    assert off.integrity_score < off_played.integrity_score
    assert "LOW_EXPERIENCE" in off.reasons


def test_about_game_replaces_the_topic_fallback() -> None:
    """With v3's about_game, the legacy topic-based off-topic signal is not double counted."""
    d = decide(answers(offtopic=1.0, about_game=0.95), T, score_levels=LEVELS)
    assert d.action is ActionCode.KEEP


def test_system_one_alone_never_excludes() -> None:
    d = decide(answers(spam=0.99), T, score_levels=LEVELS, has_promo=False)
    assert d.action is ActionCode.FLAG
    assert d.reasons[0] == "SPAM"


def test_spam_with_deterministic_promo_signal_is_excluded() -> None:
    d = decide(answers(spam=0.99), T, score_levels=LEVELS, has_promo=True)
    assert d.action is ActionCode.EXCLUDE


def test_low_confidence_on_two_questions_flags() -> None:
    d = decide(answers(conf=0.3), T, score_levels=LEVELS)
    assert d.action is ActionCode.FLAG
    assert d.reasons[0] == "LOW_CONFIDENCE"


def test_thresholds_come_from_config() -> None:
    spec = PolicyThresholds(w_informativeness=0.30, w_rating_support=0.25)  # the spec's weights
    assert (
        decide(answers(inf=0.0, sup=0.3), spec, score_levels=LEVELS).action is ActionCode.DOWNWEIGHT
    )
    strict = PolicyThresholds(downweight_below=0.99)
    assert (
        decide(answers(templated=0.2), strict, score_levels=LEVELS).action is ActionCode.DOWNWEIGHT
    )


def test_later_copy_rule_keeps_first_and_exempts_short_texts() -> None:
    from app.decide.policy import is_later_copy

    assert not is_later_copy(5, 5, 20, 8)  # the first copy is kept
    assert not is_later_copy(6, -1, 20, 8)  # not a duplicate
    assert not is_later_copy(6, 5, 3, 8)  # "good game": too short to be copying evidence
    assert is_later_copy(6, 5, 20, 8)


@pytest.mark.parametrize(
    ("policy_action", "copy_action", "expected"),
    [
        (ActionCode.KEEP, "DOWNWEIGHT", ActionCode.DOWNWEIGHT),  # the copy rule is a floor
        (ActionCode.DOWNWEIGHT, "DOWNWEIGHT", ActionCode.DOWNWEIGHT),
        (ActionCode.FLAG, "DOWNWEIGHT", ActionCode.FLAG),  # "needs a human" is not hidden
        (ActionCode.EXCLUDE, "DOWNWEIGHT", ActionCode.EXCLUDE),  # a worse verdict still wins
        (ActionCode.KEEP, "EXCLUDE", ActionCode.EXCLUDE),
    ],
)
def test_duplicate_rule_is_a_floor(policy_action, copy_action, expected) -> None:
    from app.decide.policy import Decision, apply_duplicate_rule

    d = apply_duplicate_rule(Decision(policy_action, 0.8, ["LOW_INFO"]), copy_action)
    assert d.action is expected
    assert d.reasons == ["NEAR_DUPLICATE", "LOW_INFO"]
    assert d.integrity_score == 0.8  # the judged quality stays visible


def test_weighted_rating_and_n_eff() -> None:
    r = np.array([1.0, 0.0, 1.0, 0.0])
    w = np.array([1.0, 1.0, 1.0, 0.0])
    assert weighted_mean(r, w) == pytest.approx(2 / 3)
    assert n_eff(w) == pytest.approx(3.0)
    assert n_eff(np.ones(10)) == pytest.approx(10.0)


def test_bootstrap_ci_brackets_the_estimate() -> None:
    rng = np.random.default_rng(0)
    r = (rng.random(5000) < 0.3).astype(float)
    w = np.where(rng.random(5000) < 0.2, 0.25, 1.0)
    lo, hi = bootstrap_ci(r, w, resamples=500)
    est = weighted_mean(r, w)
    assert lo < est < hi
    assert hi - lo < 0.05
    assert bootstrap_ci(r, w, resamples=500) == (lo, hi)  # seeded, reproducible


@pytest.mark.parametrize(
    ("pct", "n", "label"),
    [
        (0.97, 1000, "Overwhelmingly Positive"),
        (0.97, 300, "Very Positive"),
        (0.85, 30, "Positive"),
        (0.75, 1000, "Mostly Positive"),
        (0.55, 1000, "Mixed"),
        (0.30, 1000, "Mostly Negative"),
        (0.10, 30, "Negative"),
        (0.10, 300, "Very Negative"),
        (0.10, 1000, "Overwhelmingly Negative"),
        (0.50, 5, None),
    ],
)
def test_steam_labels(pct: float, n: int, label: str | None) -> None:
    assert steam_label(pct, n) == label
