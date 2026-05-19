from __future__ import annotations

import logging
import os
from pathlib import Path

_log = logging.getLogger(__name__)

# Resolve `.env` next to the `backend/` package root so the API key loads even if
# uvicorn is started from the monorepo root (cwd != backend/).
_BACKEND_ROOT = Path(__file__).resolve().parent.parent

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import model_validator
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
from app.services.portfolio_store import PortfolioStore, PortfolioStoreConfig
from app.services.price_tracking_service import PriceTrackingService
from app.services.price_tracking_store import PriceTrackingStore
from app.utils.logging import setup_logging
from app.services.schedule_service import market_for_universe, next_auto_rebalance_date


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_BACKEND_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: str = "development"
    cache_dir: str = "./cache"
    # Durable data root (portfolios, snapshots, daily tracking). On Render, set to a persistent
    # disk mount (e.g. /var/data/equity). Defaults to CACHE_DIR when unset.
    data_dir: str = ""
    db_path: str = "./cache/equity.db"
    # When False, backend does not create/read/write SQLite cache.
    # Useful for "fetch -> compute -> respond" local runs.
    persist_cache: bool = False
    allowed_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    analysis_ttl_seconds: int = 1800
    # Peer drawer: cache FMP peer list + metadata in SQLite (when persist_cache=True) or memory.
    peer_cache_ttl_seconds: int = 86400
    # Reuse profile/news fields across symbols longer than full peer rows.
    peer_fmp_meta_ttl_seconds: int = 172800
    fmp_period: str = "2y"
    fmp_interval: str = "1d"
    fmp_api_key: str

    @model_validator(mode="after")
    def _anchor_relative_paths(self) -> Settings:
        """Keep cache/db under the backend package so uvicorn cwd does not split data files."""

        def anchored(p: str) -> str:
            path = Path(p)
            if path.is_absolute():
                return str(path)
            return str((_BACKEND_ROOT / path).resolve())

        object.__setattr__(self, "cache_dir", anchored(self.cache_dir))
        object.__setattr__(self, "db_path", anchored(self.db_path))
        dd = (self.data_dir or "").strip()
        object.__setattr__(self, "data_dir", anchored(dd if dd else self.cache_dir))
        return self


settings = Settings()
setup_logging(settings.app_env)

Path(settings.cache_dir).mkdir(parents=True, exist_ok=True)
Path(settings.data_dir).mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Equity Analysis Backend", version="0.1.0")

