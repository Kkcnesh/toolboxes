from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    redis_url: str = "redis://localhost:6379/0"
    database_url: str = "postgresql+psycopg2://toolbox:toolbox@localhost:5432/toolbox"

    r2_bucket: str = "toolbox-builds"
    r2_endpoint: str = ""
    r2_access_key: str = ""
    r2_secret_key: str = ""

    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_readme_model: str = "qwen/qwen3.7-flash"
    openrouter_fix_model: str = "qwen/qwen3-coder-30b-a3b-instruct"
    openrouter_referer: str = "https://toolbox.app"
    openrouter_title: str = "Toolbox"

    readme_confidence_floor: float = 0.5
    preflight_entry_point_confidence_floor: float = 0.4
    max_build_attempts: int = 3
    inactive_repo_max_age_days: int = 365 * 2

    presigned_url_expiry_seconds: int = 7 * 24 * 60 * 60
    build_workdir: str = "/tmp/toolbox-builds"
    registry_path: Path = BASE_DIR / "bundler" / "registry.yaml"

    llm_timeout_seconds: float = 60.0
    github_api_timeout_seconds: float = 10.0
    clone_timeout_seconds: float = 120.0

    clamav_host: str = "clamav"
    clamav_port: int = 3310
    clamav_timeout_seconds: float = 120.0


@lru_cache
def get_settings() -> Settings:
    return Settings()
