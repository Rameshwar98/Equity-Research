from __future__ import annotations

from datetime import date as Date

from fastapi import APIRouter, HTTPException

from app.schemas.price_history import (
    DailySeriesPoint,
    HoldingPnlRow,
    PortfolioPriceHistoryResponse,
    PriceHistorySummary,
)

router = APIRouter()


def _stores():
    """Same singletons as app.main (anchored cache dir); do not use cwd-relative ./cache here."""
    from app.main import portfolio_store, price_tracking_store

    return portfolio_store, price_tracking_store


@router.get("/portfolios/{portfolio_id}/price-history", response_model=PortfolioPriceHistoryResponse)
async def get_price_history(portfolio_id: str) -> PortfolioPriceHistoryResponse:
    portfolio_store, price_tracking_store = _stores()
    p = await portfolio_store.get(portfolio_id)
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    series = await price_tracking_store.get_daily_series(portfolio_id=portfolio_id)
    entries = await price_tracking_store.get_entries(portfolio_id=portfolio_id)
    closes = await price_tracking_store.get_latest_closes(portfolio_id=portfolio_id)

    daily_series = [DailySeriesPoint(date=s.date, portfolio_value=s.portfolio_value, benchmark_value=s.benchmark_value) for s in series]

    last_date = series[-1].date if series else None
    holdings_rows: list[HoldingPnlRow] = []
    for e in entries:
        exited = e.status == "exited"
        # Open positions mark to the latest close; exited positions freeze at the exit price.
        cur = e.exit_price if (exited and e.exit_price) else closes.get(e.symbol)
        pnl_pct = None
        pnl_abs = None
        if cur is not None and e.entry_price and e.entry_price > 0:
            pnl_pct = (cur / e.entry_price - 1.0) * 100.0
            pnl_abs = (cur - e.entry_price)
        # Days held: entry → exit for closed positions, entry → latest tracked day for open.
        end_date = e.exit_date if (exited and e.exit_date) else last_date
        days_held = 0
        if end_date:
            try:
                days_held = (Date.fromisoformat(end_date) - Date.fromisoformat(e.entry_date)).days
            except Exception:
                days_held = 0
        holdings_rows.append(
            HoldingPnlRow(
                symbol=e.symbol,
                name=e.name,
                sector=e.sector,
                entry_price=e.entry_price,
                entry_date=e.entry_date,
                current_price=cur,
                pnl_pct=pnl_pct,
                pnl_abs=pnl_abs,
                days_held=max(0, int(days_held)),
                status=e.status,
                exit_date=e.exit_date,
                exit_price=e.exit_price,
            )
        )

    # Open first (by % P&L desc), then exited (most recent exit first).
    holdings_rows.sort(
        key=lambda r: (
            r.status != "open",
            r.pnl_pct is None,
            -(r.pnl_pct or 0.0),
        )
    )

    inception = entries and min((e.entry_date for e in entries), default=None) or None

    total_return_pct = None
    benchmark_return_pct = None
    alpha = None
    if series:
        p0 = series[0].portfolio_value
        p1 = series[-1].portfolio_value
        b0 = series[0].benchmark_value
        b1 = series[-1].benchmark_value
        if p0 and p0 != 0:
            total_return_pct = (p1 / p0 - 1.0) * 100.0
        if b0 and b0 != 0:
            benchmark_return_pct = (b1 / b0 - 1.0) * 100.0
        if total_return_pct is not None and benchmark_return_pct is not None:
            alpha = total_return_pct - benchmark_return_pct

    best = None
    worst = None
    scored = [r for r in holdings_rows if r.pnl_pct is not None]
    if scored:
        best = max(scored, key=lambda r: r.pnl_pct or -1e9).symbol
        worst = min(scored, key=lambda r: r.pnl_pct or 1e9).symbol

    open_scored = [r.pnl_pct for r in scored if r.status == "open" and r.pnl_pct is not None]
    exited_scored = [r.pnl_pct for r in scored if r.status == "exited" and r.pnl_pct is not None]
    open_count = sum(1 for r in holdings_rows if r.status == "open")
    exited_count = sum(1 for r in holdings_rows if r.status == "exited")

    # Rebalance markers from snapshots (monthly commits)
    snaps = await portfolio_store.list_snapshots(portfolio_id)
    rebalance_dates: list[str] = []
    for s in snaps:
        # prefer created_at date if present; else holding price_date
        if getattr(s, "created_at", None):
            try:
                rebalance_dates.append(s.created_at[:10])
                continue
            except Exception:
                pass
        try:
            if s.holdings and s.holdings[0].price_date:
                rebalance_dates.append(s.holdings[0].price_date)
        except Exception:
            pass
    rebalance_dates = sorted({d for d in rebalance_dates if d})

    summary = PriceHistorySummary(
        total_return_pct=total_return_pct,
        benchmark_return_pct=benchmark_return_pct,
        alpha=alpha,
        best_performer=best,
        worst_performer=worst,
        inception_date=inception,
        days_tracked=len(series),
        open_positions=open_count,
        exited_positions=exited_count,
        avg_unrealized_pct=(sum(open_scored) / len(open_scored)) if open_scored else None,
        avg_realized_pct=(sum(exited_scored) / len(exited_scored)) if exited_scored else None,
    )

    return PortfolioPriceHistoryResponse(
        daily_series=daily_series,
        holdings_pnl=holdings_rows,
        summary=summary,
        rebalance_dates=rebalance_dates,
    )

