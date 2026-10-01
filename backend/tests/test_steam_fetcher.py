import json
from pathlib import Path

import pytest

from app.ingest.steam_fetcher import PullState, SteamFetcher, load_pull, to_record

SALT = "test-salt"


def raw_review(rid: int, ts: int) -> dict:
    return {
        "recommendationid": str(rid),
        "author": {
            "steamid": f"7656119{rid:010d}",
            "personaname": "SomeGamer",
            "profile_url": "https://steamcommunity.com/profiles/x",
            "avatar": "abc",
            "num_reviews": 1,
            "playtime_at_review": 12,
        },
        "review": f"review {rid}",
        "timestamp_created": ts,
        "voted_up": False,
        "weighted_vote_score": "0.5",
        "hardware": {"cpu_name": "x"},
    }


def test_to_record_drops_pii_and_hashes_author() -> None:
    rec = to_record(raw_review(1, 100), SALT)
    flat = json.dumps(rec)
    assert "7656119" not in flat
    assert "SomeGamer" not in flat
    assert "steamcommunity" not in flat
    assert "hardware" not in rec and "cpu_name" not in flat
    assert len(rec["author_hash"]) == 64
    assert rec["weighted_vote_score"] == 0.5
    assert rec["author_playtime_at_review"] == 12


def test_default_salt_is_refused(tmp_path: Path) -> None:
    with pytest.raises(SystemExit):
        SteamFetcher(PullState(1, 0, 1, "english"), tmp_path, "change-me")


class FakeFetcher(SteamFetcher):
    """Pages newest-first: ts 1000, 999, ... in pages of 3."""

    def __init__(self, *args, pages: list[list[int]], **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.fake_pages = pages
        self.rate_s = 0
        self.slept: list[float] = []

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)

    def fetch_page(self, cursor: str) -> dict:
        i = 0 if cursor == "*" else int(cursor)
        page = self.fake_pages[i] if i < len(self.fake_pages) else []
        return {"reviews": [raw_review(ts, ts) for ts in page], "cursor": str(i + 1)}


def test_run_keeps_only_window_and_stops_past_it(tmp_path: Path) -> None:
    pages = [[1000, 999, 998], [997, 996, 995], [994, 993, 992], [991, 990, 989]]
    state = PullState(appid=1, from_ts=993, to_ts=998, language="english")
    FakeFetcher(state, tmp_path, SALT, pages=pages).run(flush_every=1)

    df = load_pull(tmp_path)
    assert sorted(df["timestamp_created"].to_list()) == [993, 994, 995, 996, 997, 998]
    saved = json.loads((tmp_path / "state.json").read_text())
    assert saved["done"] is True
    assert saved["pages"] == 3  # page 3 already reaches past the window start


def test_run_stops_on_repeated_cursor(tmp_path: Path) -> None:
    class Looping(FakeFetcher):
        def fetch_page(self, cursor: str) -> dict:
            return {"reviews": [raw_review(5, 5)], "cursor": "same"}

    state = PullState(appid=1, from_ts=0, to_ts=10, language="english")
    fetcher = Looping(state, tmp_path, SALT, pages=[])
    fetcher.run(flush_every=1)
    assert fetcher.state.pages == 2
    assert fetcher.state.end_reason == "exhausted"


def test_transient_empty_page_is_retried_not_treated_as_end(tmp_path: Path) -> None:
    class Flaky(FakeFetcher):
        calls = 0

        def fetch_page(self, cursor: str) -> dict:
            self.calls += 1
            if cursor == "1" and self.calls == 2:  # first try at page 2 comes back empty
                return {"reviews": [], "cursor": "1"}
            return super().fetch_page(cursor)

    pages = [[10, 9], [8, 7], [6, 5]]
    state = PullState(appid=1, from_ts=6, to_ts=10, language="english")
    fetcher = Flaky(state, tmp_path, SALT, pages=pages)
    fetcher.run(flush_every=1)
    assert fetcher.state.end_reason == "past_window"
    assert sorted(load_pull(tmp_path)["timestamp_created"].to_list()) == [6, 7, 8, 9, 10]
    assert 30 in fetcher.slept


def test_resume_continues_a_pull_that_ended_early(tmp_path: Path) -> None:
    early = PullState(appid=1, from_ts=0, to_ts=10, language="english", cursor="1", pages=1)
    early.done, early.end_reason = True, None  # legacy: no end reason recorded
    (tmp_path / "state.json").write_text(json.dumps(early.__dict__))
    fresh = PullState(appid=1, from_ts=0, to_ts=10, language="english")
    fetcher = SteamFetcher.resume_or_new(fresh, tmp_path, SALT)
    assert fetcher.state.done is False
    assert fetcher.state.cursor == "1"


def test_resume_trusts_a_recorded_exhausted_end(tmp_path: Path) -> None:
    done = PullState(appid=1, from_ts=0, to_ts=10, language="english", cursor="1", pages=3)
    done.done, done.end_reason = True, "exhausted"
    (tmp_path / "state.json").write_text(json.dumps(done.__dict__))
    fresh = PullState(appid=1, from_ts=0, to_ts=10, language="english")
    assert SteamFetcher.resume_or_new(fresh, tmp_path, SALT).state.done is True
