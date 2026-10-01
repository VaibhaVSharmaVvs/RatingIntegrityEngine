"""Resumable backward pull of Steam reviews for a date window (MVP_SPEC §6.1).

Steam's `appreviews` endpoint pages newest-first by cursor and `day_range` only reaches
back 365 days from today, so historical windows are reached by paginating backwards
from now until reviews are older than `from`. Only in-window reviews are stored.

PII: `steamid` is salted-hashed; persona name, profile URL, avatar and hardware are
dropped before anything touches disk.

Usage (from backend/):
    uv run python -m app.ingest.steam_fetcher --appid 553850 --from 2024-04-01 --to 2024-06-30
"""

import argparse
import json
import logging
import time
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

import httpx
import polars as pl
from tenacity import retry, retry_if_exception, stop_after_delay, wait_exponential

from app.core.config import settings
from app.ingest.normalize import hash_author

log = logging.getLogger("steam_fetcher")

API = "https://store.steampowered.com/appreviews/{appid}"
DEFAULT_SALT = "change-me"
# Steam soft-throttles by returning success=1 with an empty page (or a repeated cursor).
# Treat that as "maybe throttled" and back off before believing the pull is exhausted.
EMPTY_PAGE_WAITS_S = (30, 60, 120, 300, 600)


class Throttled(Exception):
    """429 from Steam; `retry_after` is the server hint in seconds, if any."""

    def __init__(self, retry_after: float | None) -> None:
        super().__init__(f"429 Too Many Requests (retry_after={retry_after})")
        self.retry_after = retry_after


def _is_retryable(exc: BaseException) -> bool:
    if isinstance(exc, Throttled | httpx.TransportError):
        return True
    return isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code >= 500


def _wait_for_throttle(retry_state) -> float:
    exc = retry_state.outcome.exception()
    backoff = wait_exponential(min=30, max=600)(retry_state)
    if isinstance(exc, Throttled) and exc.retry_after:
        return max(exc.retry_after, backoff)
    return backoff


AUTHOR_FIELDS = ("num_games_owned", "num_reviews", "playtime_forever", "playtime_at_review")
REVIEW_FIELDS = (
    "language",
    "timestamp_created",
    "timestamp_updated",
    "voted_up",
    "votes_up",
    "votes_funny",
    "weighted_vote_score",
    "comment_count",
    "steam_purchase",
    "received_for_free",
    "refunded",
    "written_during_early_access",
    "primarily_steam_deck",
)


@dataclass
class PullState:
    appid: int
    from_ts: int
    to_ts: int
    language: str
    cursor: str = "*"
    pages: int = 0
    seen: int = 0
    stored: int = 0
    oldest_ts: int | None = None
    done: bool = False
    end_reason: str | None = None  # 'past_window' | 'exhausted'


def to_record(raw: dict, salt: str) -> dict:
    author = raw.get("author", {})
    record = {
        "ext_id": raw["recommendationid"],
        "author_hash": hash_author(author["steamid"], salt),
        "text": raw.get("review", ""),
    }
    record.update({f: raw.get(f) for f in REVIEW_FIELDS})
    record.update({f"author_{f}": author.get(f) for f in AUTHOR_FIELDS})
    # Steam returns this as float or string depending on the review.
    record["weighted_vote_score"] = float(record["weighted_vote_score"] or 0)
    return record


