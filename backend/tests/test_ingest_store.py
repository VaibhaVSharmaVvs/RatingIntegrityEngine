import io
import json
from datetime import date, datetime
from pathlib import Path

import polars as pl
import pytest

from app.core.db import MIGRATIONS, Database
from app.ingest import csv_loader
from app.ingest.csv_loader import ColumnMapping
from app.ingest.steam_fetcher import PullState, SteamFetcher
from app.ingest.steam_import import import_pull, stratified_sample

SALT = "test-salt"


@pytest.fixture
def db(tmp_path: Path) -> Database:
    return Database(tmp_path / "t.duckdb")


def test_migrations_are_idempotent(tmp_path: Path) -> None:
    path = tmp_path / "m.duckdb"
    Database(path).close()
    db = Database(path)
    with db.cursor() as cur:
        versions = cur.execute("SELECT count(*) FROM schema_version").fetchone()[0]
    assert versions == len(MIGRATIONS)


def fake_pull(tmp_path: Path, n_days: int = 5, per_day: list[int] | None = None) -> Path:
    per_day = per_day or [10] * n_days
    pages, ts, rid = [], 1_700_000_000, 0
    for day, count in enumerate(per_day):
        page = []
        for k in range(count):
            rid += 1
            page.append(
                {
                    "recommendationid": str(rid),
                    "author": {
                        "steamid": f"7656119{rid:010d}",
                        "personaname": "Name",
                        "num_reviews": 1,
                    },
                    "review": f"[b]review[/b] {rid} mail me x@y.com",
                    "timestamp_created": ts + day * 86_400 + k,
                    "timestamp_updated": ts + day * 86_400 + k,
                    "voted_up": rid % 3 != 0,
                    "language": "english",
                    "weighted_vote_score": 0.5,
                }
            )
        pages.append(sorted(page, key=lambda r: -r["timestamp_created"]))
    pages.reverse()  # Steam pages newest-first

    class Fake(SteamFetcher):
        def fetch_page(self, cursor: str) -> dict:
            i = 0 if cursor == "*" else int(cursor)
            return {"reviews": pages[i] if i < len(pages) else [], "cursor": str(i + 1)}

        def sleep(self, seconds: float) -> None:
            pass

    out = tmp_path / "pull"
    state = PullState(appid=1, from_ts=0, to_ts=2_000_000_000, language="english")
    f = Fake(state, out, SALT)
    f.rate_s = 0
    f.run(flush_every=1)
    return out


def test_import_pull_orders_scrubs_and_hides_ids(db: Database, tmp_path: Path) -> None:
    dataset_id = import_pull(db, fake_pull(tmp_path), name="t")
    with db.cursor() as cur:
        rows = cur.execute(
            "SELECT id, text, created_at, rating_norm, lang, meta FROM reviews "
            "WHERE dataset_id = ? ORDER BY id",
            [dataset_id],
        ).fetchall()
        dump = json.dumps(cur.execute("SELECT * FROM reviews").fetchall(), default=str)
        n = cur.execute("SELECT n_reviews FROM datasets WHERE id = ?", [dataset_id]).fetchone()[0]
    assert n == len(rows) == 50
    assert [r[0] for r in rows] == list(range(50))
    assert [r[2] for r in rows] == sorted(r[2] for r in rows)
    assert all("[EMAIL]" in r[1] and "[b]" not in r[1] for r in rows)
    assert {r[3] for r in rows} == {0.0, 1.0}
    assert rows[0][4] == "en"
    assert rows[0][2].utcoffset().total_seconds() == 0
    assert json.loads(rows[0][5])["author_num_reviews"] == 1
    # No raw SteamID or persona name anywhere in the stored reviews.
    assert "7656119" not in dump and "Name" not in dump


def test_stratified_sample_preserves_burst_shape(tmp_path: Path) -> None:
    from app.ingest.steam_fetcher import load_pull

    df = load_pull(fake_pull(tmp_path, per_day=[10, 10, 200, 10, 10]))
    sample = stratified_sample(df, 48)
    per_day = (
        sample.group_by(pl.from_epoch("timestamp_created", time_unit="s").dt.date())
        .len()
        .sort("timestamp_created")["len"]
        .to_list()
    )
    assert per_day == [2, 2, 40, 2, 2]


def test_csv_load_maps_scales_and_hashes() -> None:
    data = b"body,stars,when,user,helpful\nGreat food and fast service,5,2024-05-01T10:00:00Z,alice,3\nmeh,1,2024-05-02T11:00:00Z,bob,0\n"
    mapping = ColumnMapping(
        text="body", rating="stars", timestamp="when", author="user", extras=["helpful"]
    )
    df, scale = csv_loader.load(data, mapping, SALT)
    assert scale == "1-5"
    assert df["rating_norm"].to_list() == [1.0, 0.0]
    assert "alice" not in df["author_hash"].to_list()[0]
    assert df["created_at"].dtype == pl.Datetime("us", "UTC")
    assert json.loads(df["meta"][0]) == {"helpful": 3}


def test_csv_preview_guesses_scales() -> None:
    data = b"text,score,liked\na,4,1\nb,2,0\n"
    p = csv_loader.preview(data)
    assert p["columns"] == ["text", "score", "liked"]
    assert p["rating_scale_guesses"] == {"score": "1-5", "liked": "binary"}


def test_csv_load_rejects_unknown_columns() -> None:
    with pytest.raises(ValueError, match="not in the file"):
        csv_loader.load(b"a,b\nx,1\n", ColumnMapping(text="nope", rating="b"), SALT)


def xlsx_bytes(df: pl.DataFrame) -> bytes:
    buf = io.BytesIO()
    df.write_excel(buf)
    return buf.getvalue()


def test_xlsx_load_matches_csv_with_native_excel_dates() -> None:
    """An Excel sheet maps like a CSV; date and date-time cells become UTC timestamps."""
    data = xlsx_bytes(
        pl.DataFrame(
            {
                "body": ["Great food and fast service", "meh"],
                "stars": [5, 1],
                "when": [datetime(2024, 5, 1, 10), datetime(2024, 5, 2, 11)],
                "day": [date(2024, 5, 1), date(2024, 5, 2)],
                "user": ["alice", "bob"],
            }
        )
    )
    assert csv_loader.is_xlsx(data)
    p = csv_loader.preview(data)
    assert p["columns"] == ["body", "stars", "when", "day", "user"]
    assert p["rating_scale_guesses"]["stars"] == "1-5"
    mapping = ColumnMapping(text="body", rating="stars", timestamp="when", author="user")
    df, scale = csv_loader.load(data, mapping, SALT)
    assert scale == "1-5"
    assert df["rating_norm"].to_list() == [1.0, 0.0]
    assert "alice" not in df["author_hash"].to_list()[0]
    assert df["created_at"].dtype == pl.Datetime("us", "UTC")
    assert df["created_at"][0] == datetime(2024, 5, 1, 10, tzinfo=df["created_at"][0].tzinfo)
    by_day, _ = csv_loader.load(
        data, ColumnMapping(text="body", rating="stars", timestamp="day"), SALT
    )
    assert by_day["created_at"].dtype == pl.Datetime("us", "UTC")