origins = [o.strip() for o in settings.allowed_origins.split(",") if o.strip()]
# Browser calls FastAPI on :8000 from the Next app on :3000 (see frontend joinApiUrl). If you open the
# UI via Next's "Network" URL (e.g. http://192.168.x.x:3000), Origin is not in allow_origins alone and
# the browser reports "Failed to fetch" for holdings/analytics parallel loads unless dev regex matches.
_cors_kw: dict = dict(
    allow_origins=origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
if settings.app_env.strip().lower() == "development":
    _cors_kw["allow_origin_regex"] = (
        r"^https?://("
        r"localhost|127\.0\.0\.1|\[::1\]"
        r"|192\.168\.\d{1,3}\.\d{1,3}"
        r"|10\.\d{1,3}\.\d{1,3}\.\d{1,3}"
        r"|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}"
        r"):\d+$"
    )
app.add_middleware(CORSMiddleware, **_cors_kw)

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

# Durable portfolio store (Phase 1 foundation) — persists regardless of persist_cache.
portfolio_store = PortfolioStore(
    PortfolioStoreConfig(data_path=Path(settings.data_dir) / "portfolios.json")
)

# Phase 7: Daily tracking store/service (always-on, independent of persist_cache)
price_tracking_store = PriceTrackingStore(Path(settings.data_dir) / "portfolio_tracking.db")
price_tracking_service = PriceTrackingService(price_tracking_store, provider=provider, cache=cache_service)


def _storage_is_ephemeral(path: str) -> bool:
    p = path.replace("\\", "/").lower()
    return p == "/tmp" or p.startswith("/tmp/")


@app.on_event("startup")
async def _startup() -> None:
    if settings.app_env.strip().lower() == "production":
        if _storage_is_ephemeral(settings.data_dir):
            _log.warning(
                "DATA_DIR=%s is ephemeral — portfolios and snapshots will be lost on redeploy. "
                "Attach a Render persistent disk and set DATA_DIR to its mount path (e.g. /var/data/equity).",
                settings.data_dir,
            )
        _log.info(
            "storage data_dir=%s cache_dir=%s portfolios=%s",
            settings.data_dir,
            settings.cache_dir,
            Path(settings.data_dir) / "portfolios.json",
        )

    if settings.persist_cache:
        await ensure_db(settings.db_path)

    # Background loops (Phase 6): preview GC + monthly auto-rebalance scheduler
    import asyncio
    import json
    from datetime import datetime, timezone

    from app.api.routes import rebalance as rebalance_routes
    from app.services.momentum_service import MomentumIQService

    async def _preview_gc_loop() -> None:
        while True:
            try:
                await rebalance_routes._gc_previews()  # type: ignore[attr-defined]
            except Exception:
                pass
            await asyncio.sleep(60)

    async def _scheduler_loop() -> None:
        """
        Checks every 15 minutes; on the 1st trading day of the month for each market,
        auto-commits a rebalance for portfolios with rebalance_mode in {auto, both}.
        """
        state_path = Path(settings.data_dir) / "auto_scheduler_state.json"

        def load_state() -> dict:
            try:
                if state_path.exists():
                    return json.loads(state_path.read_text(encoding="utf-8"))
            except Exception:
                return {}
            return {}

        def save_state(st: dict) -> None:
            try:
                state_path.write_text(json.dumps(st), encoding="utf-8")
            except Exception:
                pass

        st = load_state()
        last_done: dict = dict(st.get("last_done") or {})  # portfolio_id -> yyyy-mm

        momentum = MomentumIQService(
            provider=provider,
            cache=cache_service,
            universe_svc=universe_service,
            indicator_svc=IndicatorService(),
            fmp_period=settings.fmp_period,
            fmp_interval=settings.fmp_interval,
        )

        while True:
            try:
                today = datetime.now(timezone.utc).date()
                yyyymm = f"{today.year:04d}-{today.month:02d}"
                items = await portfolio_store.list()
                for p in items:
                    if p.is_test_mode:
                        continue
                    if p.params.rebalance_mode not in ("auto", "both"):
                        continue
                    market = market_for_universe(p.params.universe)
                    sched = next_auto_rebalance_date(market=market, today=today)
                    if sched != today:
                        continue
                    if last_done.get(p.id) == yyyymm:
                        continue

                    # Run compute and commit directly (no preview).
                    latest, prev = await portfolio_store.get_latest_snapshots(p.id)
                    result = await momentum.compute_rebalance_preview(
                        portfolio_id=p.id,
                        params=p.params,
                        latest_snapshot=latest,
                        previous_snapshot=prev,
                        progress_cb=None,
                    )
                    await portfolio_store.append_snapshot(p.id, result.snapshot_candidate)
                    last_done[p.id] = yyyymm
                    save_state({"last_done": last_done})
            except Exception:
                # never crash the server due to scheduler issues
                pass

            await asyncio.sleep(15 * 60)

    async def _daily_tracking_loop() -> None:
        """
        Phase 7: Daily after-close price tracking.

        For each portfolio with at least one committed snapshot, ensure we have a daily series point
        for the most recent trading day (market calendar). Runs periodically; idempotent by (portfolio_id, date).
        """
        import asyncio
        from datetime import datetime, timezone, timedelta

        # buffer after session close to reduce partial EOD risk
        close_buffer = timedelta(minutes=45)

        while True:
            try:
                today_utc = datetime.now(timezone.utc).date().isoformat()
                items = await portfolio_store.list()
                for p in items:
                    if p.is_test_mode:
                        continue
                    # Need a committed snapshot to know holdings/entries.
                    latest, _prev = await portfolio_store.get_latest_snapshots(p.id)
                    if not latest:
                        continue

                    # Ensure backfill exists (no-op if already filled)
                    try:
                        await price_tracking_service.backfill_from_inception(
                            portfolio_id=p.id,
                            universe=p.params.universe,
                            benchmark_symbol=p.params.benchmark,
                            today=today_utc,
                        )
                    except Exception:
                        pass
            except Exception:
                pass

            await asyncio.sleep(15 * 60)

    asyncio.create_task(_preview_gc_loop())
    asyncio.create_task(_scheduler_loop())
    asyncio.create_task(_daily_tracking_loop())

