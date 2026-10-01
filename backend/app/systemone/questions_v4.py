"""Question set v4: v3 plus `verdict_basis` for the platform-policy rating.

`verdict_basis` encodes Valve's definition of an off-topic review (Steam, 2019): a
verdict whose focus is "unrelated to the likelihood that future purchasers will be
happy if they buy the game", explicitly including DRM and EULA changes. It feeds the
*platform-policy* rating (Steam's rules emulated). The engine's own adjusted rating
keeps using `about_game`, which treats requirements that change the product as on-topic.

The two answer different questions on purpose:
- about_game: does the review say anything about the game? ("Love the game, hate the
  EULA" -> yes)
- verdict_basis: is the *verdict* driven by playing the game, or by the company, its
  terms or platform requirements? ("Love the game, hate the EULA" -> driven by terms)
"""

from app.systemone.questions_v3 import QUESTIONS as V3
from app.systemone.questions_v3 import TOPICS, build_state, verdict_words

__all__ = ["QUESTIONS", "TOPICS", "VERSION", "build_state", "verdict_words"]

VERSION = "v4"

QUESTIONS: dict[str, dict] = {
    **V3,
    "verdict_basis": {
        "type": "noul",
        "instructions": (
            "The reviewer's verdict is `verdict`. Is that verdict based on the experience of "
            "playing the game (its gameplay, content, story, performance, bugs, or value for "
            "money)? Answer false if the verdict is mainly driven by something else: the "
            "company or publisher's conduct, terms of service or EULA changes, DRM, mandatory "
            "accounts or platform requirements, politics, other products, or events outside "
            "the game."
        ),
        "criteria": {
            "true": "the verdict rests on what playing the game is like",
            "false": "the verdict rests mainly on the company, its terms or requirements, politics or outside events",
        },
    },
}
