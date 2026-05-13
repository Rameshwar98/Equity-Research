from __future__ import annotations

from fastapi import APIRouter, HTTPException
from app.schemas.portfolio import (
    CreatePortfolioRequest,
    GenerateTestHistoryResponse,
    Portfolio,
    PortfolioListItem,
    UpdatePortfolioPrefsRequest,
    UpdatePortfolioRequest,
)
from app.services.portfolio_test_history import run_generate_portfolio_test_history

router = APIRouter()


def get_store():
    from app.main import portfolio_store

    return portfolio_store


def get_price_tracking():
    from app.main import price_tracking_service, settings

    return price_tracking_service, settings


@router.get("/portfolios", response_model=list[PortfolioListItem])
async def list_portfolios() -> list[PortfolioListItem]:
    store = get_store()
    return await store.list_items()


@router.post("/portfolios", response_model=Portfolio)
async def create_portfolio(req: CreatePortfolioRequest) -> Portfolio:
    store = get_store()
    try:
        return await store.create(req)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/portfolios/{portfolio_id}", response_model=Portfolio)
async def get_portfolio(portfolio_id: str) -> Portfolio:
    store = get_store()
    p = await store.get(portfolio_id)
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return p


@router.patch("/portfolios/{portfolio_id}", response_model=Portfolio)
async def update_portfolio(portfolio_id: str, req: UpdatePortfolioRequest) -> Portfolio:
    store = get_store()
    try:
        return await store.update(portfolio_id, req)
    except KeyError as e:
        raise HTTPException(status_code=404, detail="Portfolio not found") from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.patch("/portfolios/{portfolio_id}/prefs", response_model=Portfolio)
async def update_portfolio_prefs(portfolio_id: str, req: UpdatePortfolioPrefsRequest) -> Portfolio:
    store = get_store()
    try:
        return await store.update_chart_prefs(portfolio_id, req.chart_prefs)
    except KeyError as e:
        raise HTTPException(status_code=404, detail="Portfolio not found") from e


@router.delete("/portfolios/{portfolio_id}")
async def delete_portfolio(portfolio_id: str) -> dict:
    store = get_store()
    try:
        await store.delete(portfolio_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail="Portfolio not found") from e
    return {"ok": True}


@router.post("/portfolios/{portfolio_id}/duplicate", response_model=Portfolio)
async def duplicate_portfolio(portfolio_id: str) -> Portfolio:
    store = get_store()
    try:
        return await store.duplicate(portfolio_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail="Portfolio not found") from e


@router.post(
    "/test/seed-portfolio/{portfolio_id}",
    response_model=GenerateTestHistoryResponse,
)
async def seed_portfolio_test_history(portfolio_id: str) -> GenerateTestHistoryResponse:
    """UI test mode — distinct path to avoid proxy / route collisions (preferred)."""
    return await run_generate_portfolio_test_history(portfolio_id)


@router.post(
    "/portfolios/{portfolio_id}/generate-test-history",
    response_model=GenerateTestHistoryResponse,
)
async def generate_portfolio_test_history(portfolio_id: str) -> GenerateTestHistoryResponse:
    """UI test mode (legacy path; same as POST /api/test/seed-portfolio/{id})."""
    return await run_generate_portfolio_test_history(portfolio_id)


@router.post("/portfolios/{portfolio_id}/backfill")
async def backfill_portfolio_prices(portfolio_id: str) -> dict:
    store = get_store()
    p = await store.get(portfolio_id)
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    svc, _settings = get_price_tracking()
    try:
        await svc.backfill_from_inception(
            portfolio_id=portfolio_id,
            universe=p.params.universe,
            benchmark_symbol=p.params.benchmark,
        )

        # Return counts from tracking DB for quick verification (same store instance as svc)
        await svc.store.ensure_schema()
        entries = await svc.store.get_entries(portfolio_id=portfolio_id)
        series = await svc.store.get_daily_series(portfolio_id=portfolio_id)
        latest = await svc.store.get_latest_closes(portfolio_id=portfolio_id)
        return {
            "ok": True,
            "portfolio_id": portfolio_id,
            "entries": len(entries),
            "daily_series_points": len(series),
            "latest_closes_symbols": len(latest),
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.post("/portfolios/{portfolio_id}/replay-price-tracking")
async def replay_price_tracking_from_snapshots(portfolio_id: str) -> dict:
    """Rebuild entry rows + daily series from all committed snapshots (no snapshot deletion)."""
    store = get_store()
    p = await store.get(portfolio_id)
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    svc, _settings = get_price_tracking()
    try:
        out = await svc.replay_tracking_from_snapshots(portfolio_id=portfolio_id)
        if not out.get("ok"):
            raise HTTPException(status_code=400, detail=str(out.get("error", "replay failed")))
        return out
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

