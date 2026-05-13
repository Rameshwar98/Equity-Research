from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from app.services.schedule_service import market_for_universe, next_auto_rebalance_date

router = APIRouter()


@router.get("/portfolios/{portfolio_id}/schedule")
async def portfolio_schedule(portfolio_id: str) -> dict:
    from app.main import portfolio_store

    p = await portfolio_store.get(portfolio_id)
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    market = market_for_universe(p.params.universe)
    today = datetime.now(timezone.utc).date()
    next_dt = next_auto_rebalance_date(market=market, today=today)
    enabled = p.params.rebalance_mode in ("auto", "both")
    return {
        "portfolio_id": portfolio_id,
        "rebalance_mode": p.params.rebalance_mode,
        "market": market,
        "next_auto_rebalance": next_dt.isoformat(),
        "enabled": bool(enabled),
    }

