"""Question set v1 (MVP_SPEC §6.3): six typed judgments per review.

State is kept minimal (Jev is distracted by irrelevant state): a context line, the
verdict in words, and the review text. Questions name the field they read in
backticks, the convention both Jev and Laya document.
"""

VERSION = "v1"

TOPICS = {
    "gameplay": "mechanics, combat, progression, fun factor, difficulty",
    "technical": "performance, bugs, crashes, servers, optimisation",
    "content_value": "amount of content, price versus value, replayability",
    "monetization": "microtransactions, premium currency, battle pass, pricing of add-ons",
    "platform_policy": "account requirements, platform linking, DRM, region locks, store policy",
    "developer_conduct": "communication, promises, decisions or behaviour of the developer or publisher",
    "off_topic": "unrelated to the game itself",
    "joke_meme": "a joke, meme, or copypasta with no real opinion",
}


_STAR_WORDS = ["very negative", "negative", "mixed", "positive", "very positive"]


def verdict_words(rating_raw: float | None, rating_norm: float | None, scale: str) -> str:
    """The rating in words: Jev reasons poorly about bare numbers (MVP_SPEC §2)."""
    if rating_norm is None:
        return "No rating given"
    if scale == "binary":
        return "Recommended" if rating_norm >= 0.5 else "Not recommended"
    band = _STAR_WORDS[min(4, int(rating_norm * 5))]
    top = 5 if scale == "1-5" else 10
    stars = f"{rating_raw:g}" if rating_raw is not None else "?"
    return f"{band.capitalize()} ({stars} of {top} stars)"


def build_state(subject: str, source: str, verdict: str, text: str) -> dict:
    platform = "Steam review" if source == "steam" else "Review"
    return {"context": f"{platform} of '{subject}'.", "verdict": verdict, "review": text}


QUESTIONS: dict[str, dict] = {
    "informativeness": {
        "type": "score",
        "instructions": "How much concrete, specific information about the game does `review` contain?",
        "criteria": [
            "none: noise, a meme, or a single word",
            "minimal: a vague opinion with no specifics",
            "some specifics: names at least one concrete aspect of the game",
            "detailed and specific: several concrete aspects with reasons or examples",
        ],
    },
    "rating_support": {
        "type": "score",
        "instructions": "The reviewer's verdict is `verdict`. How well does `review` support that verdict?",
        "criteria": [
            "contradicts it: the text argues the opposite verdict",
            "no support: the text gives no reason for the verdict",
            "partial support: some reasoning that fits the verdict",
            "clear support: the reasons given clearly justify the verdict",
        ],
    },
    "topic": {
        "type": "choice",
        "instructions": "What is `review` mainly about?",
        "criteria": TOPICS,
    },
    "spam_promo": {
        "type": "noul",
        "instructions": "Is `review` spam, advertising, or promotion of something other than an honest opinion of the game?",
        "criteria": {
            "true": "advertises a product, site, key giveaway, trade, group or referral",
            "false": "an opinion about the game, however short or rude",
        },
    },
    "templated": {
        "type": "noul",
        "instructions": "Does `review` read like generic, templated or copy-paste text rather than a personal experience?",
        "criteria": {
            "true": "boilerplate, a copypasta, or a fill-in-the-blanks template",
            "false": "written by a person about their own experience",
        },
    },
    "campaign_language": {
        "type": "noul",
        "instructions": "Does `review` reference or urge a collective action, such as review bombing, mass refunds, or pushing the score down?",
        "criteria": {
            "true": "calls on others to act together, or says it is part of such a campaign",
            "false": "only the reviewer's own opinion or action",
        },
    },
}
