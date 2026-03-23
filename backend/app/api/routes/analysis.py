from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from urllib.parse import quote

from app.schemas.common import RunAnalysisRequest, RunAnalysisResponse
from app.services.analysis_service import AnalysisService
from app.services.cache_service import CacheService
from app.services.universe_service import UniverseService
from app.utils.types import ScoreKey

import pandas as pd

logger = logging.getLogger(__name__)
router = APIRouter()

_RUNS: Dict[str, Dict[str, Any]] = {}
_RUNS_LOCK = asyncio.Lock()

_PARTIAL: Dict[str, Dict[str, Any]] = {}
_PARTIAL_LOCK = asyncio.Lock()


def _make_run_id(run_key: str) -> str:
    # Make it unique even if user triggers multiple runs quickly.
    return f"{run_key}::{int(time.time() * 1000)}"


async def _set_run_state(run_id: str, patch: Dict[str, Any]) -> None:
    async with _RUNS_LOCK:
        cur = _RUNS.get(run_id) or {}
        # Prevent late progress updates from overwriting a completed run.
        if cur.get("status") == "done" and patch.get("status") not in (None, "done", "error"):
            return
        cur.update(patch)
        _RUNS[run_id] = cur

        # Persist to disk so progress is visible across reloads/processes.
        try:
            from app.main import settings

            progress_dir = Path(settings.cache_dir) / "run_progress"
            progress_dir.mkdir(parents=True, exist_ok=True)
            safe_id = quote(run_id, safe="")
            (progress_dir / f"{safe_id}.json").write_text(
                json.dumps(cur, default=str), encoding="utf-8"
            )
        except Exception:
            # If disk persistence fails, fall back to in-memory only.
            pass


async def _get_run_state(run_id: str) -> Optional[Dict[str, Any]]:
    async with _RUNS_LOCK:
        st = _RUNS.get(run_id)
        if st:
            return dict(st)

    # If not in memory, try loading from disk (outside the lock).
    try:
        from app.main import settings

        progress_dir = Path(settings.cache_dir) / "run_progress"
        safe_id = quote(run_id, safe="")
        path = progress_dir / f"{safe_id}.json"
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def get_services() -> tuple[UniverseService, AnalysisService, CacheService, int]:
    from app.main import analysis_service, cache_service, settings, universe_service

    return universe_service, analysis_service, cache_service, settings.analysis_ttl_seconds


