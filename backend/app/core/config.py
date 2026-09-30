from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=REPO_ROOT / ".env", extra="ignore")

    typesafe_api_key: str = ""
    typesafe_base_url: str = "https://api.typesafe.ai"
    jev_model: str = "jev-latest"
    jev_requests_per_second: float = 40.0  # documented limit, docs.typesafe.ai/models.md

    laya_base_url: str = "http://localhost:8000"
    laya_model: str = "english"

    data_dir: Path = REPO_ROOT / "data"
    duckdb_path: Path | None = None  # defaults to data_dir / "rie.duckdb"
    author_hash_salt: str = "change-me"

    max_run_cost_usd: float = 2.0
    cors_origins: list[str] = ["http://localhost:5173"]

    @property
    def db_path(self) -> Path:
        return self.duckdb_path or self.data_dir / "rie.duckdb"

    @property
    def replays_dir(self) -> Path:
        return self.data_dir / "replays"

    @property
    def embeddings_cache_dir(self) -> Path:
        return self.data_dir / "cache" / "embeddings"

    @property
    def steam_pulls_dir(self) -> Path:
        return self.data_dir / "raw" / "steam"


settings = Settings()
