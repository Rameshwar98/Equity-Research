from __future__ import annotations

import logging
import math
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

import numpy as np
import pandas as pd

from app.schemas.momentum import MomentumComputedRow, MomentumPreview, MomentumSnapshot
from app.schemas.portfolio import PortfolioParams
from app.services.cache_service import CacheService
from app.services.data_provider import DataProvider
from app.services.indicator_service import IndicatorService
from app.services.scoring_service import ScoringService
from app.services.universe_service import UniverseService

logger = logging.getLogger(__name__)


def _slice_prices_asof(prices_by: dict[str, pd.DataFrame], as_of: date) -> dict[str, pd.DataFrame]:
    """Keep only rows on or before calendar as_of (inclusive), per symbol."""
    out: dict[str, pd.DataFrame] = {}
    for sym, df in (prices_by or {}).items():
        if df is None or df.empty:
            out[sym] = pd.DataFrame()
            continue
        dt_idx = pd.to_datetime(df.index)
        try:
            row_dates = dt_idx.date
        except AttributeError:
            row_dates = pd.to_datetime(dt_idx).date
        mask = row_dates <= as_of
        sub = df.loc[mask]
        out[sym] = sub
    return out


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class MomentumRunResult:
    preview: MomentumPreview
    snapshot_candidate: MomentumSnapshot


