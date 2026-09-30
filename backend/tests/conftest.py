import pytest

from app.core.config import Settings


def make_settings(tmp_path, **overrides) -> Settings:
    """Settings for tests: never reads the developer's .env (API keys, salt)."""
    base = {"data_dir": tmp_path, "author_hash_salt": "s" * 64, "typesafe_api_key": ""}
    return Settings(_env_file=None, **(base | overrides))


@pytest.fixture(autouse=True)
def _no_real_keys(monkeypatch):
    """Belt and braces: even a stray Settings() must not see a real key via env vars."""
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
