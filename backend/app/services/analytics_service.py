from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Dict, Iterable, List, Optional, Tuple

import numpy as np
import pandas as pd

from app.schemas.analytics import (
    AnalyticsCharts,
    AnalyticsKpis,
    ConcentrationCard,
    ContributorsDetractors,
    PortfolioAnalyticsResponse,
    RankMovementItem,
    SectorOverTimePoint,
    SeriesPoint,
)
from app.schemas.momentum import MomentumComputedRow, MomentumSnapshot
from app.services.cache_service import CacheService
from app.services.data_provider import DataProvider


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _rf_monthly(rate_annual: float = 0.05) -> float:
    return (1.0 + rate_annual) ** (1.0 / 12.0) - 1.0


def _safe_float(x: object) -> Optional[float]:
    try:
        if x is None:
            return None
        v = float(x)  # type: ignore[arg-type]
        if math.isnan(v) or math.isinf(v):
            return None
        return v
    except Exception:
        return None


def _nearest_price_on_or_before(px: pd.Series, target_iso: str) -> Optional[float]:
    if px is None or px.empty:
        return None
    try:
        t = pd.to_datetime(target_iso)
    except Exception:
        return None
    px = px.dropna()
    if px.empty:
        return None
    # ensure sorted ascending index
    px = px.sort_index()
    # slice up to target date
    sub = px.loc[:t]
    if sub.empty:
        return None
    return _safe_float(sub.iloc[-1])


def _compound(returns: List[float]) -> float:
    v = 1.0
    for r in returns:
        v *= 1.0 + r
    return v - 1.0


def _drawdown(values: List[float]) -> List[float]:
    out: List[float] = []
    peak = -1e30
    for v in values:
        peak = max(peak, v)
        if peak <= 0:
            out.append(0.0)
        else:
            out.append((v / peak) - 1.0)
    return out


def _annualized_sharpe(monthly_returns: List[float], rf_annual: float = 0.05) -> Optional[float]:
    if len(monthly_returns) < 2:
        return None
    rf_m = _rf_monthly(rf_annual)
    excess = np.array([r - rf_m for r in monthly_returns], dtype=float)
    mu = float(np.mean(excess))
    sd = float(np.std(excess, ddof=1))
    if sd <= 0 or not np.isfinite(sd):
        return None
    return (mu / sd) * math.sqrt(12.0)


def _annualized_sortino(monthly_returns: List[float], rf_annual: float = 0.05) -> Optional[float]:
    if len(monthly_returns) < 2:
        return None
    rf_m = _rf_monthly(rf_annual)
    excess = np.array([r - rf_m for r in monthly_returns], dtype=float)
    downside = excess[excess < 0]
    if downside.size < 2:
        # no downside volatility; treat as undefined (avoid infinite)
        return None
    mu = float(np.mean(excess))
    sd_down = float(np.std(downside, ddof=1))
    if sd_down <= 0 or not np.isfinite(sd_down):
        return None
    return (mu / sd_down) * math.sqrt(12.0)


@dataclass(frozen=True)
class AnalyticsConfig:
    fmp_period: str = "5y"
    fmp_interval: str = "1d"
    rf_annual: float = 0.05


