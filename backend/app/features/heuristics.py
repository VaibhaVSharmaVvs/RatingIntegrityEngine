"""S1 text heuristics and account signals (MVP_SPEC §6.2). Vectorised with Polars.

Every column here is a plain measurement. Deciding what they mean is S4's job.
"""

import json

import polars as pl

from app.features import influence
from app.models import FeatureConfig

# Named so the inspector can show *which* pattern fired, not just "promo".
# Strong patterns set `has_promo`, which can contribute to an EXCLUDE (with a System
# One spam judgment), so each must be specific to advertising something other than
# the reviewer's own opinion.
PROMO_PATTERNS: dict[str, str] = {
    "discord_invite": r"discord\.(?:gg|com/invite)/\w+",
    "telegram_link": r"\bt\.me/\w+",
    "url_shortener": r"\b(?:bit\.ly|tinyurl\.com|goo\.gl|cutt\.ly|rb\.gy)/\w+",
    "key_reseller": r"\b(?:g2a|kinguin|eneba|instant-gaming)\.com\b",
    # Not "free game(s)" or "free skins": in a game with premium currency those are
    # ordinary opinion vocabulary (all 3 such hits on real HD2 reviews were genuine).
    "free_keys": r"\bfree\s+(?:steam\s+)?(?:keys?|codes?)\b",
    "giveaway": r"\b(?:key|skin|steam)\s+giveaways?\b|\bgiveaway\s+(?:at|on|in)\b",
    "promo_code": r"\b(?:promo|referral|discount|coupon)\s+codes?\b|\buse\s+(?:my\s+)?code\b",
    "trade_offer": r"\btrade\s+(?:offers?|me|with\s+me)\b|\bsteamcommunity\.com/tradeoffer\b",
    # Not "buy credits/coins": players discuss the game's own premium currency.
    "boosting": r"\b(?:cheap|buy)\s+(?:accounts?|boosting)\b|\bboosting\s+services?\b",
}

# Weak: recorded in `promo_hits` for the inspector but NOT counted as promo. On real
# Gollum reviews every stream-link hit (5 of 297) was a genuine reviewer linking their
# own video review (MEASUREMENTS M5f).
SELF_PROMO_PATTERNS: dict[str, str] = {
    "self_promo": r"\b(?:check\s+out|subscribe\s+to|follow)\s+my\s+(?:channel|stream|twitch|youtube|profile|group)\b",
    "stream_link": r"\b(?:twitch\.tv|youtube\.com/(?:@|c/|channel/)|youtu\.be)/?\w+",
}

_URL = r"(?:https?://|www\.)\S+|\b[\w-]+\.(?:com|net|org|gg|io|me|tv|ly)/\S*"
# Letters and digits in any script, whitespace, and ordinary punctuation are "text";
# anything else (emoji, box drawing, ASCII-art symbols) counts toward the symbol ratio.
_NON_TEXT = r"[^\p{L}\p{N}\s.,!?;:'\"()\-]"


def text_features(texts: pl.Series) -> pl.DataFrame:
    s = texts.fill_null("")
    lower = s.str.to_lowercase()
    words = lower.str.extract_all(r"\w+")
    n_tokens = words.list.len()
    n_chars = s.str.len_chars()
    promo = pl.DataFrame({name: lower.str.contains(rx) for name, rx in PROMO_PATTERNS.items()})
    patterns = {**PROMO_PATTERNS, **SELF_PROMO_PATTERNS}
    matched = pl.DataFrame({name: lower.str.contains(rx) for name, rx in patterns.items()})
    hits = [
        json.dumps([name for name, hit in zip(matched.columns, row, strict=True) if hit])
        for row in matched.iter_rows()
    ]
    influence_found = [influence.hits(t) for t in s.to_list()]
    return pl.DataFrame(
        {
            "n_tokens": n_tokens.cast(pl.Int32),
            "type_token_ratio": pl.Series(
                [len(set(w)) / len(w) if w else 0.0 for w in words.to_list()]
            ),
            "emoji_ratio": (
                s.str.count_matches(_NON_TEXT).cast(pl.Float64) / n_chars.clip(lower_bound=1)
            ),
            "max_char_run": pl.Series([_max_run(t) for t in s.to_list()], dtype=pl.Int32),
            "has_url": s.str.contains(_URL),
            "has_promo": promo.select(pl.any_horizontal(pl.all())).to_series(),
            "promo_hits": pl.Series(hits, dtype=pl.String),
            # text written to influence the judgment (features/influence.py)
            "model_note": pl.Series([bool(m) for m, _ in influence_found], dtype=pl.Boolean),
            "influence_hits": pl.Series(
                [json.dumps(m + legit) for m, legit in influence_found], dtype=pl.String
            ),
        }
    )


def _max_run(text: str) -> int:
    best = run = 0
    prev = None
    for ch in text:
        run = run + 1 if ch == prev else 1
        best = max(best, run)
        prev = ch
    return best


def account_features(meta: pl.Series, cfg: FeatureConfig) -> pl.DataFrame:
    """Steam account signals from `reviews.meta`; all null for sources without them."""
    parsed = meta.fill_null("{}").str.json_decode(
        pl.Struct(
            {
                "author_playtime_at_review": pl.Int64,
                "author_num_reviews": pl.Int64,
                "received_for_free": pl.Boolean,
                "steam_purchase": pl.Boolean,
            }
        )
    )
    f = parsed.struct.unnest()
    return pl.DataFrame(
        {
            "low_playtime": f["author_playtime_at_review"] < cfg.low_playtime_minutes,
            "single_review_account": f["author_num_reviews"] <= 1,
            "received_for_free": f["received_for_free"],
            "not_purchased": ~f["steam_purchase"],
        }
    )
