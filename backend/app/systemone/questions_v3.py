"""Question set v3: v2 plus `about_game` (owner decision 2026-10-01).

`about_game` separates reviews about the game itself from reviews aimed only at the
company, its owner, politics or other products (e.g. "F*** Sony" with no word about
the game). It is the basis of the OFF_TOPIC penalty, Steam's own standard for
off-topic review bombs.

Requirements that change whether or how you can play (a mandatory account, region
locks, DRM) count as *about the game*: "PSN is now required and blocks my country"
describes the product, while "Sony is greedy" does not.
"""

from app.systemone.questions_v2 import QUESTIONS as V2
from app.systemone.questions_v2 import TOPICS, build_state, verdict_words

__all__ = ["QUESTIONS", "TOPICS", "VERSION", "build_state", "verdict_words"]

VERSION = "v3"

QUESTIONS: dict[str, dict] = {
    **V2,
    "about_game": {
        "type": "noul",
        "instructions": (
            "Is `review` about the game itself: its gameplay, content, story, performance, "
            "price or value, or how a requirement (such as a mandatory account, region lock "
            "or DRM) affects playing it? Answer false if `review` is only about the company, "
            "publisher or its owner, politics, other products, or events outside the game, "
            "with nothing about the game."
        ),
        "criteria": {
            "true": "says something about the game or about playing it, even briefly or as a joke about the game",
            "false": "only about the company, politics, other products or outside events",
        },
    },
}
