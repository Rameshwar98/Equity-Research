from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Callable, Optional
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

from app.schemas.common import AnalysisRow, RunAnalysisResponse, SummaryStats
from app.services.cache_service import CacheService
from app.services.data_provider import DataProvider
from app.services.fib_service import FibService
from app.services.indicator_service import IndicatorService
from app.services.scoring_service import ScoringService
from app.services.universe_service import Universe
from app.utils.time import utc_now
from app.utils.types import ScoreKey, Signal

logger = logging.getLogger(__name__)

# Same table as peer drawer: reuse SQLite / memory cache for FMP profile fields.
_FMP_SYMBOL_META_TTL_SECONDS = 172800


def _classify(v: float | None) -> Signal:
    if v is None:
        return "N/A"
    if v > 1.08:
        return "BUY"
    if v < 0.95:
        return "SELL"
    return "HOLD"


def _safe_float(x: Any) -> float | None:
    try:
        if x is None or pd.isna(x):
            return None
        return float(x)
    except Exception:
        return None


@dataclass(frozen=True)
class StockComputed:
    symbol: str
    name: Optional[str]
    sector: Optional[str]
    sub_sector: Optional[str]
    date_labels: List[str]
    signals: List[Signal]
    score_latest: Dict[str, float | None]
    close_latest: float | None
    ema_latest: Dict[str, float | None]
    fib: Dict[str, float | None]
    high_52w: float | None = None
    low_52w: float | None = None
    return_1d: float | None = None
    return_1w: float | None = None
    return_1m: float | None = None
    return_3m: float | None = None
    return_ytd: float | None = None
    signals_1y: tuple[str, ...] = ()
    signals_1y_dates: tuple[str, ...] = ()
    # ISO calendar date (YYYY-MM-DD) of the EOD bar used for last_price / returns
    last_price_date: str | None = None


