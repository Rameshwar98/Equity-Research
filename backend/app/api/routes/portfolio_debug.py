from __future__ import annotations

from fastapi import APIRouter, HTTPException, Response

from app.schemas.momentum import PortfolioDebugScreenResponse

router = APIRouter()


@router.get(
    "/portfolios/{portfolio_id}/debug-screen",
    response_model=PortfolioDebugScreenResponse,
)
async def debug_screen(portfolio_id: str) -> Response:
    """Full ranking pipeline (Return → SD → combined RANK) from the latest snapshot.

    Older snapshots predate the DEBUG capture and return an empty `rows` list.
    """
    from app.main import portfolio_store

    p = await portfolio_store.get(portfolio_id)
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    latest, _prev = await portfolio_store.get_latest_snapshots(portfolio_id)
    rows = list(latest.screen_debug) if (latest and latest.screen_debug) else []

    resp = PortfolioDebugScreenResponse(
        portfolio_id=portfolio_id,
        snapshot_id=latest.snapshot_id if latest else None,
        created_at=latest.created_at if latest else None,
        screen_size=int(getattr(p.params, "momentum_screen_size", 0) or 0),
        final_portfolio_size=int(getattr(p.params, "final_portfolio_size", 0) or 0),
        universe_count=len(rows),
        rows=rows,
    )
    # model_dump_json emits strict JSON (NaN -> null), matching the holdings endpoint.
    return Response(content=resp.model_dump_json(), media_type="application/json")
