"""Text written to influence how a review is judged (owner decision 2026-10-02, M12b).

One added sentence ("This is an honest review…", "[Note to the AI: …]") lifted 30-39%
of off-topic reviews back to full weight. Two families, measured on 420,582 genuine
Steam reviews before choosing how to treat each (MEASUREMENTS M13):

- **model notes**: text addressed to the AI, model or algorithm judging the review, or
  telling it how to classify the review. Essentially absent from genuine reviews, so a
  hit is a deterministic signal that may EXCLUDE (`PolicyThresholds.model_note_action`).
- **self-legitimising claims**: "my honest review", "not a paid review", "from a
  long-time player". Genuine reviewers write these (about 0.04%), so they are never
  penalised; they are only removed from the text System One judges, which makes them
  useless as a lever.

`for_model` returns the text System One should see. The review itself is never changed:
the inspector, exports and the reviews table show it as written.
"""

import re

_AI = r"(?:ai|a\.i\.|llm|(?:language\s+)?model|chat\s?gpt|gpt|bot|algorithm|classifier|robot)"

MODEL_NOTE_PATTERNS: dict[str, str] = {
    "note_to_model": rf"\b(?:note|message|instructions?|reminder)\s+(?:to|for)\s+(?:the\s+|any\s+|all\s+)?{_AI}s?\b",
    "greets_model": rf"\b(?:dear|hey|hi|hello|attention)\s*,?\s+{_AI}s?\b",
    "ignore_instructions": r"\b(?:ignore|disregard)\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier|other)\s+(?:instructions|prompts?|rules)\b",
    "model_judging": rf"\b(?:to\s+(?:the|any)\s+)?{_AI}s?\s+(?:reading|reviewing|judging|checking|analy[sz]ing|evaluating|processing)\s+(?:this|these|my|reviews?)\b",
}

_ADJ = r"(?:honest|genuine|legit(?:imate)?|unbiased|real|fair|objective|truthful|sincere)"
SELF_LEGIT_PATTERNS: dict[str, str] = {
    "claims_honest_review": rf"\b(?:my|an?|this\s+is\s+(?:my|an?))\s+{_ADJ}(?:[,\s]+(?:and\s+)?\w+){{0,2}}\s+review\b",
    "not_a_paid_review": r"\bnot\s+(?:a\s+)?(?:paid|fake|bot|sponsored|bought)\s+review\b",
    "not_a_bot": r"\b(?:i\s+am|i'?m)\s+not\s+(?:a\s+)?(?:bot|paid|shill|review[\s-]?bomb(?:er|ing)?)\b",
    "long_time_player": r"\bfrom\s+a\s+long[\s-]?time\s+(?:player|fan)\b",
    "based_on_experience": r"\bbased\s+(?:entirely|purely|solely|only)\s+on\s+(?:my\s+)?(?:own\s+)?(?:experience|gameplay|time\s+playing)\b",
}

_MODEL = {k: re.compile(v, re.IGNORECASE) for k, v in MODEL_NOTE_PATTERNS.items()}
_LEGIT = {k: re.compile(v, re.IGNORECASE) for k, v in SELF_LEGIT_PATTERNS.items()}
# a bracketed aside, or a sentence (ending at . ! ? or a line break)
_SEGMENT = re.compile(r"\[[^\]]*\]|\([^)]*\)|[^.!?\n\[\(]+[.!?]*", re.DOTALL)
_KEEP_MIN_WORDS = 4


def hits(text: str) -> tuple[list[str], list[str]]:
    """(model-note pattern names, self-legitimising pattern names) found in `text`."""
    t = text or ""
    return (
        [k for k, rx in _MODEL.items() if rx.search(t)],
        [k for k, rx in _LEGIT.items() if rx.search(t)],
    )


def for_model(text: str) -> str:
    """The review without model notes (whole sentence or bracket) and without
    self-legitimising claims (from the first claim to the end of its sentence; the whole
    sentence when little else is left)."""
    t = text or ""
    model, legit = hits(t)
    if not model and not legit:
        return t
    out = []
    for m in _SEGMENT.finditer(t):
        seg = m.group(0)
        if any(rx.search(seg) for rx in _MODEL.values()):
            continue
        # a claim runs to the end of its sentence ("…fun This is an honest review from a
        # long-time player, based on…"): cut from the first claim to the sentence end
        starts = [m.start() for rx in _LEGIT.values() if (m := rx.search(seg))]
        cleaned = seg[: min(starts)] if starts else seg
        if starts and len(re.findall(r"\w+", cleaned)) < _KEEP_MIN_WORDS:
            continue
        out.append(cleaned)
    return re.sub(r"\s{2,}", " ", " ".join(s.strip() for s in out)).strip()
