from __future__ import annotations

import time
from typing import Dict, Tuple

from fastapi import APIRouter, HTTPException

from app.schemas.analytics import PortfolioAnalyticsResponse
from app.schemas.momentum import MomentumSnapshot
from app.services.analytics_service import AnalyticsService, AnalyticsConfig

router = APIRouter()

# In-process cache: analytics is expensive (price warm-up). Keyed by portfolio + snapshot revision.
_ANALYTICS_CACHE: Dict[str, Tuple[str, float, PortfolioAnalyticsResponse]] = {}
_ANALYTICS_CACHE_TTL_SECONDS = 300.0


def _services() -> tuple[AnalyticsService, any]:
    from app.main import cache_service, provider, settings
    from app.main import portfolio_store

    svc = AnalyticsService(
        provider=provider,
        cache=cache_service,
        config=AnalyticsConfig(
            fmp_period="5y",
            fmp_interval=settings.fmp_interval,
            rf_annual=0.05,
        ),
    )
    return svc, portfolio_store


def _analytics_revision(snaps: list[MomentumSnapshot]) -> str:
    if not snaps:
        return "0"
    last = snaps[-1]
    return f"{len(snaps)}:{last.snapshot_id}"


@router.get("/portfolios/{portfolio_id}/analytics", response_model=PortfolioAnalyticsResponse)
async def portfolio_analytics(portfolio_id: str) -> PortfolioAnalyticsResponse:
    svc, store = _services()
    p = await store.get(portfolio_id)
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    snaps = await store.list_snapshots(portfolio_id)
    rev = _analytics_revision(snaps)
    now = time.time()
    cached = _ANALYTICS_CACHE.get(portfolio_id)
    if cached and cached[0] == rev and (now - cached[1]) < _ANALYTICS_CACHE_TTL_SECONDS:
        return cached[2]

    out = await svc.compute_portfolio_analytics(
        portfolio_id=portfolio_id,
        universe=p.params.universe,
        benchmark_symbol=p.params.benchmark,
        snapshots=snaps,
        chart_prefs=p.chart_prefs,
    )
    _ANALYTICS_CACHE[portfolio_id] = (rev, now, out)
    return out

