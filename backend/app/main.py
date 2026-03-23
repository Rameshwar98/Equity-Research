from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.api.router import api_router
from app.db.database import ensure_db
from app.services.analysis_service import AnalysisService
from app.services.cache_service import CacheService, MemoryCacheService
from app.services.fmp_provider import FMPProvider
from app.services.fib_service import FibService
from app.services.indicator_service import IndicatorService
from app.services.scoring_service import ScoringService
from app.services.universe_service import UniverseService
from app.utils.logging import setup_logging


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "development"
    cache_dir: str = "./cache"
    db_path: str = "./cache/equity.db"
    # When False, backend does not create/read/write SQLite cache.
    # Useful for "fetch -> compute -> respond" local runs.
    persist_cache: bool = False
    allowed_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    analysis_ttl_seconds: int = 1800
    fmp_period: str = "2y"
    fmp_interval: str = "1d"
    fmp_api_key: str


settings = Settings()
setup_logging(settings.app_env)

Path(settings.cache_dir).mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Equity Analysis Backend", version="0.1.0")

origins = [o.strip() for o in settings.allowed_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)

# Singletons (MVP)
provider = FMPProvider(api_key=settings.fmp_api_key)
cache_service = (
    CacheService(db_path=settings.db_path, cache_dir=settings.cache_dir)
    if settings.persist_cache
    else MemoryCacheService()
)
universe_service = UniverseService(universe_dir=Path(__file__).parent / "universe")
indicator_service = IndicatorService()
scoring_service = ScoringService()
fib_service = FibService()
analysis_service = AnalysisService(
    provider=provider,
    cache=cache_service,
    indicator_svc=indicator_service,
    scoring_svc=scoring_service,
    fib_svc=fib_service,
    period=settings.fmp_period,
    interval=settings.fmp_interval,
)


@app.on_event("startup")
async def _startup() -> None:
    if settings.persist_cache:
        await ensure_db(settings.db_path)

