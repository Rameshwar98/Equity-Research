from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.schemas.analytics import PortfolioAnalyticsResponse
from app.services.analytics_service import AnalyticsService, AnalyticsConfig

router = APIRouter()


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


@router.get("/portfolios/{portfolio_id}/analytics", response_model=PortfolioAnalyticsResponse)
async def portfolio_analytics(portfolio_id: str) -> PortfolioAnalyticsResponse:
    svc, store = _services()
    p = await store.get(portfolio_id)
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    snaps = await store.list_snapshots(portfolio_id)
    return await svc.compute_portfolio_analytics(
        portfolio_id=portfolio_id,
        universe=p.params.universe,
        benchmark_symbol=p.params.benchmark,
        snapshots=snaps,
        chart_prefs=p.chart_prefs,
    )

