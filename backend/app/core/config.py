from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_password: str
    secret_key: str
    encryption_key: str
    database_url: str = "sqlite+aiosqlite:////data/app.db"
    sync_default_interval_seconds: int = 60
    sync_min_interval_seconds: int = 30
    max_concurrent_syncs: int = 5


@lru_cache
def get_settings() -> Settings:
    return Settings()