class AnalysisService:
    def __init__(
        self,
        provider: DataProvider,
        cache: CacheService,
        indicator_svc: IndicatorService,
        scoring_svc: ScoringService,
        fib_svc: FibService,
        period: str,
        interval: str,
    ) -> None:
        self.provider = provider
        self.cache = cache
        self.indicator_svc = indicator_svc
        self.scoring_svc = scoring_svc
        self.fib_svc = fib_svc
        self.period = period
        self.interval = interval

    async def _load_prices(
        self,
        symbols: List[str],
        refresh: bool,
        timeout_seconds: float,
    ) -> Dict[str, pd.DataFrame]:
        prices_by_symbol: Dict[str, pd.DataFrame] = {}
        # Preload cache for fallback when refresh=True and FMP fails or returns empty for a symbol.
        for s in symbols:
            cached = await self.cache.get_price_history(s)
            if cached is not None and not cached.empty:
                prices_by_symbol[s] = cached

        # If we already have some cached data, prefer returning partial results
        # over failing the whole request when the provider rate-limits.
        had_any_cached = any(
            (s in prices_by_symbol) and prices_by_symbol[s] is not None and not prices_by_symbol[s].empty
            for s in symbols
        )

        # refresh=False: only fetch symbols with no usable cache (typical Run).
        # refresh=True: re-fetch every symbol in the batch so closes/dates match latest EOD data (Refresh).
        missing = (
            list(symbols)
            if refresh
            else [s for s in symbols if s not in prices_by_symbol or prices_by_symbol[s].empty]
        )
        if missing:
            missing_without_cache = [s for s in missing if s not in prices_by_symbol or prices_by_symbol[s].empty]
            from app.utils.errors import ProviderRateLimitError

            try:
                dl = await self.provider.download_daily_history(
                    symbols=missing,
                    period=self.period,
                    interval=self.interval,
                    timeout_seconds=timeout_seconds,
                )
                for s, df in dl.prices_by_symbol.items():
                    if df is not None and not df.empty:
                        await self.cache.upsert_price_history(s, df)
                        prices_by_symbol[s] = df
                    else:
                        prices_by_symbol.setdefault(s, pd.DataFrame())

                # If provider returned nothing for all symbols that had no cache, treat as provider outage/rate-limit.
                if missing_without_cache and all(
                    (prices_by_symbol.get(s) is None) or prices_by_symbol.get(s).empty for s in missing_without_cache
                ):
                    if had_any_cached:
                        logger.warning(
                            "Provider returned no data; returning partial results from cache for %d/%d symbols.",
                            len(prices_by_symbol),
                            len(symbols),
                        )
                        # Keep existing cached data; missing symbols remain empty.
                        for s in missing_without_cache:
                            prices_by_symbol.setdefault(s, pd.DataFrame())
                    else:
                        raise ProviderRateLimitError("Provider returned no data (likely rate limit).")
            except ProviderRateLimitError:
                raise
            except Exception:
                # Keep existing cached data; leave truly-missing empty.
                for s in missing:
                    prices_by_symbol.setdefault(s, pd.DataFrame())

        return prices_by_symbol

    async def _merge_fmp_meta_batch(
        self,
        symbols: List[str],
        ttl_seconds: int = _FMP_SYMBOL_META_TTL_SECONDS,
        timeout_seconds: float = 90.0,
    ) -> Dict[str, Dict[str, Any]]:
        """mkt_cap / name / announcement_date from cache + FMP profile (when provider supports it)."""
        if not symbols:
            return {}
        fresh, stale = await self.cache.get_symbol_fmp_meta_batch(symbols, ttl_seconds)
        out: Dict[str, Dict[str, Any]] = dict(fresh)
        empty: Dict[str, Any] = {"mkt_cap": None, "name": None, "announcement_date": None}
        fetch_fn = getattr(self.provider, "fetch_peer_metadata", None)
        if stale and callable(fetch_fn):
            try:
                fetched = await fetch_fn(stale, timeout_seconds=timeout_seconds)
                await self.cache.put_symbol_fmp_meta_batch(fetched)
                for sym in stale:
                    out[sym] = fetched.get(sym) or dict(empty)
            except Exception as e:
                logger.warning("FMP symbol metadata batch failed: %s", e)
                for sym in stale:
                    out.setdefault(sym, dict(empty))
        else:
            for sym in stale:
                out.setdefault(sym, dict(empty))
        return out

    def _compute_for_symbol(
        self,
        symbol: str,
        name: Optional[str],
        prices: pd.DataFrame,
        selected_score: ScoreKey,
        sector: Optional[str] = None,
        sub_sector: Optional[str] = None,
    ) -> Optional[StockComputed]:
        if prices is None or prices.empty:
            return None
        if "Close" not in prices.columns or prices["Close"].dropna().empty:
            return None

        prices = prices.dropna(subset=["Close"]).copy()
        prices = prices.sort_index()

        # Need at least 200 EMA, 52-week window, and enough history for 16 weekly signals.
        if len(prices) < 260:
            return None

        ind = self.indicator_svc.compute_indicators(prices)
        close = prices["Close"].astype(float)
        avg_last5 = self.indicator_svc.avg_last_5_close(close)
        prev_close = self.indicator_svc.prev_close(close)
        scores = self.scoring_svc.compute_scores(close, avg_last5, prev_close, ind.avg_all_emas)

        # Weekly signals: weeks ending Friday (W-FRI). Last trading day in each bucket
        # is Friday, or Thu/Wed/… if Friday is closed — not daily columns.
        selected_series = scores.get(selected_score)
        ser = selected_series.sort_index()
        if not isinstance(ser.index, pd.DatetimeIndex):
            ser = ser.copy()
            ser.index = pd.to_datetime(ser.index)

        weekly_dates: list[str] = []
        weekly_signals: list[str] = []
        fri_grouper = pd.Grouper(freq="W-FRI", label="right", closed="right")
        for _week_end, grp in ser.groupby(fri_grouper):
            if grp.empty:
                continue
            last_dt = grp.index[-1]
            weekly_dates.append(last_dt.date().isoformat())
            weekly_signals.append(_classify(_safe_float(grp.iloc[-1])))

        # ~1 year of weekly signals for dashboard heatmap (chronological: oldest first)
        n_1y = 52
        tail_d = weekly_dates[-n_1y:] if weekly_dates else []
        tail_s = weekly_signals[-n_1y:] if weekly_signals else []
        signals_1y_tuple = tuple(tail_s)
        signals_1y_dates_tuple = tuple(tail_d)

        # Most recent 16 weeks, most-recent first for the table columns
        n_table = 16
        last_dates = weekly_dates[-n_table:] if weekly_dates else []
        last_sigs = weekly_signals[-n_table:] if weekly_signals else []
        date_labels = list(reversed(last_dates))
        signals = list(reversed(last_sigs))

        # Latest values
        score_latest = self.scoring_svc.latest_scores(scores)
        close_latest = _safe_float(close.iloc[-1])
        try:
            last_price_date = pd.Timestamp(close.index[-1]).date().isoformat()
        except Exception:
            last_price_date = None

        ema_latest = {
            "ema_10": _safe_float(ind.ema[10].iloc[-1]),
            "ema_20": _safe_float(ind.ema[20].iloc[-1]),
            "ema_30": _safe_float(ind.ema[30].iloc[-1]),
            "ema_50": _safe_float(ind.ema[50].iloc[-1]),
            "ema_100": _safe_float(ind.ema[100].iloc[-1]),
            "ema_200": _safe_float(ind.ema[200].iloc[-1]),
            "avg_all_emas": _safe_float(ind.avg_all_emas.iloc[-1]),
        }

        fib = self.fib_svc.compute(ind.high_52w, ind.low_52w, close_latest)
        fib_dict = {
            "high_52week": fib.high_52week,
            "low_52week": fib.low_52week,
            "px_last": fib.px_last,
            "fib_61_8": fib.fib_61_8,
            "fib_50": fib.fib_50,
            "fib_38_2": fib.fib_38_2,
            "fib_23_6": fib.fib_23_6,
        }

        # Period returns
        def _pct_return(days: int) -> float | None:
            if close_latest is None or len(close) <= days:
                return None
            old = _safe_float(close.iloc[-(days + 1)])
            if old is None or old == 0:
                return None
            return round((close_latest - old) / old * 100, 2)

        return_1d = _pct_return(1)
        return_1w = _pct_return(5)
        return_1m = _pct_return(21)
        return_3m = _pct_return(63)

        # YTD return: from last trading day of previous year
        return_ytd: float | None = None
        if close_latest is not None:
            current_year = close.index[-1].year
            prev_year_prices = close[close.index.year < current_year]
            if len(prev_year_prices) > 0:
                ytd_base = _safe_float(prev_year_prices.iloc[-1])
                if ytd_base and ytd_base != 0:
                    return_ytd = round((close_latest - ytd_base) / ytd_base * 100, 2)

        if len(signals) < 4:
            return None

        return StockComputed(
            symbol=symbol,
            name=name,
            sector=sector,
            sub_sector=sub_sector,
            date_labels=date_labels,
            signals=signals,
            signals_1y=signals_1y_tuple,
            signals_1y_dates=signals_1y_dates_tuple,
            score_latest=score_latest,
            close_latest=close_latest,
            ema_latest=ema_latest,
            fib=fib_dict,
            high_52w=ind.high_52w,
            low_52w=ind.low_52w,
            return_1d=return_1d,
            return_1w=return_1w,
            return_1m=return_1m,
            return_3m=return_3m,
            return_ytd=return_ytd,
            last_price_date=last_price_date,
        )

    async def run_analysis(
        self,
        universe: Universe,
        selected_score: ScoreKey,
        refresh_data: bool,
        timeout_seconds: float = 40.0,
        progress_cb: Optional[Callable[[int, int, str], None]] = None,
        row_cb: Optional[Callable[[AnalysisRow, List[str]], None]] = None,
        batch_size: int = 20,
    ) -> tuple[RunAnalysisResponse, Dict[str, StockComputed]]:
        constituents = universe.constituents
        symbols = [c.symbol for c in constituents]
        name_map = {c.symbol: c.name for c in constituents}
        sector_map: Dict[str, Dict[str, str | None]] = {}

        # Pre-populate sector data from the universe (if present in JSON).
        for c in constituents:
            if c.sector or c.sub_sector:
                sector_map[c.symbol] = {"sector": c.sector, "sub_sector": c.sub_sector}

        # If no sector data from universe, fetch from FMP constituent endpoint.
        if not sector_map:
            try:
                sector_map = await self.provider.fetch_sector_map(universe.name)
            except Exception as e:
                logger.warning("Could not fetch sector data: %s", e)

        total = len(symbols)
        computed: Dict[str, StockComputed] = {}
        skipped: List[str] = []
        rows: List[AnalysisRow] = []
        date_labels: List[str] = []
        buy = hold = sell = 0
        attempted = 0

        if progress_cb:
            progress_cb(0, total, "starting")

        batches = [symbols[i : i + batch_size] for i in range(0, total, batch_size)]

        for batch in batches:
            if progress_cb:
                progress_cb(attempted, total, "loading prices")

            batch_prices = await self._load_prices(
                batch, refresh=refresh_data, timeout_seconds=timeout_seconds
            )

            meta_by_sym = await self._merge_fmp_meta_batch(
                batch,
                ttl_seconds=_FMP_SYMBOL_META_TTL_SECONDS,
                timeout_seconds=max(45.0, min(120.0, 3.0 * len(batch))),
            )

            for s in batch:
                try:
                    sec_info = sector_map.get(s, {})
                    c = self._compute_for_symbol(
                        s, name_map.get(s),
                        batch_prices.get(s, pd.DataFrame()),
                        selected_score,
                        sector=sec_info.get("sector"),
                        sub_sector=sec_info.get("sub_sector"),
                    )
                    attempted += 1
                    if c is None:
                        skipped.append(s)
                        if progress_cb:
                            progress_cb(attempted, total, "computing")
                        continue

                    computed[s] = c
                    if not date_labels:
                        date_labels = c.date_labels

                    sig0 = c.signals[0]
                    if sig0 == "BUY":
                        buy += 1
                    elif sig0 == "SELL":
                        sell += 1
                    elif sig0 == "HOLD":
                        hold += 1

                    fmp_meta = meta_by_sym.get(s) or {}
                    display_name = c.name or fmp_meta.get("name")

                    row = AnalysisRow(
                        symbol=s,
                        name=display_name,
                        sector=c.sector,
                        sub_sector=c.sub_sector,
                        score_1=c.score_latest.get("score_1"),
                        score_2=c.score_latest.get("score_2"),
                        score_3=c.score_latest.get("score_3"),
                        last_price=c.close_latest,
                        last_price_date=c.last_price_date,
                        mkt_cap=fmp_meta.get("mkt_cap"),
                        high_52w=c.high_52w,
                        low_52w=c.low_52w,
                        return_1d=c.return_1d,
                        return_1w=c.return_1w,
                        return_1m=c.return_1m,
                        return_3m=c.return_3m,
                        return_ytd=c.return_ytd,
                        signals=list(c.signals),
                        signals_1y=list(c.signals_1y),
                        signals_1y_dates=list(c.signals_1y_dates),
                    )
                    rows.append(row)

                    if row_cb:
                        row_cb(row, date_labels)

                    if progress_cb:
                        progress_cb(attempted, total, "computing")
                except Exception as e:
                    logger.warning("Failed computing %s: %s", s, e)
                    skipped.append(s)
                    attempted += 1
                    if progress_cb:
                        progress_cb(attempted, total, "computing")

        def _sort_key(r: AnalysisRow) -> tuple[int, float]:
            val = getattr(r, selected_score, None)
            if val is None:
                return (1, 0.0)
            return (0, -float(val))

        rows.sort(key=_sort_key)

        resp = RunAnalysisResponse(
            metadata={
                "index_name": universe.name,
                "selected_score": selected_score,
                "refresh_data": refresh_data,
            },
            date_labels=date_labels,
            rows=rows,
            summary=SummaryStats(total=len(rows), buy=buy, hold=hold, sell=sell),
            cached_at=utc_now(),
        )
        if progress_cb:
            progress_cb(total, total, "finalizing")
        return resp, computed