class MomentumIQService:
    """
    Implements MomentumIQ exact rules (Phase 2):
    - 12M return rank (252-day simple return) + annualized vol rank (log-return SD * sqrt(252))
    - combine ranks, take top-100 then top-25
    - apply rebalance rules vs current holdings with MA50 override
    """

    def __init__(
        self,
        *,
        provider: DataProvider,
        cache: CacheService,
        universe_svc: UniverseService,
        indicator_svc: IndicatorService,
        fmp_period: str = "2y",
        fmp_interval: str = "1d",
    ) -> None:
        self.provider = provider
        self.cache = cache
        self.universe_svc = universe_svc
        self.indicator_svc = indicator_svc
        self.scoring_svc = ScoringService()
        self.fmp_period = fmp_period
        self.fmp_interval = fmp_interval

    async def _load_prices_cache_first(
        self,
        symbols: list[str],
        *,
        timeout_seconds: float,
    ) -> dict[str, pd.DataFrame]:
        # Mimic AnalysisService._load_prices() behavior: prefer cache, fetch only missing.
        prices_by: dict[str, pd.DataFrame] = {}
        for s in symbols:
            cached = await self.cache.get_price_history(s)
            if cached is not None and not cached.empty:
                prices_by[s] = cached

        missing = [s for s in symbols if s not in prices_by or prices_by[s].empty]
        had_any_cached = any((s in prices_by) and (prices_by[s] is not None) and (not prices_by[s].empty) for s in symbols)
        if missing:
            dl = await self.provider.download_daily_history(
                symbols=missing,
                period=self.fmp_period,
                interval=self.fmp_interval,
                timeout_seconds=timeout_seconds,
            )
            for s, df in dl.prices_by_symbol.items():
                if df is not None and not df.empty:
                    await self.cache.upsert_price_history(s, df)
                    prices_by[s] = df
                else:
                    prices_by.setdefault(s, pd.DataFrame())
            # If provider returned nothing for all truly-missing symbols, treat as provider outage/auth/rate-limit.
            missing_without_cache = [s for s in missing if s not in prices_by or prices_by[s].empty]
            if missing_without_cache and all(prices_by.get(s) is None or prices_by.get(s).empty for s in missing_without_cache):
                if had_any_cached:
                    logger.warning(
                        "Provider returned no data; continuing with partial cached prices for %d/%d symbols.",
                        sum(1 for s in symbols if s in prices_by and prices_by[s] is not None and not prices_by[s].empty),
                        len(symbols),
                    )
                else:
                    raise ValueError(
                        "Provider returned no price data for the universe. Check FMP_API_KEY / rate limits."
                    )
        return prices_by

    async def _load_symbol_meta(
        self, symbols: Iterable[str], *, timeout_seconds: float = 60.0
    ) -> dict[str, dict[str, Any]]:
        # Reuse existing cache table used by analysis service
        unique = sorted({s for s in symbols if s})
        fresh, stale = await self.cache.get_symbol_fmp_meta_batch(unique, ttl_seconds=172800)
        out: dict[str, dict[str, Any]] = dict(fresh)
        fetch_fn = getattr(self.provider, "fetch_peer_metadata", None)
        if stale and callable(fetch_fn):
            try:
                fetched = await fetch_fn(stale, timeout_seconds=timeout_seconds)
                await self.cache.put_symbol_fmp_meta_batch(fetched)
                for sym in stale:
                    out[sym] = fetched.get(sym) or {"mkt_cap": None, "name": None, "announcement_date": None}
            except Exception:
                for sym in stale:
                    out.setdefault(sym, {"mkt_cap": None, "name": None, "announcement_date": None})
        else:
            for sym in stale:
                out.setdefault(sym, {"mkt_cap": None, "name": None, "announcement_date": None})
        return out

    def _compute_metrics_for_symbol(self, symbol: str, df: pd.DataFrame) -> Optional[dict[str, Any]]:
        if df is None or df.empty:
            return None
        if "Adj Close" not in df.columns:
            return None
        px = df["Adj Close"].dropna().astype(float).sort_index()
        if px.empty:
            return None
        # Need 252+1 trading days for return and 50-day MA.
        if len(px) < 253:
            return None

        px_252_ago = float(px.iloc[-253])
        px_today = float(px.iloc[-1])
        if px_252_ago <= 0 or px_today <= 0:
            return None

        ret_1y = (px_today / px_252_ago) - 1.0

        # Annualized SD from 252 daily log returns
        log_ret = np.log(px / px.shift(1)).dropna()
        if len(log_ret) < 252:
            return None
        sd_daily = float(np.std(log_ret.iloc[-252:], ddof=1))
        sd_ann = sd_daily * math.sqrt(252.0)

        ma50 = float(px.rolling(window=50, min_periods=50).mean().iloc[-1])
        if not np.isfinite(ma50) or ma50 <= 0:
            return None

        # 52W high/low from the last 252 trading days
        tail252 = px.tail(252)
        high_52w = float(tail252.max()) if not tail252.empty else float("nan")
        low_52w = float(tail252.min()) if not tail252.empty else float("nan")
        if not np.isfinite(high_52w):
            high_52w = float("nan")
        if not np.isfinite(low_52w):
            low_52w = float("nan")

        # Short-term % returns (percent values, like screener)
        def _pct_return(days: int) -> float | None:
            if len(px) <= days:
                return None
            old = float(px.iloc[-(days + 1)])
            if not np.isfinite(old) or old == 0:
                return None
            return round((px_today - old) / old * 100.0, 2)

        return_1w = _pct_return(5)
        return_1m = _pct_return(21)
        return_3m = _pct_return(63)

        # YTD % return (calendar year)
        try:
            year = int(pd.Timestamp(px.index[-1]).year)
            start = px[px.index >= pd.Timestamp(year=year, month=1, day=1)]
            if start is not None and not start.empty:
                old = float(start.iloc[0])
                return_ytd = round((px_today - old) / old * 100.0, 2) if old and np.isfinite(old) else None
            else:
                return_ytd = None
        except Exception:
            return_ytd = None

        score_3_latest: float | None = None
        signals_1y: list[str] = []
        dates_1y: list[str] = []
        # Weekly signals (~1y) computed using score_3 (close / avg_all_emas), same thresholds as screener.
        try:
            prices = pd.DataFrame(
                {"Close": px, "High": px, "Low": px}
            )
            ind = self.indicator_svc.compute_indicators(prices)
            close = prices["Close"].astype(float)
            avg_last5 = self.indicator_svc.avg_last_5_close(close)
            prev_close = self.indicator_svc.prev_close(close)
            scores = self.scoring_svc.compute_scores(close, avg_last5, prev_close, ind.avg_all_emas)
            latest_scores = self.scoring_svc.latest_scores(scores)
            s3_raw = latest_scores.get("score_3")
            if s3_raw is not None:
                try:
                    s3f = float(s3_raw)
                    score_3_latest = s3f if np.isfinite(s3f) else None
                except Exception:
                    score_3_latest = None
            ser = scores.score_3.sort_index()
            if not isinstance(ser.index, pd.DatetimeIndex):
                ser = ser.copy()
                ser.index = pd.to_datetime(ser.index)

            def _classify(v: float | None) -> str:
                if v is None:
                    return "N/A"
                if v > 1.08:
                    return "BUY"
                if v < 0.95:
                    return "SELL"
                return "HOLD"

            weekly_dates: list[str] = []
            weekly_signals: list[str] = []
            fri_grouper = pd.Grouper(freq="W-FRI", label="right", closed="right")
            for _week_end, grp in ser.groupby(fri_grouper):
                if grp.empty:
                    continue
                last_dt = grp.index[-1]
                weekly_dates.append(last_dt.date().isoformat())
                try:
                    v = float(grp.iloc[-1])
                except Exception:
                    v = None
                weekly_signals.append(_classify(v if v is not None and np.isfinite(v) else None))

            n_1y = 52
            signals_1y = weekly_signals[-n_1y:] if weekly_signals else []
            dates_1y = weekly_dates[-n_1y:] if weekly_dates else []
        except Exception:
            signals_1y = []
            dates_1y = []

        price_date = px.index[-1].date().isoformat()
        return {
            "symbol": symbol,
            "last_price": px_today,
            "price_date": price_date,
            "return_1y": float(ret_1y),
            "annualized_sd": float(sd_ann),
            "ma50": ma50,
            "price_vs_50ma": "below" if px_today < ma50 else "above",
            "high_52w": None if not np.isfinite(high_52w) else high_52w,
            "low_52w": None if not np.isfinite(low_52w) else low_52w,
            "return_1w": return_1w,
            "return_1m": return_1m,
            "return_3m": return_3m,
            "return_ytd": return_ytd,
            "signals_1y": signals_1y,
            "signals_1y_dates": dates_1y,
            "score_3": score_3_latest,
        }

    def _default_benchmark(self, universe: str) -> str | None:
        # Mirrors spec; can be overridden by saved param.
        return {
            "sp500": "SPY",
            "nasdaq100": "QQQ",
            "dow30": "DIA",
            "russell2000": "IWM",
            "nifty50": "NIFTYBEES.NS",
            "nifty500": "NIFTYBEES.NS",
        }.get(universe)

    async def compute_rebalance_preview(
        self,
        *,
        portfolio_id: str,
        params: PortfolioParams,
        latest_snapshot: MomentumSnapshot | None,
        previous_snapshot: MomentumSnapshot | None,
        progress_cb: Optional[callable] = None,
        timeout_seconds: float = 90.0,
        as_of_date: date | None = None,
    ) -> MomentumRunResult:
        universe = self.universe_svc.get_universe(params.universe)
        constituents = list(universe.constituents)
        symbols_all = [c.symbol for c in constituents if c.symbol]

        # Universe cap by market cap (optional)
        if params.universe_size_cap:
            meta = await self._load_symbol_meta(symbols_all, timeout_seconds=timeout_seconds)
            scored: list[tuple[float, str]] = []
            for s in symbols_all:
                mc = meta.get(s, {}).get("mkt_cap")
                try:
                    v = float(mc) if mc is not None else float("nan")
                except Exception:
                    v = float("nan")
                if np.isfinite(v):
                    scored.append((v, s))
            scored.sort(key=lambda t: t[0], reverse=True)
            capped_set = {s for _, s in scored[: params.universe_size_cap]}
            symbols = [s for s in symbols_all if s in capped_set]
        else:
            symbols = symbols_all

        total = len(symbols)
        if progress_cb:
            progress_cb(0, total, "Loading prices")

        prices_by = await self._load_prices_cache_first(symbols, timeout_seconds=timeout_seconds)
        if as_of_date is not None:
            prices_by = _slice_prices_asof(prices_by, as_of_date)
        if progress_cb:
            progress_cb(0, total, "Computing metrics")

        skipped: list[str] = []
        metrics: list[dict[str, Any]] = []
        for i, s in enumerate(symbols, start=1):
            df = prices_by.get(s)
            m = self._compute_metrics_for_symbol(s, df if df is not None else pd.DataFrame())
            if m is None:
                skipped.append(s)
            else:
                metrics.append(m)
            if progress_cb and (i == 1 or i % 25 == 0 or i == total):
                progress_cb(i, total, "Computing metrics")

        # Need at least top-100 candidates
        if not metrics:
            raise ValueError("No symbols had sufficient price history to compute MomentumIQ.")

        # Fetch names/sectors from universe definition; name fallback from meta if present.
        by_sym = {c.symbol: c for c in constituents}
        meta_by = await self._load_symbol_meta([m["symbol"] for m in metrics], timeout_seconds=timeout_seconds)

        # Return ranking (desc). Deterministic tie-break by symbol.
        metrics.sort(key=lambda r: (-float(r["return_1y"]), str(r["symbol"])))
        for idx, r in enumerate(metrics, start=1):
            r["return_rank"] = idx

        top_n = min(params.momentum_screen_size, len(metrics))
        top = metrics[:top_n]

        # Vol ranking among top-N (asc). Deterministic tie-break by return_rank then symbol.
        top.sort(key=lambda r: (float(r["annualized_sd"]), int(r["return_rank"]), str(r["symbol"])))
        for idx, r in enumerate(top, start=1):
            r["sd_rank"] = idx
            r["combined_score"] = int(r["return_rank"]) + int(r["sd_rank"])

        # Combined rank among top-N (asc) with tie-breaks.
        top.sort(
            key=lambda r: (
                int(r["combined_score"]),
                int(r["return_rank"]),
                int(r["sd_rank"]),
                str(r["symbol"]),
            )
        )
        for idx, r in enumerate(top, start=1):
            r["combined_rank"] = idx

        top100 = top[: min(100, len(top))]
        top100_ranks = {r["symbol"]: int(r["combined_rank"]) for r in top100}
        top100_set = set(top100_ranks.keys())

        # Target portfolio candidates: top 25 by combined ranking.
        desired_size = min(params.final_portfolio_size, len(top))
        combined_sorted = list(top)  # already sorted
        top25 = combined_sorted[:desired_size]
        top25_set = {r["symbol"] for r in top25}

        held_symbols = {h.symbol for h in (latest_snapshot.holdings if latest_snapshot else [])}

        # Build helpers for lookup.
        row_by_sym = {r["symbol"]: r for r in combined_sorted}

        def computed_row_for_symbol(
            sym: str, *, action: str, band_override: str | None = None, exit_reason: str | None = None
        ) -> MomentumComputedRow:
            base = row_by_sym.get(sym)
            if base is None:
                # Should not happen for top-100; fallback to minimal placeholders.
                c = by_sym.get(sym)
                nm = (c.name if c else None) or meta_by.get(sym, {}).get("name")
                sector = c.sector if c else None
                return MomentumComputedRow(
                    symbol=sym,
                    name=str(nm) if nm is not None else None,
                    sector=sector,
                    score_3=None,
                    last_price=float("nan"),
                    price_date="",
                    return_1y=float("nan"),
                    annualized_sd=float("nan"),
                    return_rank=10**9,
                    sd_rank=10**9,
                    combined_score=10**9,
                    combined_rank=10**9,
                    price_vs_50ma="above",
                    ma50=float("nan"),
                    ma_override_active=False,
                    band=(band_override or ("EXIT" if action == "EXIT" else ("HOLD" if action != "BUY" else "BUY"))),  # type: ignore[arg-type]
                    action=action,  # type: ignore[arg-type]
                    exit_reason=exit_reason,  # type: ignore[arg-type]
                )

            c = by_sym.get(sym)
            nm = (c.name if c else None) or meta_by.get(sym, {}).get("name")
            sector = c.sector if c else None

            ma_breach = params.ma_exit_override and base["price_vs_50ma"] == "below"
            band = band_override
            if band is None:
                if action == "EXIT":
                    band = "EXIT"
                elif action in ("HOLD", "HOLD_WITH_WATCH"):
                    band = "HOLD"
                else:
                    band = "BUY"
            reason = exit_reason

            return MomentumComputedRow(
                symbol=sym,
                name=str(nm) if nm is not None else None,
                sector=sector,
                last_price=float(base["last_price"]),
                price_date=str(base["price_date"]),
                return_1y=float(base["return_1y"]),
                annualized_sd=float(base["annualized_sd"]),
                mkt_cap=meta_by.get(sym, {}).get("mkt_cap"),
                high_52w=base.get("high_52w"),
                low_52w=base.get("low_52w"),
                return_1w=base.get("return_1w"),
                return_1m=base.get("return_1m"),
                return_3m=base.get("return_3m"),
                return_ytd=base.get("return_ytd"),
                signals_1y=list(base.get("signals_1y") or []),
                signals_1y_dates=list(base.get("signals_1y_dates") or []),
                score_3=base.get("score_3"),
                return_rank=int(base["return_rank"]),
                sd_rank=int(base["sd_rank"]),
                combined_score=int(base["combined_score"]),
                combined_rank=int(base["combined_rank"]),
                price_vs_50ma=base["price_vs_50ma"],  # type: ignore[arg-type]
                ma50=float(base["ma50"]),
                ma_override_active=bool(ma_breach),
                band=band,  # type: ignore[arg-type]
                action=action,  # type: ignore[arg-type]
                exit_reason=reason,  # type: ignore[arg-type]
                months_held=0,
                rank_change_vs_last_month=None,
            )

        # Pure rank rebalance:
        # - ranks 1..final_portfolio_size are the portfolio
        # - ranks 26..50 are "On Deck" watchlist
        # - held + still in top25 => HOLD
        # - held + dropped out of top25 => EXIT
        # - new in top25 => BUY
        # - MA50 override: held with price < MA50 => EXIT and fill from rank 26+
        current_rows: list[MomentumComputedRow] = []
        outgoing: list[MomentumComputedRow] = []
        hold_rows: list[MomentumComputedRow] = []
        top25_syms = [r["symbol"] for r in top25 if r.get("symbol")]
        top25_set = set(top25_syms)

        exit_syms: set[str] = set()
        for sym in sorted(held_symbols):
            base = row_by_sym.get(sym)
            if base is None:
                exit_syms.add(sym)
                row = computed_row_for_symbol(sym, action="EXIT", exit_reason="dropped_out_of_top100")
                current_rows.append(row)
                outgoing.append(row)
                continue

            ma_breach = params.ma_exit_override and base.get("price_vs_50ma") == "below"
            if ma_breach:
                exit_syms.add(sym)
                row = computed_row_for_symbol(sym, action="EXIT", exit_reason="ma_breach")
                current_rows.append(row)
                outgoing.append(row)
                continue

            if sym not in top25_set:
                exit_syms.add(sym)
                row = computed_row_for_symbol(sym, action="EXIT", exit_reason="score_breach")
                current_rows.append(row)
                outgoing.append(row)
                continue

            row = computed_row_for_symbol(sym, action="HOLD")
            current_rows.append(row)
            hold_rows.append(row)

        # Proposed holdings start from top25 excluding MA exits, then fill from ranks 26+.
        proposed: list[str] = [s for s in top25_syms if s not in exit_syms]
        if len(proposed) < params.final_portfolio_size:
            for r in combined_sorted[params.final_portfolio_size :]:
                sym = r.get("symbol")
                if not sym:
                    continue
                if sym in proposed:
                    continue
                proposed.append(sym)
                if len(proposed) >= params.final_portfolio_size:
                    break

        # If too many (rare), trim by best combined rank.
        proposed = list(dict.fromkeys(proposed))
        proposed.sort(key=lambda s: (row_by_sym.get(s, {}).get("combined_rank", 10**9), s))
        proposed = proposed[: params.final_portfolio_size]

        # On Deck: ranks 26–50 (by combined_rank), excluding current holdings.
        on_deck_syms: list[str] = []
        for r in combined_sorted:
            try:
                cr = int(r.get("combined_rank") or 10**9)
            except Exception:
                cr = 10**9
            sym = str(r.get("symbol") or "")
            if not sym:
                continue
            if sym in proposed:
                continue
            if 26 <= cr <= 50:
                on_deck_syms.append(sym)
        on_deck_syms = list(dict.fromkeys(on_deck_syms))[:25]

        on_deck_rows: list[MomentumComputedRow] = [
            computed_row_for_symbol(sym, action="BUY", band_override="WATCH") for sym in on_deck_syms
        ]

        # Build snapshot candidate holdings rows (top 25 post-rebalance).
        holdings_rows: list[MomentumComputedRow] = []
        for sym in proposed:
            r = row_by_sym.get(sym)
            if r is None:
                continue
            c = by_sym.get(sym)
            nm = (c.name if c else None) or meta_by.get(sym, {}).get("name")
            sector = c.sector if c else None
            ma_breach = params.ma_exit_override and r["price_vs_50ma"] == "below"
            override_active = bool(ma_breach)
            action = "HOLD" if (latest_snapshot and sym in held_symbols and sym not in exit_syms) else "BUY"
            band = "HOLD" if action == "HOLD" else "BUY"
            row = MomentumComputedRow(
                symbol=sym,
                name=str(nm) if nm is not None else None,
                sector=sector,
                last_price=float(r["last_price"]),
                price_date=str(r["price_date"]),
                return_1y=float(r["return_1y"]),
                annualized_sd=float(r["annualized_sd"]),
                mkt_cap=meta_by.get(sym, {}).get("mkt_cap"),
                high_52w=r.get("high_52w"),
                low_52w=r.get("low_52w"),
                return_1w=r.get("return_1w"),
                return_1m=r.get("return_1m"),
                return_3m=r.get("return_3m"),
                return_ytd=r.get("return_ytd"),
                signals_1y=list(r.get("signals_1y") or []),
                signals_1y_dates=list(r.get("signals_1y_dates") or []),
                score_3=r.get("score_3"),
                return_rank=int(r["return_rank"]),
                sd_rank=int(r["sd_rank"]),
                combined_score=int(r["combined_score"]),
                combined_rank=int(r["combined_rank"]),
                price_vs_50ma=r["price_vs_50ma"],  # type: ignore[arg-type]
                ma50=float(r["ma50"]),
                ma_override_active=override_active,
                band=band,  # type: ignore[arg-type]
                action=action,  # type: ignore[arg-type]
            )
            holdings_rows.append(row)

        # Degree of improvement watchlist (top 20), non-held, present in both months' top-100.
        doi: list[dict] = []
        prev_ranks = previous_snapshot.top100_ranks if previous_snapshot else {}
        for sym, cur_rank in top100_ranks.items():
            if sym in proposed:
                continue
            if sym not in prev_ranks:
                continue
            delta = int(prev_ranks[sym]) - int(cur_rank)
            if delta <= 0:
                continue
            base = row_by_sym.get(sym)
            if not base:
                continue
            doi.append(
                {
                    "symbol": sym,
                    "name": (by_sym.get(sym).name if by_sym.get(sym) else None) or meta_by.get(sym, {}).get("name"),
                    "sector": by_sym.get(sym).sector if by_sym.get(sym) else None,
                    "rank_delta": delta,
                    "previous_rank": int(prev_ranks[sym]),
                    "current_rank": int(cur_rank),
                    "combined_score": int(base["combined_score"]),
                }
            )
        doi.sort(key=lambda r: (-int(r["rank_delta"]), int(r["current_rank"]), str(r["symbol"])))
        doi = doi[:20]

        # Fill months_held + rank_change for snapshot candidate from history
        last_holdings = {h.symbol: h for h in (latest_snapshot.holdings if latest_snapshot else [])}
        last_ranks = latest_snapshot.top100_ranks if latest_snapshot else {}
        for row in holdings_rows:
            prev_row = last_holdings.get(row.symbol)
            if prev_row:
                row.months_held = int(prev_row.months_held or 0) + 1
            else:
                row.months_held = 1
            if row.symbol in last_ranks:
                row.rank_change_vs_last_month = int(last_ranks[row.symbol]) - int(row.combined_rank)
            else:
                row.rank_change_vs_last_month = None

        snapshot = MomentumSnapshot(
            snapshot_id=uuid.uuid4().hex,
            portfolio_id=portfolio_id,
            created_at=_utc_now(),
            holdings=holdings_rows,
            top100_ranks=top100_ranks,
            incoming=[h for h in holdings_rows if h.action == "BUY"],
            outgoing=outgoing,
            hold=hold_rows,
            watch=[],
            degree_of_improvement_watchlist=doi,
            skipped_symbols=skipped,
            top100_rows=[
                computed_row_for_symbol(
                    sym,
                    action=("HOLD" if (sym in proposed and sym in held_symbols) else "BUY"),
                )
                for sym in [r["symbol"] for r in top100]
                if sym in top100_set
            ],
            on_deck=on_deck_rows,
        )

        preview = MomentumPreview(
            run_id="",
            portfolio_id=portfolio_id,
            created_at=snapshot.created_at,
            current_holdings=current_rows,
            incoming=[h for h in holdings_rows if h.action == "BUY"],
            outgoing=outgoing,
            hold=hold_rows,
            watch=[],
            degree_of_improvement_watchlist=doi,
            skipped_symbols=skipped,
        )

        return MomentumRunResult(preview=preview, snapshot_candidate=snapshot)

