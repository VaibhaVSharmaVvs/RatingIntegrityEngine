"""Per-review decision policy (MVP_SPEC §6.5), with every number from run config.

Duplicates (owner decision, 2026-09-30): a later copy of an earlier review is
DOWNWEIGHTed by default, not EXCLUDEd, and it is still judged by System One. The copy
rule sets a floor: a worse model-based action (FLAG, EXCLUDE) still wins. Phase 4
escalates copies that fall inside a detected burst, where copying is evidence of
coordination. Phase 4 also adds the cluster penalty and the grey-zone FLAG.

Account signals (low playtime, single-review account) are deliberately *not* used
per review: plenty of genuine reviewers are new or short-playtime. They feed cluster
suspicion in Phase 4, where a concentration of them is evidence.

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


def is_later_copy(review_id: int, dup_of: int, n_tokens: int, min_tokens: int) -> bool:
    """A later copy of an earlier review ("keep the first", MVP_SPEC §6.5).

    Short texts are exempt: "good game" repeated by independent reviewers is not
    evidence of copying. Those are judged on informativeness like any other review.
    """
    return dup_of >= 0 and dup_of != review_id and n_tokens >= min_tokens


# How severe an action is when two rules disagree. FLAG ranks above DOWNWEIGHT: an
# unresolved "needs a human" must not be silently turned into a weight.
_SEVERITY = {
    ActionCode.KEEP: 0,
    ActionCode.DOWNWEIGHT: 1,
    ActionCode.FLAG: 2,
    ActionCode.EXCLUDE: 3,
}


def apply_duplicate_rule(decision: Decision, copy_action: str) -> Decision:
    """Combine a per-review decision with the later-copy rule: the stricter wins.

    The integrity score is left as the model/heuristics computed it, so a copy of a
    detailed review still shows high informativeness in the inspector; the copy is
    visible through its action and the NEAR_DUPLICATE reason.
    """
    floor = ActionCode[copy_action]
    action = max(decision.action, floor, key=_SEVERITY.__getitem__)
    reasons = ["NEAR_DUPLICATE", *[r for r in decision.reasons if r != "NEAR_DUPLICATE"]][:3]
    return Decision(action, decision.integrity_score, reasons)


def decide_heuristic(
    *, n_tokens: int, emoji_ratio: float, has_promo: bool, low_info_max_tokens: int
) -> Decision:
    """Heuristics-only baseline (ablation a): no System One. Conservative on purpose:
    a regex promo hit goes to a human (FLAG), never straight to EXCLUDE."""
    low_info = n_tokens <= low_info_max_tokens or emoji_ratio > 0.5
    if has_promo:
        return Decision(ActionCode.FLAG, 0.5, ["SPAM"])
    if low_info:
        return Decision(ActionCode.DOWNWEIGHT, 0.4, ["LOW_INFO"])
    return Decision(ActionCode.KEEP, 1.0, [])


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


def apply_cluster_rules(
    base: Decision,
    *,
    suspicion: float,
    cluster_kind: str | None,
    later_copy: bool,
    thresholds: PolicyThresholds,
) -> Decision:
    """S4 (MVP_SPEC §6.5): penalise members of a suspicious burst/cluster.

    - integrity x (1 - strength x suspicion) when suspicion > threshold;
    - the penalised score is re-thresholded; the stricter of that and `base` wins;
    - a later copy inside a suspicious burst/cluster gets `duplicate_in_burst_action`
      (outside one it stays at the S2 floor, DOWNWEIGHT by default);
    - optional grey-zone FLAG around the DOWNWEIGHT threshold.
    System One alone still cannot EXCLUDE: the only EXCLUDE added here needs a
    deterministic copy *and* a suspicious cluster.
    """
    t = thresholds
    if cluster_kind is None or suspicion <= t.cluster_penalty_threshold:
        return base
    penalised = base.integrity_score * (1.0 - t.cluster_penalty_strength * suspicion)
    by_score = ActionCode.DOWNWEIGHT if penalised < t.downweight_below else ActionCode.KEEP
    action = max(base.action, by_score, key=_SEVERITY.__getitem__)
    if later_copy:
        action = max(action, ActionCode[t.duplicate_in_burst_action], key=_SEVERITY.__getitem__)
    if (
        t.grey_zone_width > 0
        and action is not ActionCode.EXCLUDE
        and abs(penalised - t.downweight_below) <= t.grey_zone_width
    ):
        action = ActionCode.FLAG
    code = "BURST_WINDOW" if cluster_kind == "burst" else "COORDINATED_CLUSTER"
    reasons = [code, *[r for r in base.reasons if r != code]][:3]
    return Decision(action, penalised, reasons)