@router.post("/run-analysis-with-progress")
async def run_analysis_with_progress(req: RunAnalysisRequest) -> Dict[str, Any]:
    universe_svc, analysis_svc, cache_svc, ttl = get_services()

    if req.selected_score not in ("score_1", "score_2", "score_3"):
        raise HTTPException(status_code=400, detail="selected_score must be score_1|score_2|score_3")

    run_key = f"{req.index_name}::{req.selected_score}::refresh={int(req.refresh_data)}"

    # If not refreshing, try cached result immediately.
    if not req.refresh_data:
        cached = await cache_svc.get_recent_run_for_key(run_key, ttl_seconds=ttl)
        if cached:
            try:
                payload = cached.payload
                result = RunAnalysisResponse.model_validate(payload)
                run_id = _make_run_id(run_key)
                await _set_run_state(
                    run_id,
                    {
                        "status": "done",
                        "processed": 0,
                        "total": 0,
                        "message": "Cached",
                        "started_at": datetime.now(timezone.utc).isoformat(),
                        "result": result.model_dump(),
                        "error": None,
                    },
                )
                return {"mode": "cached", "run_id": run_id, "result": result}
            except Exception:
                # Fall through to recompute if cached payload is invalid.
                pass

    run_id = _make_run_id(run_key)
    await _set_run_state(
        run_id,
        {
            "status": "running",
            "processed": 0,
            "total": 0,
            "message": "Queued",
            "started_at": datetime.now(timezone.utc).isoformat(),
            "result": None,
            "error": None,
        },
    )

    async def _task() -> None:
        try:
            universe = universe_svc.get_universe(req.index_name)
            symbols = [c.symbol for c in universe.constituents]
            total = len(symbols)

            await _set_run_state(run_id, {"total": total, "message": "Loading prices"})

            async with _PARTIAL_LOCK:
                _PARTIAL[run_id] = {
                    "date_labels": [],
                    "rows": [],
                    "summary": {"total": 0, "buy": 0, "hold": 0, "sell": 0},
                    "metadata": {
                        "index_name": req.index_name,
                        "selected_score": req.selected_score,
                        "refresh_data": req.refresh_data,
                    },
                }

            last_persist_at = 0.0
            last_processed = -1

            def progress_cb(processed: int, total_inner: int, phase: str) -> None:
                nonlocal last_persist_at, last_processed
                if phase == "finalizing":
                    return
                now = time.time()
                should_persist = (
                    processed == 0
                    or processed == total_inner
                    or (processed - last_processed) >= 5
                    or (now - last_persist_at) >= 1.0
                )
                if not should_persist:
                    return
                last_processed = processed
                last_persist_at = now
                asyncio.create_task(
                    _set_run_state(
                        run_id,
                        {
                            "status": "running",
                            "processed": processed,
                            "total": total_inner,
                            "message": phase.replace("_", " "),
                        },
                    )
                )

            from app.schemas.common import AnalysisRow as AnalysisRowModel

            def row_cb(row: AnalysisRowModel, date_labels: list) -> None:
                async def _append():
                    async with _PARTIAL_LOCK:
                        p = _PARTIAL.get(run_id)
                        if not p:
                            return
                        if not p["date_labels"] and date_labels:
                            p["date_labels"] = list(date_labels)
                        p["rows"].append(row.model_dump())
                        p["summary"]["total"] = len(p["rows"])
                        sig = (row.signals or [None])[0]
                        if sig == "BUY":
                            p["summary"]["buy"] += 1
                        elif sig == "SELL":
                            p["summary"]["sell"] += 1
                        elif sig == "HOLD":
                            p["summary"]["hold"] += 1

                asyncio.create_task(_append())

            resp, computed = await analysis_svc.run_analysis(
                universe=universe,
                selected_score=req.selected_score,  # type: ignore[arg-type]
                refresh_data=req.refresh_data,
                progress_cb=progress_cb,
                row_cb=row_cb,
            )

            if resp.rows:
                payload: Dict[str, Any] = resp.model_dump()
                payload["cached_at"] = resp.cached_at.isoformat()
                await cache_svc.put_run(
                    run_id=run_key,
                    index_name=req.index_name,
                    selected_score=req.selected_score,
                    refresh_data=req.refresh_data,
                    payload=payload,
                )

            await _set_run_state(
                run_id,
                {
                    "status": "done",
                    "processed": total,
                    "total": total,
                    "message": "Done",
                    "result": resp.model_dump(),
                    "error": None,
                },
            )

            async with _PARTIAL_LOCK:
                _PARTIAL.pop(run_id, None)
        except Exception as e:
            await _set_run_state(
                run_id,
                {"status": "error", "message": "Error", "result": None, "error": str(e)},
            )
            async with _PARTIAL_LOCK:
                _PARTIAL.pop(run_id, None)

    # Start in background and return immediately.
    asyncio.create_task(_task())
    return {"mode": "run", "run_id": run_id}


@router.get("/run-analysis-with-progress/{run_id}")
async def run_analysis_progress(run_id: str) -> Dict[str, Any]:
    st = await _get_run_state(run_id)
    if not st:
        raise HTTPException(status_code=404, detail="Unknown run_id")

    started_at = st.get("started_at")
    processed = int(st.get("processed") or 0)
    total = int(st.get("total") or 0)
    status = st.get("status") or "running"

    eta_seconds: Optional[float] = None
    if started_at and total > 0 and processed > 0 and status != "done":
        try:
            started_dt = datetime.fromisoformat(started_at)
            elapsed = (datetime.now(timezone.utc) - started_dt).total_seconds()
            avg = elapsed / processed
            eta_seconds = avg * max(0, (total - processed))
        except Exception:
            eta_seconds = None

    progress_percent = None
    if total > 0:
        progress_percent = (processed / total) * 100.0

    # If we already have a computed result and we've processed everything,
    # treat it as done (prevents UI getting stuck on "finalizing").
    if status != "error" and st.get("result") and total > 0 and processed >= total:
        status = "done"
        st["status"] = "done"

    return {
        "run_id": run_id,
        "status": status,
        "processed": processed,
        "total": total,
        "progress_percent": progress_percent,
        "eta_seconds": eta_seconds,
        "message": st.get("message"),
        "error": st.get("error"),
    }


@router.get("/run-analysis-partial/{run_id}")
async def run_analysis_partial(run_id: str) -> Dict[str, Any]:
    """Return whatever rows have been computed so far for a running analysis."""
    async with _PARTIAL_LOCK:
        p = _PARTIAL.get(run_id)
        if p:
            return {
                "date_labels": p["date_labels"],
                "rows": list(p["rows"]),
                "summary": dict(p["summary"]),
                "metadata": p["metadata"],
                "cached_at": datetime.now(timezone.utc).isoformat(),
            }

    st = await _get_run_state(run_id)
    if st and st.get("result"):
        return st["result"]

    return {
        "date_labels": [],
        "rows": [],
        "summary": {"total": 0, "buy": 0, "hold": 0, "sell": 0},
        "metadata": {},
        "cached_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/run-analysis-result-with-progress/{run_id}")
