"""Per-review decision policy (MVP_SPEC §6.5), with every number from run config.

Phase 1 implements the per-review part. Phase 4 adds the cluster penalty, the
grey-zone FLAG and the deterministic duplicate EXCLUDE.

Deliberate deviation from the spec: the spec EXCLUDEs on `spam_promo > 0.9` alone.
That would let a System One answer exclude a review by itself, which the research
(adversarial sensitivity) and CLAUDE.md rule out. Here a high spam answer EXCLUDEs
only when a deterministic promo signal agrees; otherwise it FLAGs for a human.
"""

from dataclasses import dataclass, field

from app.models import ActionCode, PolicyThresholds

OFFTOPIC_TOPICS = ("off_topic", "joke_meme")


@dataclass
class Decision:
    action: ActionCode
    integrity_score: float
    reasons: list[str] = field(default_factory=list)


def _norm_score(answer: dict, levels: int) -> float:
    return float(answer["score"]) / (levels - 1)


def decide(
    answers: dict[str, dict],
    thresholds: PolicyThresholds,
    *,
    score_levels: dict[str, int],
    has_promo: bool = False,
) -> Decision:
    t = thresholds
    informativeness = _norm_score(answers["informativeness"], score_levels["informativeness"])
    support = _norm_score(answers["rating_support"], score_levels["rating_support"])
    spam = float(answers["spam_promo"]["noul"])
    templated = float(answers["templated"]["noul"])
    topic_probs = answers["topic"].get("probabilities", {})
    offtopic = float(sum(topic_probs.get(k, 0.0) for k in OFFTOPIC_TOPICS))

    contributions = {
        "LOW_INFO": t.w_informativeness * (1 - informativeness),
        "UNSUPPORTED_VERDICT": t.w_rating_support * (1 - support),
        "SPAM": t.w_spam * spam,
        "TEMPLATED": t.w_templated * templated,
        "OFF_TOPIC": t.w_offtopic * offtopic,
    }
    score = max(0.0, 1.0 - sum(contributions.values()))
    reasons = [
        code
        for code, c in sorted(contributions.items(), key=lambda kv: -kv[1])
        if c >= t.reason_min_contribution
    ][:3]

    low_conf = sum(
        1
        for a in answers.values()
        if a.get("confidence") is not None
        and a["confidence"] < t.low_confidence
        and a["type"] != "noul"
    )
    if spam > t.spam_exclude and has_promo:
        return Decision(
            ActionCode.EXCLUDE, score, ["SPAM", *[r for r in reasons if r != "SPAM"]][:3]
        )
    if spam > t.spam_exclude:
        return Decision(ActionCode.FLAG, score, ["SPAM", *[r for r in reasons if r != "SPAM"]][:3])
    if low_conf >= t.low_confidence_min_questions:
        return Decision(ActionCode.FLAG, score, ["LOW_CONFIDENCE", *reasons][:3])
    if score < t.downweight_below:
        return Decision(ActionCode.DOWNWEIGHT, score, reasons)
    return Decision(ActionCode.KEEP, score, reasons)
