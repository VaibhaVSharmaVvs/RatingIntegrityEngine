from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=REPO_ROOT / ".env", extra="ignore")

    typesafe_api_key: str = ""
    typesafe_base_url: str = "https://api.typesafe.ai"
    jev_model: str = "jev-latest"

    laya_base_url: str = "http://localhost:8000"
    laya_model: str = "english"

    data_dir: Path = REPO_ROOT / "data"
    duckdb_path: Path = REPO_ROOT / "data" / "rie.duckdb"
    author_hash_salt: str = "change-me"

    max_run_cost_usd: float = 2.0
    cors_origins: list[str] = ["http://localhost:5173"]


settings = Settings()