async def run_analysis_result_with_progress(run_id: str) -> Dict[str, Any]:
    st = await _get_run_state(run_id)
    if not st:
        raise HTTPException(status_code=404, detail="Unknown run_id")
    result = st.get("result")
    if not result:
        raise HTTPException(status_code=409, detail="Run not completed yet")
    return result


@router.post("/run-analysis", response_model=RunAnalysisResponse)
async def run_analysis(req: RunAnalysisRequest) -> RunAnalysisResponse:
    universe_svc, analysis_svc, cache_svc, ttl = get_services()

    if req.selected_score not in ("score_1", "score_2", "score_3"):
        raise HTTPException(status_code=400, detail="selected_score must be score_1|score_2|score_3")

    run_key = f"{req.index_name}::{req.selected_score}::refresh={int(req.refresh_data)}"
    if not req.refresh_data:
        cached = await cache_svc.get_recent_run_for_key(run_key, ttl_seconds=ttl)
        if cached:
            try:
                payload = cached.payload
                return RunAnalysisResponse.model_validate(payload)
            except Exception:
                logger.info("Cached run invalid, recomputing.")

    try:
        universe = universe_svc.get_universe(req.index_name)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    try:
        resp, computed = await analysis_svc.run_analysis(
            universe=universe,
            selected_score=req.selected_score,  # type: ignore[arg-type]
            refresh_data=req.refresh_data,
        )
    except Exception as e:
        # If provider is rate-limited, surface a clear error instead of caching empties
        from app.utils.errors import ProviderRateLimitError

        if isinstance(e, ProviderRateLimitError):
            raise HTTPException(
                status_code=429,
                detail="FMP rate-limited (429). Wait a bit and retry; avoid frequent refreshes.",
            ) from e
        raise

    # Only persist if we have at least some rows (prevents caching "all empty" due to transient provider failures)
    if resp.rows:
        payload: Dict[str, Any] = resp.model_dump()
        payload["cached_at"] = resp.cached_at.isoformat()
        await cache_svc.put_run(
            run_id=run_key,
            index_name=req.index_name,
            selected_score=req.selected_score,
            refresh_data=req.refresh_data,
            payload=payload,
        )

    return resp


