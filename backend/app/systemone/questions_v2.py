"""Question set v2: v1 with three changes from dev-set review (MEASUREMENTS M8).

1. `informativeness` measures specificity whatever the subject. v1 asked for
   information "about the game", so a precise platform-policy complaint scored low
   and got LOW_INFO, double-counting what `topic` already captures.
2. `templated` means copied / reusable text. In v1 it tracked shortness: "good game"
   scored 0.88 and 108/200 dev reviews carried both LOW_INFO and TEMPLATED.
3. `rating_support` states that a mixed review can still support its verdict.

State, verdict wording and topics are unchanged (shared with v1).
"""

from app.systemone.questions_v1 import QUESTIONS as V1
from app.systemone.questions_v1 import TOPICS, build_state, verdict_words

__all__ = ["QUESTIONS", "TOPICS", "VERSION", "build_state", "verdict_words"]

VERSION = "v2"

QUESTIONS: dict[str, dict] = {
    "informativeness": {
        "type": "score",
        "instructions": (
            "How specific and concrete is `review`? Count concrete facts, experiences, "
            "examples or reasons, whatever they are about: gameplay, performance, content, "
            "price, platform or account requirements, or the developer's decisions."
        ),
        "criteria": [
            {
                "what": "none: no concrete content at all",
                "examples": ["a single word or emoji", "a slogan or meme phrase", "an insult"],
            },
            {
                "what": "minimal: an opinion with no specifics",
                "examples": ["it's fun", "not worth it", "great game, love it"],
            },
            {
                "what": "some specifics: names at least one concrete aspect, fact or reason",
                "examples": [
                    "the servers keep crashing",
                    "requires linking a separate account to play",
                ],
            },
            {
                "what": "detailed: several concrete aspects, facts or reasons, with explanation",
                "examples": [
                    "explains which weapons were nerfed and how that changed missions",
                    "describes the account requirement, which countries it blocks, and why that matters",
                ],
            },
        ],
    },
    "rating_support": {
        "type": "score",
        "instructions": (
            "The reviewer's verdict is `verdict`. How well does `review` support that "
            "verdict? A review can praise some parts and criticise others and still clearly "
            "support its overall verdict."
        ),
        "criteria": V1["rating_support"]["criteria"],
    },
    "topic": V1["topic"],
    "spam_promo": V1["spam_promo"],
    "templated": {
        "type": "noul",
        "instructions": (
            "Is `review` copied or assembled from reusable text rather than written by the "
            "reviewer for this review? For example: a copypasta, song lyrics or a famous "
            "quote, a well-known slogan or meme catchphrase, or a fill-in-the-blanks review "
            "template. A short or generic opinion in the reviewer's own words, such as "
            "'good game' or 'pretty basic', is NOT templated."
        ),
        "criteria": {
            "true": "copied, quoted or template text not written for this review",
            "false": "the reviewer's own words, however short, generic or rude",
        },
    },
    "campaign_language": V1["campaign_language"],
}