class SteamFetcher:
    def __init__(self, state: PullState, out_dir: Path, salt: str, rate_s: float = 1.0) -> None:
        if salt == DEFAULT_SALT:
            raise SystemExit("AUTHOR_HASH_SALT is the default; set a random value in .env first.")
        self.state = state
        self.out_dir = out_dir
        self.salt = salt
        self.rate_s = rate_s
        self.client = httpx.Client(timeout=30, headers={"User-Agent": "rie-research/0.1"})
        out_dir.mkdir(parents=True, exist_ok=True)

    @property
    def state_path(self) -> Path:
        return self.out_dir / "state.json"

    @classmethod
    def resume_or_new(cls, state: PullState, out_dir: Path, salt: str) -> "SteamFetcher":
        path = out_dir / "state.json"
        if path.exists():
            saved = PullState(**json.loads(path.read_text()))
            if (saved.from_ts, saved.to_ts, saved.language) != (
                state.from_ts,
                state.to_ts,
                state.language,
            ):
                raise SystemExit(f"{path} is for a different window; delete it to restart.")
            if saved.done and saved.end_reason is None:
                # Legacy pulls recorded no end reason and could have stopped on a throttled
                # empty page; carry on from the cursor. "exhausted" is only recorded after
                # the full empty-page backoff, so it is trusted.
                log.info("previous pull ended early (%s); continuing", saved.end_reason)
                saved.done = False
            log.info("resuming at page %d (%d stored)", saved.pages, saved.stored)
            state = saved
        return cls(state, out_dir, salt)

    @retry(
        retry=retry_if_exception(_is_retryable),
        wait=_wait_for_throttle,
        stop=stop_after_delay(3600),
        before_sleep=lambda rs: log.warning("retrying after: %s", rs.outcome.exception()),
        reraise=True,
    )
    def fetch_page(self, cursor: str) -> dict:
        r = self.client.get(
            API.format(appid=self.state.appid),
            params={
                "json": 1,
                "filter": "recent",
                "language": self.state.language,
                "num_per_page": 100,
                "purchase_type": "all",
                "filter_offtopic_activity": 0,
                "cursor": cursor,
            },
        )
        if r.status_code == 429:
            retry_after = r.headers.get("Retry-After")
            raise Throttled(float(retry_after) if retry_after else None)
        r.raise_for_status()
        body = r.json()
        if body.get("success") != 1:
            raise RuntimeError(f"Steam returned success={body.get('success')}")
        return body

    def save(self, buffer: list[dict]) -> None:
        if buffer:
            part = self.out_dir / f"part-{self.state.pages:06d}.parquet"
            pl.DataFrame(buffer, infer_schema_length=None).write_parquet(part)
        self.state_path.write_text(json.dumps(asdict(self.state), indent=2))

    def fetch_nonempty(self, cursor: str, seen_cursors: set[str]) -> dict:
        """Fetch a page, backing off while Steam returns empty pages or a repeated cursor."""
        for wait_s in (*EMPTY_PAGE_WAITS_S, None):
            body = self.fetch_page(cursor)
            next_cursor = body.get("cursor")
            if body.get("reviews") and next_cursor and next_cursor not in seen_cursors:
                return body
            if wait_s is None:
                return body
            log.warning("empty page or repeated cursor; waiting %ds (possible throttle)", wait_s)
            self.sleep(wait_s)
        return body

    def sleep(self, seconds: float) -> None:
        time.sleep(seconds)

    def run(self, flush_every: int = 20) -> None:
        s = self.state
        buffer: list[dict] = []
        seen_cursors = {s.cursor}
        while not s.done:
            started = time.monotonic()
            body = self.fetch_nonempty(s.cursor, seen_cursors)
            reviews = body.get("reviews", [])
            s.pages += 1
            s.seen += len(reviews)

            for raw in reviews:
                ts = raw["timestamp_created"]
                if s.from_ts <= ts <= s.to_ts:
                    buffer.append(to_record(raw, self.salt))
            if reviews:
                s.oldest_ts = min(r["timestamp_created"] for r in reviews)

            next_cursor = body.get("cursor")
            exhausted = not reviews or not next_cursor or next_cursor in seen_cursors
            past_window = s.oldest_ts is not None and s.oldest_ts < s.from_ts
            s.done = exhausted or past_window
            s.end_reason = "past_window" if past_window else ("exhausted" if exhausted else None)
            if not s.done:
                s.cursor = next_cursor
                seen_cursors.add(next_cursor)

            if s.pages % flush_every == 0 or s.done:
                s.stored += len(buffer)
                self.save(buffer)
                buffer = []
                oldest = datetime.fromtimestamp(s.oldest_ts or 0, UTC).date()
                log.info("page %d | seen %d | stored %d | at %s", s.pages, s.seen, s.stored, oldest)

            self.sleep(max(0.0, self.rate_s - (time.monotonic() - started)))
        log.info("done (%s): %d reviews stored in %s", s.end_reason, s.stored, self.out_dir)


def load_pull(out_dir: Path) -> pl.DataFrame:
    """All parquet parts of a pull, de-duplicated on review id, in a stable order."""
    return (
        pl.read_parquet(out_dir / "part-*.parquet")
        .unique("ext_id", keep="first", maintain_order=True)
        .sort("timestamp_created", "ext_id")
    )


def parse_date(value: str, end_of_day: bool = False) -> int:
    d = datetime.fromisoformat(value).replace(tzinfo=UTC)
    if end_of_day:
        d = d.replace(hour=23, minute=59, second=59)
    return int(d.timestamp())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--appid", type=int, required=True)
    parser.add_argument("--from", dest="from_", required=True, help="YYYY-MM-DD (UTC, inclusive)")
    parser.add_argument("--to", required=True, help="YYYY-MM-DD (UTC, inclusive)")
    parser.add_argument("--language", default="english")
    parser.add_argument("--rate", type=float, default=1.5, help="seconds between requests")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    state = PullState(
        appid=args.appid,
        from_ts=parse_date(args.from_),
        to_ts=parse_date(args.to, end_of_day=True),
        language=args.language,
    )
    out_dir = settings.steam_pulls_dir / f"{args.appid}_{args.from_}_{args.to}"
    fetcher = SteamFetcher.resume_or_new(state, out_dir, settings.author_hash_salt)
    fetcher.rate_s = args.rate
    fetcher.run()


if __name__ == "__main__":
    main()
