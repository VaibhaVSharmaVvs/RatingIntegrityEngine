"""Review normalisation (MVP_SPEC §6.1): markup, PII scrub, ratings, language, authors.

PII scrub runs before any text is stored or sent to a System One backend
(PLAN Phase 1 compliance flag). It replaces emails, phone numbers, SteamID64s and
Steam profile URLs with placeholders. Other URLs are kept: they are spam evidence.
"""

import hashlib
import html
import re
from functools import lru_cache
from typing import Literal

import polars as pl

RatingScale = Literal["binary", "1-5", "1-10"]

# --- markup -------------------------------------------------------------------------

_BB_URL = re.compile(r"\[url=([^\]]+)\](.*?)\[/url\]", re.IGNORECASE | re.DOTALL)
_BB_IMG = re.compile(r"\[img\].*?\[/img\]", re.IGNORECASE | re.DOTALL)
_BB_LIST_ITEM = re.compile(r"\[\*\]")
_BB_TAG = re.compile(r"\[/?[a-z0-9]+(?:=[^\]]*)?\]", re.IGNORECASE)
_HTML_TAG = re.compile(r"<[^>]+>")
_SPACES = re.compile(r"[ \t]+")
_BLANK_LINES = re.compile(r"\n{3,}")


def strip_markup(text: str) -> str:
    """Remove Steam BBCode and HTML, keeping link targets and list structure."""
    text = _BB_URL.sub(lambda m: f"{m.group(2)} ({m.group(1)})", text)
    text = _BB_IMG.sub("", text)
    text = _BB_LIST_ITEM.sub("\n- ", text)
    text = _BB_TAG.sub("", text)
    text = _HTML_TAG.sub("", text)
    text = html.unescape(text).replace("\r\n", "\n")
    text = _SPACES.sub(" ", text)
    text = _BLANK_LINES.sub("\n\n", text)
    return text.strip()


# --- PII ----------------------------------------------------------------------------

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_STEAM_PROFILE = re.compile(
    r"(?:https?://)?steamcommunity\.com/(?:id|profiles)/[^\s)\]]+", re.IGNORECASE
)
_STEAMID64 = re.compile(r"\b7656119\d{10}\b")
# 9+ digits with optional separators, optionally with a leading +. Avoids plain years,
# playtimes and scores, which are short.
_PHONE = re.compile(r"(?<![\w.])\+?\d(?:[\s().-]{0,2}\d){8,14}(?![\w.])")


def scrub_pii(text: str) -> str:
    text = _EMAIL.sub("[EMAIL]", text)
    text = _STEAM_PROFILE.sub("[PROFILE_URL]", text)
    text = _STEAMID64.sub("[STEAM_ID]", text)
    return _PHONE.sub("[PHONE]", text)


def clean_text(text: str | None) -> str:
    return scrub_pii(strip_markup(text or ""))


# --- ratings ------------------------------------------------------------------------


def detect_rating_scale(values: pl.Series) -> RatingScale:
    """Guess the scale from observed values; the user confirms it in the UI."""
    if values.dtype == pl.Boolean:
        return "binary"
    v = values.drop_nulls().cast(pl.Float64)
    if v.is_empty():
        raise ValueError("rating column has no values")
    lo, hi = v.min(), v.max()
    if set(v.unique().to_list()) <= {0.0, 1.0}:
        return "binary"
    if lo >= 1 and hi <= 5:
        return "1-5"
    if lo >= 1 and hi <= 10:
        return "1-10"
    raise ValueError(f"cannot infer rating scale from range [{lo}, {hi}]")


def normalize_rating(values: pl.Series, scale: RatingScale) -> pl.Series:
    v = values.cast(pl.Float64)
    if scale == "binary":
        return v
    lo, hi = (1.0, 5.0) if scale == "1-5" else (1.0, 10.0)
    if v.drop_nulls().is_empty():
        return v
    if v.min() < lo or v.max() > hi:
        raise ValueError(f"ratings outside {scale}: [{v.min()}, {v.max()}]")
    return (v - lo) / (hi - lo)


# --- authors and language -----------------------------------------------------------


def hash_author(author_id: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}{author_id}".encode()).hexdigest()


STEAM_LANGUAGES = {"english": "en", "german": "de", "french": "fr", "spanish": "es"}


@lru_cache(maxsize=1)
def _detector():
    from lingua import Language, LanguageDetectorBuilder

    languages = [
        Language.ENGLISH,
        Language.SPANISH,
        Language.PORTUGUESE,
        Language.FRENCH,
        Language.GERMAN,
        Language.ITALIAN,
        Language.RUSSIAN,
        Language.POLISH,
        Language.TURKISH,
        Language.CHINESE,
        Language.JAPANESE,
        Language.KOREAN,
    ]
    return LanguageDetectorBuilder.from_languages(*languages).build()


def detect_language(text: str, min_chars: int = 20) -> str | None:
    """ISO 639-1 code, or None when the text is too short to tell."""
    if len(text) < min_chars:
        return None
    lang = _detector().detect_language_of(text)
    return lang.iso_code_639_1.name.lower() if lang else None