class AnalyticsService:
    def __init__(
        self,
        *,
        provider: DataProvider,
        cache: CacheService,
        config: AnalyticsConfig = AnalyticsConfig(),
    ) -> None:
        self.provider = provider
        self.cache = cache
        self.config = config

    async def _ensure_prices(
        self,
        symbols: Iterable[str],
        *,
        timeout_seconds: float = 45.0,
        min_rows: int = 120,
    ) -> None:
        """Warm cache for analytics; skip provider when we already have enough bars."""
        unique = sorted({s for s in symbols if s})
        if not unique:
            return
        missing: List[str] = []
        for s in unique:
            df = await self.cache.get_price_history(s)
            if df is None or df.empty or len(df) < min_rows:
                missing.append(s)
        if not missing:
            return
        # Avoid multi-minute page loads: cap how many symbols we fetch per request.
        if len(missing) > 40:
            missing = missing[:40]
        dl = await self.provider.download_daily_history(
            symbols=missing,
            period=self.config.fmp_period,
            interval=self.config.fmp_interval,
            timeout_seconds=timeout_seconds,
        )
        for s, df in dl.prices_by_symbol.items():
            if df is not None and not df.empty:
                await self.cache.upsert_price_history(s, df)

    async def _adj_close_series(self, symbol: str) -> pd.Series:
        df = await self.cache.get_price_history(symbol)
        if df is None or df.empty:
            return pd.Series(dtype=float)
        if "Adj Close" not in df.columns:
            return pd.Series(dtype=float)
        s = df["Adj Close"].dropna().astype(float).sort_index()
        return s

    def _benchmark_for_portfolio(self, universe: str, configured: Optional[str]) -> str:
        if configured and configured.strip():
            return configured.strip()
        return {
            "sp500": "SPY",
            "nasdaq100": "QQQ",
            "dow30": "DIA",
            "russell2000": "IWM",
            "nifty50": "NIFTYBEES.NS",
            "nifty500": "NIFTYBEES.NS",
        }.get(universe, "SPY")

    async def compute_portfolio_analytics(
        self,
        *,
        portfolio_id: str,
        universe: str,
        benchmark_symbol: Optional[str],
        snapshots: List[MomentumSnapshot],
        chart_prefs: Dict[str, bool],
    ) -> PortfolioAnalyticsResponse:
        out = PortfolioAnalyticsResponse(
            portfolio_id=portfolio_id,
            benchmark_symbol=self._benchmark_for_portfolio(universe, benchmark_symbol),
            inception_date=snapshots[0].created_at.date().isoformat() if snapshots else None,
            snapshots=len(snapshots),
            chart_prefs=dict(chart_prefs or {}),
        )

        if len(snapshots) < 1:
            return out

        bench = out.benchmark_symbol

        # Collect all symbols used across intervals (holdings + benchmark) for cache ensure.
        syms: set[str] = {bench}
        for s in snapshots:
            for h in s.holdings:
                syms.add(h.symbol)
        await self._ensure_prices(syms, timeout_seconds=45.0)

        # Build monthly return series from snapshot-to-snapshot returns.
        points: List[SeriesPoint] = []
        monthly_port: List[float] = []
        monthly_bench: List[float] = []

        # Use the snapshot holdings as the holdings "in effect" until next snapshot.
        for prev, cur in zip(snapshots[:-1], snapshots[1:]):
            d0 = prev.holdings[0].price_date if prev.holdings else prev.created_at.date().isoformat()
            d1 = cur.holdings[0].price_date if cur.holdings else cur.created_at.date().isoformat()

            # Portfolio monthly return: equal-weight average of per-symbol returns between dates.
            rets: List[float] = []
            for h in prev.holdings:
                px = await self._adj_close_series(h.symbol)
                p0 = _nearest_price_on_or_before(px, d0)
                p1 = _nearest_price_on_or_before(px, d1)
                if p0 is None or p1 is None or p0 <= 0:
                    continue
                rets.append((p1 / p0) - 1.0)
            r_port = float(np.mean(rets)) if rets else 0.0

            px_b = await self._adj_close_series(bench)
            b0 = _nearest_price_on_or_before(px_b, d0)
            b1 = _nearest_price_on_or_before(px_b, d1)
            r_bench = ((b1 / b0) - 1.0) if (b0 and b1 and b0 > 0) else 0.0

            monthly_port.append(float(r_port))
            monthly_bench.append(float(r_bench))

        # Cumulative indexed to 100 at inception (first snapshot date).
        v_port = 100.0
        v_bench = 100.0
        dates = [s.holdings[0].price_date if s.holdings else s.created_at.date().isoformat() for s in snapshots]
        # include start point
        points.append(SeriesPoint(date=dates[0], portfolio=v_port, benchmark=v_bench))
        for i, d in enumerate(dates[1:], start=0):
            v_port *= 1.0 + monthly_port[i]
            v_bench *= 1.0 + monthly_bench[i]
            points.append(SeriesPoint(date=d, portfolio=v_port, benchmark=v_bench))

        # Drawdowns
        dd_port = _drawdown([p.portfolio for p in points])
        dd_bench = _drawdown([p.benchmark for p in points])
        drawdown_points = [
            SeriesPoint(date=pt.date, portfolio=float(dd_port[i]), benchmark=float(dd_bench[i]))
            for i, pt in enumerate(points)
        ]

        # Rolling Sharpe (6-month window; show 0/None until enough history)
        rolling: List[SeriesPoint] = []
        win = 6
        for i, pt in enumerate(points):
            if i < win:
                rolling.append(SeriesPoint(date=pt.date, portfolio=None, benchmark=None))
                continue
            window_port = monthly_port[i - win : i]
            window_b = monthly_bench[i - win : i]
            sp = _annualized_sharpe(window_port, self.config.rf_annual)
            sb = _annualized_sharpe(window_b, self.config.rf_annual)
            rolling.append(
                SeriesPoint(
                    date=pt.date,
                    portfolio=float(sp) if sp is not None else None,
                    benchmark=float(sb) if sb is not None else None,
                )
            )

        out.charts = AnalyticsCharts(
            cumulative=points,
            drawdown=drawdown_points,
            rolling_sharpe=rolling,
        )

        # KPIs (based on monthly returns)
        out.kpis = AnalyticsKpis(
            sharpe=_annualized_sharpe(monthly_port, self.config.rf_annual),
            sortino=_annualized_sortino(monthly_port, self.config.rf_annual),
            sharpe_rf_assumption="vs 5% RF",
            sortino_rf_assumption="vs 5% RF",
        )

        # Current snapshot cross-sectional KPIs
        latest = snapshots[-1]
        hold = latest.holdings
        if hold:
            out.kpis.avg_1y_return = float(np.mean([h.return_1y for h in hold if np.isfinite(h.return_1y)]))
            out.kpis.avg_annualized_sd = float(
                np.mean([h.annualized_sd for h in hold if np.isfinite(h.annualized_sd)])
            )

        # Quality score: % holdings in high-return/low-vol quadrant defined relative to median of top100
        top100 = latest.top100_rows or []
        if top100:
            med_ret = float(np.median([r.return_1y for r in top100 if np.isfinite(r.return_1y)]))
            med_sd = float(np.median([r.annualized_sd for r in top100 if np.isfinite(r.annualized_sd)]))
            out.charts.scatter_median_return_1y = med_ret
            out.charts.scatter_median_sd = med_sd
            if hold:
                good = [
                    h
                    for h in hold
                    if np.isfinite(h.return_1y)
                    and np.isfinite(h.annualized_sd)
                    and (h.return_1y > med_ret)
                    and (h.annualized_sd < med_sd)
                ]
                out.kpis.quality_score = (len(good) / len(hold)) if hold else None

        # Portfolio vs benchmark spreads for periods derived from indexed series
        def total_return_over(points_: List[SeriesPoint], months: int) -> Optional[Tuple[float, float]]:
            if len(points_) < 2:
                return None
            if months <= 0:
                return None
            if len(points_) < months + 1:
                return None
            a = points_[-(months + 1)]
            b = points_[-1]
            pr = (b.portfolio / a.portfolio) - 1.0 if a.portfolio > 0 else None
            br = (b.benchmark / a.benchmark) - 1.0 if a.benchmark > 0 else None
            if pr is None or br is None:
                return None
            return float(pr), float(br)

        one = total_return_over(points, 1)
        three = total_return_over(points, 3)
        twelve = total_return_over(points, 12)
        if one:
            out.kpis.spread_1m = one[0] - one[1]
        if three:
            out.kpis.spread_3m = three[0] - three[1]
        if twelve:
            out.kpis.spread_1y = twelve[0] - twelve[1]

        # YTD: from first point in same year as latest date.
        try:
            last_dt = date.fromisoformat(points[-1].date)
            candidates = [pt for pt in points if date.fromisoformat(pt.date).year == last_dt.year]
            if len(candidates) >= 2:
                a = candidates[0]
                b = candidates[-1]
                pr = (b.portfolio / a.portfolio) - 1.0 if a.portfolio > 0 else None
                br = (b.benchmark / a.benchmark) - 1.0 if a.benchmark > 0 else None
                if pr is not None and br is not None:
                    out.kpis.spread_ytd = float(pr) - float(br)
        except Exception:
            pass

        # Scatter payloads (for frontend chart)
        out.charts.scatter_holdings = latest.holdings
        out.charts.scatter_top100 = latest.top100_rows
        out.charts.on_deck = latest.on_deck or []

        # Sector allocation over time
        sector_points: List[SectorOverTimePoint] = []
        for snap in snapshots:
            d = snap.holdings[0].price_date if snap.holdings else snap.created_at.date().isoformat()
            m: Dict[str, float] = {}
            n = max(1, len(snap.holdings))
            for h in snap.holdings:
                sec = (h.sector or "Unknown").strip() or "Unknown"
                m[sec] = m.get(sec, 0.0) + (1.0 / n)
            sector_points.append(SectorOverTimePoint(date=d, sectors=m))
        out.charts.sector_over_time = sector_points

        # Contributors / detractors (latest snapshot)
        def ratio(h: MomentumComputedRow) -> float:
            if not np.isfinite(h.return_1y) or not np.isfinite(h.annualized_sd) or h.annualized_sd <= 0:
                return -1e30
            return float(h.return_1y / h.annualized_sd)

        contrib = sorted(hold, key=lambda h: h.return_1y if np.isfinite(h.return_1y) else -1e30, reverse=True)[:5]
        det = sorted(hold, key=lambda h: ratio(h))[:5]
        out.charts.contributors_detractors = ContributorsDetractors(contributors=contrib, detractors=det)

        # Rank movement leaderboard (latest vs previous)
        if len(snapshots) >= 2:
            prev = snapshots[-2]
            items: List[RankMovementItem] = []
            for sym, cur_rank in (latest.top100_ranks or {}).items():
                if sym not in (prev.top100_ranks or {}):
                    continue
                pr = int(prev.top100_ranks[sym])
                cr = int(cur_rank)
                delta = pr - cr  # positive = improved
                if delta == 0:
                    continue
                # find metadata from latest top100 rows if present
                mrow = next((r for r in latest.top100_rows if r.symbol == sym), None)
                items.append(
                    RankMovementItem(
                        symbol=sym,
                        name=mrow.name if mrow else None,
                        sector=mrow.sector if mrow else None,
                        delta=delta,
                        prev_rank=pr,
                        cur_rank=cr,
                    )
                )
            improved = sorted(items, key=lambda x: (-x.delta, x.cur_rank))[:10]
            deteriorated = sorted(items, key=lambda x: (x.delta, x.cur_rank))[:10]
            out.charts.rank_movement = {"improved": improved, "deteriorated": deteriorated}

        # Concentration card (latest)
        if hold:
            n = len(hold)
            sec_w: Dict[str, float] = {}
            for h in hold:
                sec = (h.sector or "Unknown").strip() or "Unknown"
                sec_w[sec] = sec_w.get(sec, 0.0) + (1.0 / n)
            herf = float(sum(w * w for w in sec_w.values()))
            out.charts.concentration = ConcentrationCard(
                herfindahl=herf,
                max_sector_weight=float(max(sec_w.values())) if sec_w else None,
                distinct_sectors=len(sec_w),
            )

        return out