@router.get("/stock/{symbol}/details")
async def stock_details(
    symbol: str,
    history_months: int = Query(12, ge=1, le=18, description="How many months of trend history to return"),
) -> Dict[str, Any]:
    # Compute details from cached price history if available.
    # If not available, fetch from the external provider and (optionally) cache it.
    from app.main import (
        cache_service,
        fib_service,
        indicator_service,
        provider,
        scoring_service,
    )

    prices = await cache_service.get_price_history(symbol)
    if prices is None or prices.empty:
        # Need enough history to compute ~52w/indicators; defaults to FMP 2y/1d.
        from app.main import settings

        dl = await provider.download_daily_history(
            symbols=[symbol],
            period=settings.fmp_period,
            interval=settings.fmp_interval,
            timeout_seconds=40.0,
        )
        prices = dl.prices_by_symbol.get(symbol)
        if prices is None or prices.empty:
            raise HTTPException(
                status_code=404,
                detail="No price history fetched for symbol. Check FMP API key/limits and retry.",
            )
        # Save into cache for faster subsequent calls (memory or disk depending on config).
        await cache_service.upsert_price_history(symbol, prices)

    prices = prices.dropna(subset=["Close"]).sort_index()
    if len(prices) < 260:
        raise HTTPException(status_code=400, detail="Insufficient history for indicators.")

    ind = indicator_service.compute_indicators(prices)
    close = prices["Close"].astype(float)
    avg_last5 = indicator_service.avg_last_5_close(close)
    prev_close = indicator_service.prev_close(close)
    scores = scoring_service.compute_scores(close, avg_last5, prev_close, ind.avg_all_emas)

    # Default selected score for details: score_1
    selected: ScoreKey = "score_1"
    selected_series = scores.get(selected)

    # Return every trading day for the requested window (no sampling).
    lookback_sessions = history_months * 21
    lookback_sessions = min(lookback_sessions, len(selected_series))
    recent = selected_series.tail(lookback_sessions)

    dates = [d.date().isoformat() for d in recent.index.to_list()]
    vals = recent.to_list()

    def classify(v: Any) -> str:
        try:
            if v is None or (hasattr(v, "__float__") and (v != v)):  # nan check
                return "N/A"
            f = float(v)
        except Exception:
            return "N/A"
        if f > 1.08:
            return "BUY"
        if f < 0.95:
            return "SELL"
        return "HOLD"

    signals = [classify(v) for v in vals]

    close_for_dates = close.reindex(recent.index)
    closes = [round(float(c), 2) if pd.notna(c) else None for c in close_for_dates.to_list()]

    # EMA history for the chart period
    ema_10_series = ind.ema[10].reindex(recent.index)
    ema_20_series = ind.ema[20].reindex(recent.index)
    ema_50_series = ind.ema[50].reindex(recent.index)

    # Volume data
    vol_col = None
    for col_name in ("Volume", "volume"):
        if col_name in prices.columns:
            vol_col = col_name
            break
    volume_series = prices[vol_col].reindex(recent.index) if vol_col else None

    # Build chart_data array (chronological: oldest first)
    chart_data = []
    for idx_pos, dt_idx in enumerate(recent.index):
        d = dates[idx_pos]
        entry: Dict[str, Any] = {
            "date": d,
            "close": round(float(close_for_dates.iloc[idx_pos]), 2) if pd.notna(close_for_dates.iloc[idx_pos]) else None,
            "ema10": round(float(ema_10_series.iloc[idx_pos]), 2) if pd.notna(ema_10_series.iloc[idx_pos]) else None,
            "ema20": round(float(ema_20_series.iloc[idx_pos]), 2) if pd.notna(ema_20_series.iloc[idx_pos]) else None,
            "ema50": round(float(ema_50_series.iloc[idx_pos]), 2) if pd.notna(ema_50_series.iloc[idx_pos]) else None,
            "signal": signals[idx_pos] if idx_pos < len(signals) else None,
        }
        if volume_series is not None and pd.notna(volume_series.iloc[idx_pos]):
            entry["volume"] = int(volume_series.iloc[idx_pos])
        chart_data.append(entry)

    date_labels = list(reversed(dates))
    signals = list(reversed(signals))
    closes = list(reversed(closes))

    close_latest = float(close.iloc[-1])
    fib_52w = fib_service.compute(ind.high_52w, ind.low_52w, close_latest)

    # 30-day Fibonacci levels
    close_30d = close.iloc[-30:] if len(close) >= 30 else close
    high_30d = float(close_30d.max())
    low_30d = float(close_30d.min())
    fib_30d = fib_service.compute(high_30d, low_30d, close_latest)

    payload = {
        "symbol": symbol,
        "name": None,
        "date_labels": date_labels,
        "signals": signals,
        "closes": closes,
        "close": close_latest,
        "chart_data": chart_data,
        "scores": {
            "score_1": float(scores.score_1.iloc[-1]) if pd.notna(scores.score_1.iloc[-1]) else None,
            "score_2": float(scores.score_2.iloc[-1]) if pd.notna(scores.score_2.iloc[-1]) else None,
            "score_3": float(scores.score_3.iloc[-1]) if pd.notna(scores.score_3.iloc[-1]) else None,
        },
        "emas": {
            "ema_10": float(ind.ema[10].iloc[-1]),
            "ema_20": float(ind.ema[20].iloc[-1]),
            "ema_30": float(ind.ema[30].iloc[-1]),
            "ema_50": float(ind.ema[50].iloc[-1]),
            "ema_100": float(ind.ema[100].iloc[-1]),
            "ema_200": float(ind.ema[200].iloc[-1]),
            "avg_all_emas": float(ind.avg_all_emas.iloc[-1]),
        },
        "fib": {
            "high_52week": fib_52w.high_52week,
            "low_52week": fib_52w.low_52week,
            "px_last": fib_52w.px_last,
            "fib_61_8": fib_52w.fib_61_8,
            "fib_50": fib_52w.fib_50,
            "fib_38_2": fib_52w.fib_38_2,
            "fib_23_6": fib_52w.fib_23_6,
        },
        "fib_30d": {
            "high_30d": fib_30d.high_52week,
            "low_30d": fib_30d.low_52week,
            "px_last": fib_30d.px_last,
            "fib_61_8": fib_30d.fib_61_8,
            "fib_50": fib_30d.fib_50,
            "fib_38_2": fib_30d.fib_38_2,
            "fib_23_6": fib_30d.fib_23_6,
        },
    }
    return payload

