"""Upload caps: file size, decompressed workbook size and rows (HTTP 413)."""

import io
import json
import zipfile
from collections.abc import Iterator
from pathlib import Path

import polars as pl
import pytest
from fastapi.testclient import TestClient

from app.ingest import csv_loader
from app.main import create_app
from tests.conftest import make_settings
from tests.fakes import HashingEmbedder
from tests.test_ingest_store import xlsx_bytes

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
MAPPING = json.dumps({"text": "text", "rating": "stars"})


def client_with(tmp_path: Path, **limits) -> TestClient:
    settings = make_settings(tmp_path, **limits)
    return TestClient(create_app(settings, embedder_factory=lambda cfg: HashingEmbedder()))


@pytest.fixture
def small(tmp_path: Path) -> Iterator[TestClient]:
    """1 KB files, 1 MB expanded, 5 rows."""
    with client_with(
        tmp_path, max_upload_mb=1 / 1024, max_upload_expanded_mb=1, max_upload_rows=5
    ) as c:
        yield c


def csv_rows(n: int) -> bytes:
    return ("text,stars\n" + "".join(f"review {i},{1 + i % 5}\n" for i in range(n))).encode()


def post(c: TestClient, path: str, data: bytes, name: str = "r.csv", mime: str = "text/csv"):
    form = {"name": "t", "mapping": MAPPING} if path.endswith("/csv") else None
    return c.post(path, files={"file": (name, data, mime)}, data=form)


def test_limits_are_published(small: TestClient) -> None:
    assert small.get("/datasets/upload-limits").json() == {"max_mb": 1 / 1024, "max_rows": 5}


@pytest.mark.parametrize("path", ["/datasets/csv/preview", "/datasets/csv"])
def test_rejects_files_over_the_size_cap(small: TestClient, path: str) -> None:
    r = post(small, path, csv_rows(200))  # ~2.5 KB
    assert r.status_code == 413 and "MB" in r.json()["detail"]


@pytest.mark.parametrize("path", ["/datasets/csv/preview", "/datasets/csv"])
def test_rejects_csv_over_the_row_cap(small: TestClient, path: str) -> None:
    assert post(small, path, csv_rows(5)).status_code in (200, 201)
    r = post(small, path, csv_rows(6))
    assert r.status_code == 413 and "row upload limit" in r.json()["detail"]


def test_rejects_xlsx_over_the_row_cap(tmp_path: Path) -> None:
    data = xlsx_bytes(
        pl.DataFrame({"text": [f"r{i}" for i in range(6)], "stars": [1, 2, 3, 4, 5, 1]})
    )
    with client_with(tmp_path, max_upload_rows=5) as c:
        r = post(c, "/datasets/csv/preview", data, "r.xlsx", XLSX)
    assert r.status_code == 413 and "row upload limit" in r.json()["detail"]


def zip_bomb(expanded_mb: int) -> bytes:
    """A small file that decompresses to `expanded_mb` MB of zeros."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("xl/worksheets/sheet1.xml", b"\0" * (expanded_mb * 2**20))
    return buf.getvalue()


def test_rejects_a_workbook_that_expands_past_the_cap(tmp_path: Path) -> None:
    bomb = zip_bomb(8)
    assert len(bomb) < 64 * 1024  # tiny on the wire
    with client_with(tmp_path, max_upload_expanded_mb=2) as c:
        r = post(c, "/datasets/csv/preview", bomb, "r.xlsx", XLSX)
    assert r.status_code == 413 and "expands" in r.json()["detail"]


def test_a_forged_declared_size_is_still_rejected() -> None:
    """Forge the central directory to claim 1 byte. The parser never sees the file: the
    chunked check either counts the real bytes (413) or the zip fails its CRC (invalid)."""
    bomb = bytearray(zip_bomb(8))
    cd = bomb.rfind(b"PK\x01\x02")  # central directory entry; uncompressed size at +24
    bomb[cd + 24 : cd + 28] = (1).to_bytes(4, "little")
    with pytest.raises((csv_loader.UploadTooLarge, ValueError)):
        csv_loader.read_table(bytes(bomb), csv_loader.Limits(max_expanded_bytes=2 * 2**20))
