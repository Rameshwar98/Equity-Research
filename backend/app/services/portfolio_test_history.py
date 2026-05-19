"""Seed a portfolio with 12 months of test snapshots + daily tracking (UI preview only)."""

from __future__ import annotations

from datetime import date, datetime, timezone
from pathlib import Path

from fastapi import HTTPException

from app.schemas.portfolio import GenerateTestHistoryResponse
from app.services.momentum_service import MomentumIQService
from app.services.portfolio_store import PortfolioStore


def twelve_first_of_month_dates_ending_current_month(*, today: date | None = None) -> list[date]:
    """Oldest → newest: 12 calendar month starts ending at the 1st of the current month."""
    if today is None:
        today = datetime.now(timezone.utc).date()
    y, m = today.year, today.month
    end_first = date(y, m, 1)
    mm = end_first.month - 11
    yy = end_first.year
    while mm <= 0:
        mm += 12
        yy -= 1
    out: list[date] = []
    cy, cm = yy, mm
    for _ in range(12):
        out.append(date(cy, cm, 1))
        cm += 1
        if cm > 12:
            cm = 1
            cy += 1
    return out


def _momentum_and_store() -> tuple[MomentumIQService, PortfolioStore]:
    from app.main import cache_service, portfolio_store, provider, settings, universe_service
    from app.services.indicator_service import IndicatorService

    momentum = MomentumIQService(
        provider=provider,
        cache=cache_service,
        universe_svc=universe_service,
        indicator_svc=IndicatorService(),
        fmp_period=settings.fmp_period,
        fmp_interval=settings.fmp_interval,
    )
    return momentum, portfolio_store


async def run_generate_portfolio_test_history(portfolio_id: str) -> GenerateTestHistoryResponse:
    from app.main import price_tracking_service, settings
    from app.services.price_tracking_store import PriceTrackingStore

    momentum, store = _momentum_and_store()
    p = await store.get(portfolio_id)
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    track_db = PriceTrackingStore(Path(settings.data_dir) / "portfolio_tracking.db")

    await track_db.delete_portfolio_tracking(portfolio_id=portfolio_id)
    try:
        await store.delete_snapshots(portfolio_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Portfolio not found") from None

    await store.set_test_mode(portfolio_id, is_test_mode=True)

    for as_of in twelve_first_of_month_dates_ending_current_month():
        latest, prev = await store.get_latest_snapshots(portfolio_id)
        result = await momentum.compute_rebalance_preview(
            portfolio_id=portfolio_id,
            params=p.params,
            latest_snapshot=latest,
            previous_snapshot=prev,
            progress_cb=None,
            as_of_date=as_of,
        )
        created_at = datetime(as_of.year, as_of.month, as_of.day, 0, 0, 0, tzinfo=timezone.utc)
        snap = result.snapshot_candidate.model_copy(update={"created_at": created_at})
        await store.append_snapshot(portfolio_id, snap)

    snaps = await store.list_snapshots(portfolio_id)
    if not snaps:
        raise HTTPException(status_code=500, detail="No snapshots were created")
    # Clear tracking then replay every snapshot oldest→newest. A single commit on `snaps[0]`
    # only seeded portfolio_entries once, so every symbol shared one entry_date / days_held
    # despite 12 months of history. Real commits call on_snapshot_committed per commit; mirror that.
    await track_db.delete_portfolio_tracking(portfolio_id=portfolio_id)
    for snap in snaps:
        await price_tracking_service.on_snapshot_committed(portfolio_id=portfolio_id, snapshot=snap)
    p2 = await store.get(portfolio_id)
    if not p2:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    await price_tracking_service.backfill_from_inception(
        portfolio_id=portfolio_id,
        universe=p2.params.universe,
        benchmark_symbol=p2.params.benchmark,
    )

    await track_db.ensure_schema()
    inception = await track_db.get_inception_date(portfolio_id=portfolio_id)
    series = await track_db.get_daily_series(portfolio_id=portfolio_id)

    return GenerateTestHistoryResponse(
        ok=True,
        portfolio_id=portfolio_id,
        snapshots_created=len(snaps),
        inception_date=inception,
        daily_series_points=len(series),
    )
