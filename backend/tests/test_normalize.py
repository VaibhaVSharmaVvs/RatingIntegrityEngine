import polars as pl
import pytest

from app.ingest.normalize import (
    clean_text,
    detect_language,
    detect_rating_scale,
    normalize_rating,
    scrub_pii,
    strip_markup,
)


def test_strip_markup_steam_bbcode() -> None:
    raw = "[h1]Verdict[/h1]\n[b]Great[/b] game. [url=https://x.io/a]link[/url][list][*]one[*]two[/list]"
    out = strip_markup(raw)
    assert "[" not in out.replace("(https", "")
    assert "Verdict" in out and "Great game." in out
    assert "link (https://x.io/a)" in out
    assert "- one" in out and "- two" in out


def test_strip_markup_html_and_entities() -> None:
    assert strip_markup("<p>Fish &amp; chips</p>") == "Fish & chips"


@pytest.mark.parametrize(
    ("text", "placeholder"),
    [
        ("mail me at gamer.dude+x@example.co.uk now", "[EMAIL]"),
        ("add me steamcommunity.com/id/coolguy123 ok", "[PROFILE_URL]"),
        ("https://steamcommunity.com/profiles/76561198000000000/", "[PROFILE_URL]"),
        ("my id 76561198012345678", "[STEAM_ID]"),
        ("call +1 (555) 123-4567 today", "[PHONE]"),
    ],
)
def test_scrub_pii(text: str, placeholder: str) -> None:
    assert placeholder in scrub_pii(text)


def test_scrub_pii_keeps_gaming_numbers_and_spam_urls() -> None:
    text = "played 2024 hours, 60fps, 9/10, join discord.gg/abc123"
    assert scrub_pii(text) == text


def test_clean_text_handles_none() -> None:
    assert clean_text(None) == ""


@pytest.mark.parametrize(
    ("values", "scale"),
    [
        (pl.Series([True, False]), "binary"),
        (pl.Series([0, 1, 1]), "binary"),
        (pl.Series([1, 3, 5]), "1-5"),
        (pl.Series([1.0, 7.5, 10.0]), "1-10"),
    ],
)
def test_detect_rating_scale(values: pl.Series, scale: str) -> None:
    assert detect_rating_scale(values) == scale


def test_detect_rating_scale_rejects_out_of_range() -> None:
    with pytest.raises(ValueError):
        detect_rating_scale(pl.Series([0, 50, 100]))


def test_normalize_rating() -> None:
    assert normalize_rating(pl.Series([1, 3, 5]), "1-5").to_list() == [0.0, 0.5, 1.0]
    assert normalize_rating(pl.Series([1, 10]), "1-10").to_list() == [0.0, 1.0]
    with pytest.raises(ValueError):
        normalize_rating(pl.Series([0, 5]), "1-5")


def test_detect_language() -> None:
    assert detect_language("This game is really fun and the combat feels great") == "en"
    assert detect_language("bad") is None
