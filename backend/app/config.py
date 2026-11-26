from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Config(BaseSettings):
    database_url: str = "postgresql+psycopg://postgres@127.0.0.1:5432/tuto_db"
    ollama_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "qwen3:8b"
    data_dir: Path = ROOT / "data"
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")


config = Config()
config.data_dir.mkdir(parents=True, exist_ok=True)
