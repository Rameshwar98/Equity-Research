from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.schemas.history import PortfolioHistoryResponse
from app.services.history_service import HistoryService, HistoryConfig

router = APIRouter()


def _services() -> tuple[HistoryService, any]:
    from app.main import portfolio_store

    svc = HistoryService(config=HistoryConfig())
    return svc, portfolio_store


@router.get("/portfolios/{portfolio_id}/history", response_model=PortfolioHistoryResponse)
async def portfolio_history(portfolio_id: str) -> PortfolioHistoryResponse:
    svc, store = _services()
    p = await store.get(portfolio_id)
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    snaps = await store.list_snapshots(portfolio_id)
    return svc.compute(portfolio_id=portfolio_id, snapshots=snaps)

