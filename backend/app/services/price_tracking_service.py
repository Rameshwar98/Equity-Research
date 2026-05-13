from __future__ import annotations

from dataclasses import dataclass
from datetime import date as Date, datetime, timezone
from pathlib import Path

import pandas as pd

import logging
from app.schemas.momentum import MomentumSnapshot
from app.services.cache_service import CacheService
from app.services.data_provider import DataProvider
from app.services.schedule_service import Market, market_for_universe
import exchange_calendars as xcals

from app.services.price_tracking_store import PriceTrackingStore

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PriceTrackingConfig:
    db_path: Path


class PriceTrackingService:
    """
    Phase 7 orchestrator.

    Step 1 (this todo): capture entry prices at snapshot commit time.
    Backfill + daily tracking + API aggregation are implemented in later todos.
    """

    def __init__(self, store: PriceTrackingStore, *, provider: DataProvider, cache: CacheService) -> None:
        self.store = store
        self.provider = provider
        self.cache = cache

    async def delete_portfolio_tracking(self, *, portfolio_id: str) -> None:
        await self.store.delete_portfolio_tracking(portfolio_id=portfolio_id)

    async def on_snapshot_committed(self, *, portfolio_id: str, snapshot: MomentumSnapshot) -> None:
        # Entry date is the holding row's price_date; entry price is the holding row's last_price.
        # action drives store upsert: BUY replaces basis (new/re-entry), HOLD* preserves first insert.
        entries: list[tuple[str, str, float, str | None, str | None, str]] = []
        for h in snapshot.holdings or []:
            if not h.symbol or not h.price_date:
                continue
            entries.append((h.symbol, h.price_date, float(h.last_price), h.name, h.sector, h.action))
        await self.store.upsert_entries_from_snapshot(portfolio_id=portfolio_id, entries=entries)

    def _calendar_for_market(self, market: Market):
        if market == "IN":
            return xcals.get_calendar("XNSE")
        return xcals.get_calendar("XNYS")

    def _trading_days(self, *, market: Market, start: str, end: str) -> list[str]:
        """
        Returns trading session dates as YYYY-MM-DD inclusive bounds.
        Uses exchange_calendars.sessions filtering (same Windows-safe approach as schedule_service).
        """
        cal = self._calendar_for_market(market)
        sessions = cal.sessions
        start_dt = pd.Timestamp(start)
        end_dt = pd.Timestamp(end)
        sel = sessions[(sessions >= start_dt) & (sessions <= end_dt)]
        return [d.date().isoformat() for d in sel]

    async def _ensure_history_cached(self, *, symbol: str, start: str, end: str) -> pd.DataFrame:
        """
        Cache-first: use CacheService price_history if it covers the requested range; otherwise fetch and upsert.
        """
        cached = await self.cache.get_price_history(symbol, limit_days=0)
        if cached is not None and not cached.empty:
            have_start = str(cached.index.min().date().isoformat()) <= start
            have_end = str(cached.index.max().date().isoformat()) >= end
            if have_start and have_end:
                return cached

        # Fetch full range and upsert.
        dl = await self.provider.download_daily_history(
            symbols=[symbol],
            period="5y",  # wide; provider will translate to from/to; range is clipped below by from/to anyway
            interval="1d",
            timeout_seconds=60.0,
        )
        df = dl.prices_by_symbol.get(symbol)
        if df is None:
            df = pd.DataFrame()
        if df is not None and not df.empty:
            await self.cache.upsert_price_history(symbol, df)
        return await self.cache.get_price_history(symbol, limit_days=0)

    async def backfill_from_inception(
        self,
        *,
        portfolio_id: str,
        universe: str,
        benchmark_symbol: str | None,
        today: str | None = None,
    ) -> None:
        """
        Backfill daily tracking from inception to today for the portfolio's current entry set.

        Triggered when the portfolio receives its first committed snapshot (or whenever series is missing).
        """
        logger.info(
            "backfill_from_inception start portfolio_id=%s universe=%s benchmark=%s today=%s",
            portfolio_id,
            universe,
            benchmark_symbol,
            today,
        )
        try:
            await self.store.ensure_schema()
            inception = await self.store.get_inception_date(portfolio_id=portfolio_id)
            if not inception:
                logger.warning("backfill_from_inception no inception (no entries) portfolio_id=%s", portfolio_id)
                return
            if today is None:
                today = datetime.now(timezone.utc).date().isoformat()

            # Avoid redoing work if we already have series up to today.
            max_dt = await self.store.get_max_tracked_date(portfolio_id=portfolio_id)
            if max_dt is not None and max_dt >= today:
                logger.info(
                    "backfill_from_inception skip already up-to-date portfolio_id=%s max_dt=%s today=%s",
                    portfolio_id,
                    max_dt,
                    today,
                )
                return

            market = market_for_universe(universe)
            trading_days = self._trading_days(market=market, start=inception, end=today)
            if not trading_days:
                logger.warning(
                    "backfill_from_inception no trading days portfolio_id=%s inception=%s today=%s market=%s",
                    portfolio_id,
                    inception,
                    today,
                    market,
                )
                return

            entries = await self.store.get_entries(portfolio_id=portfolio_id)
            symbols = [e.symbol for e in entries]
            if not symbols:
                logger.warning("backfill_from_inception no symbols portfolio_id=%s", portfolio_id)
                return

            logger.info(
                "backfill_from_inception inputs portfolio_id=%s inception=%s today=%s days=%s symbols=%s",
                portfolio_id,
                inception,
                today,
                len(trading_days),
                len(symbols),
            )

            # Ensure price history cached for each symbol and benchmark.
            history_by: dict[str, pd.DataFrame] = {}
            for sym in symbols:
                history_by[sym] = await self._ensure_history_cached(symbol=sym, start=inception, end=today)

            bench_df: pd.DataFrame | None = None
            if benchmark_symbol:
                bench_df = await self._ensure_history_cached(symbol=benchmark_symbol, start=inception, end=today)

            # Entry price map
            entry_px = {e.symbol: float(e.entry_price) for e in entries if e.entry_price}

            # Benchmark inception close
            bench0: float | None = None
            if bench_df is not None and not bench_df.empty:
                try:
                    row0 = bench_df.loc[pd.Timestamp(inception)]
                    bench0 = float(row0["Adj Close"] if "Adj Close" in row0 else row0["Close"])
                except Exception:
                    bench0 = None

            wrote_prices = 0
            wrote_series = 0
            for d in trading_days:
                closes: list[tuple[str, float]] = []
                ratios: list[float] = []
                for sym in symbols:
                    df = history_by.get(sym)
                    if df is None or df.empty:
                        continue
                    try:
                        row = df.loc[pd.Timestamp(d)]
                    except Exception:
                        continue
                    px = None
                    try:
                        px = float(row["Adj Close"] if "Adj Close" in row else row["Close"])
                    except Exception:
                        px = None
                    if px is None:
                        continue
                    closes.append((sym, px))
                    ep = entry_px.get(sym)
                    if ep and ep > 0:
                        ratios.append(px / ep)

                bench_px: float | None = None
                if benchmark_symbol and bench_df is not None and not bench_df.empty:
                    try:
                        rowb = bench_df.loc[pd.Timestamp(d)]
                        bench_px = float(rowb["Adj Close"] if "Adj Close" in rowb else rowb["Close"])
                    except Exception:
                        bench_px = None
                    if bench_px is not None:
                        closes.append((benchmark_symbol, bench_px))

                if closes:
                    await self.store.upsert_daily_prices(portfolio_id=portfolio_id, date=d, closes=closes)
                    wrote_prices += len(closes)

                if ratios:
                    port_val = 100.0 * (sum(ratios) / len(ratios))
                else:
                    port_val = 100.0

                bench_val = 100.0
                if bench_px is not None and bench0 and bench0 > 0:
                    bench_val = 100.0 * (bench_px / bench0)

                await self.store.upsert_daily_series_point(
                    portfolio_id=portfolio_id, date=d, portfolio_value=port_val, benchmark_value=bench_val
                )
                wrote_series += 1

            logger.info(
                "backfill_from_inception complete portfolio_id=%s wrote_prices_rows≈%s wrote_series_rows=%s",
                portfolio_id,
                wrote_prices,
                wrote_series,
            )
        except Exception:
            logger.exception("backfill_from_inception failed portfolio_id=%s", portfolio_id)
            raise

    async def replay_tracking_from_snapshots(self, *, portfolio_id: str) -> dict:
        """
        Rebuild `portfolio_entries` and daily tracking by replaying every committed snapshot
        oldest → newest (same as test-history seeding and real rebalance commits).

        Use after entry-logic upgrades or if the P&L table shows a single entry_date for all
        symbols despite many snapshots.
        """
        from app.main import portfolio_store

        snaps = await portfolio_store.list_snapshots(portfolio_id)
        if not snaps:
            return {"ok": False, "error": "no snapshots"}
        p = await portfolio_store.get(portfolio_id)
        if not p:
            return {"ok": False, "error": "portfolio not found"}

        await self.delete_portfolio_tracking(portfolio_id=portfolio_id)
        for snap in snaps:
            await self.on_snapshot_committed(portfolio_id=portfolio_id, snapshot=snap)
        await self.backfill_from_inception(
            portfolio_id=portfolio_id,
            universe=p.params.universe,
            benchmark_symbol=p.params.benchmark,
        )
        entries = await self.store.get_entries(portfolio_id=portfolio_id)
        series = await self.store.get_daily_series(portfolio_id=portfolio_id)
        return {
            "ok": True,
            "portfolio_id": portfolio_id,
            "snapshots_replayed": len(snaps),
            "entry_rows": len(entries),
            "daily_series_points": len(series),
        }

