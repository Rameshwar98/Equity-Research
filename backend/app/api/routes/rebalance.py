from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.parse import quote

from fastapi import APIRouter, HTTPException
from starlette.responses import Response

from app.schemas.momentum import HoldingsView, MomentumPreview, MomentumSnapshot
from app.services.momentum_service import MomentumIQService
from app.services.price_tracking_store import PriceTrackingStore

router = APIRouter()

_log = logging.getLogger(__name__)

_RUNS: Dict[str, Dict[str, Any]] = {}
_RUNS_LOCK = asyncio.Lock()

_PREVIEWS: Dict[str, MomentumPreview] = {}
_SNAPSHOT_CANDIDATES: Dict[str, MomentumSnapshot] = {}
_CREATED_AT: Dict[str, float] = {}
_PREVIEW_LOCK = asyncio.Lock()

_TTL_SECONDS = 10 * 60

# Phase 6 hardening: per-portfolio preview cooldown (seconds)
_PREVIEW_COOLDOWN_SECONDS = 30
_LAST_PREVIEW_STARTED_AT: Dict[str, float] = {}  # portfolio_id -> epoch seconds

# Phase 6 hardening: idempotent commit (run_id -> snapshot)
_COMMITTED: Dict[str, MomentumSnapshot] = {}


def _schedule_price_backfill(*, portfolio_id: str, universe: str, benchmark_symbol: str | None) -> None:
    """Run inception→today backfill off the request thread so commit returns quickly."""

    async def _run() -> None:
        try:
            from app.main import price_tracking_service

            await price_tracking_service.backfill_from_inception(
                portfolio_id=portfolio_id,
                universe=universe,
                benchmark_symbol=benchmark_symbol,
            )
        except Exception:
            _log.exception("background backfill failed portfolio_id=%s", portfolio_id)

    asyncio.create_task(_run())


@router.post("/portfolios/{portfolio_id}/backfill")
async def dev_backfill_from_inception(portfolio_id: str) -> dict:
    """
    Dev endpoint: trigger daily-tracking backfill without committing a new snapshot.
    Returns row counts or the error message.
    """
    from app.main import portfolio_store, price_tracking_service, settings

    p = await portfolio_store.get(portfolio_id)
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    try:
        await price_tracking_service.backfill_from_inception(
            portfolio_id=portfolio_id,
            universe=p.params.universe,
            benchmark_symbol=p.params.benchmark,
        )

        # Return counts from tracking DB for quick verification
        track_db = PriceTrackingStore(Path(settings.cache_dir) / "portfolio_tracking.db")
        await track_db.ensure_schema()
        entries = await track_db.get_entries(portfolio_id=portfolio_id)
        series = await track_db.get_daily_series(portfolio_id=portfolio_id)
        latest = await track_db.get_latest_closes(portfolio_id=portfolio_id)
        return {
            "ok": True,
            "portfolio_id": portfolio_id,
            "entries": len(entries),
            "daily_series_points": len(series),
            "latest_closes_symbols": len(latest),
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _make_run_id(portfolio_id: str) -> str:
    return f"{portfolio_id}::{int(time.time() * 1000)}"


async def _set_run_state(run_id: str, patch: Dict[str, Any]) -> None:
    async with _RUNS_LOCK:
        cur = _RUNS.get(run_id) or {}
        if cur.get("status") == "done" and patch.get("status") not in (None, "done", "error"):
            return
        # If an error is being recorded, ensure status is error.
        if patch.get("error") not in (None, "", False) and patch.get("status") in (None, "running"):
            patch = dict(patch)
            patch["status"] = "error"
        cur.update(patch)
        _RUNS[run_id] = cur

        # Persist to disk so refreshes keep progress.
        try:
            from app.main import settings

            progress_dir = Path(settings.cache_dir) / "rebalance_progress"
            progress_dir.mkdir(parents=True, exist_ok=True)
            safe_id = quote(run_id, safe="")
            (progress_dir / f"{safe_id}.json").write_text(
                json.dumps(cur, default=str), encoding="utf-8"
            )
        except Exception:
            pass


async def _get_run_state(run_id: str) -> Optional[Dict[str, Any]]:
    async with _RUNS_LOCK:
        st = _RUNS.get(run_id)
        if st:
            return dict(st)

    try:
        from app.main import settings

        progress_dir = Path(settings.cache_dir) / "rebalance_progress"
        safe_id = quote(run_id, safe="")
        path = progress_dir / f"{safe_id}.json"
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _services() -> tuple[MomentumIQService, Any]:
    from app.main import cache_service, provider, settings, universe_service
    from app.services.indicator_service import IndicatorService

    momentum = MomentumIQService(
        provider=provider,
        cache=cache_service,
        universe_svc=universe_service,
        indicator_svc=IndicatorService(),
        fmp_period=settings.fmp_period,
        fmp_interval=settings.fmp_interval,
    )
    from app.main import portfolio_store

    return momentum, portfolio_store


async def _gc_previews() -> None:
    now = time.time()
    async with _PREVIEW_LOCK:
        expired = [rid for rid, ts in _CREATED_AT.items() if (now - ts) > _TTL_SECONDS]
        for rid in expired:
            _PREVIEWS.pop(rid, None)
            _SNAPSHOT_CANDIDATES.pop(rid, None)
            _CREATED_AT.pop(rid, None)
            _COMMITTED.pop(rid, None)


@router.post("/portfolios/{portfolio_id}/rebalance-with-progress")
async def start_rebalance(portfolio_id: str) -> Dict[str, Any]:
    momentum, store = _services()
    p = await store.get(portfolio_id)
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    # Rate limit: one preview per portfolio per 30 seconds.
    now = time.time()
    last = _LAST_PREVIEW_STARTED_AT.get(portfolio_id)
    if last and (now - last) < _PREVIEW_COOLDOWN_SECONDS:
        retry_after = int(_PREVIEW_COOLDOWN_SECONDS - (now - last))
        raise HTTPException(
            status_code=429,
            detail=f"Please wait {retry_after}s before starting another rebalance preview.",
            headers={"Retry-After": str(max(1, retry_after))},
        )
    _LAST_PREVIEW_STARTED_AT[portfolio_id] = now

    run_id = _make_run_id(portfolio_id)
    await _set_run_state(
        run_id,
        {
            "status": "running",
            "processed": 0,
            "total": 0,
            "message": "Queued",
            "started_at": datetime.now(timezone.utc).isoformat(),
            "error": None,
        },
    )

    async def _task() -> None:
        try:
            latest, prev = await store.get_latest_snapshots(portfolio_id)

            last_persist_at = 0.0
            last_processed = -1

            def progress_cb(processed: int, total: int, phase: str) -> None:
                nonlocal last_persist_at, last_processed
                now = time.time()
                should = (
                    processed == 0
                    or processed == 1
                    or processed == total
                    or (processed - last_processed) >= 25
                    or (now - last_persist_at) >= 1.0
                )
                if not should:
                    return
                last_persist_at = now
                last_processed = processed
                asyncio.create_task(
                    _set_run_state(
                        run_id,
                        {
                            "status": "running",
                            "processed": processed,
                            "total": total,
                            "message": phase,
                            "error": None,
                        },
                    )
                )

            result = await momentum.compute_rebalance_preview(
                portfolio_id=portfolio_id,
                params=p.params,
                latest_snapshot=latest,
                previous_snapshot=prev,
                progress_cb=progress_cb,
            )
            result.preview.run_id = run_id

            async with _PREVIEW_LOCK:
                _PREVIEWS[run_id] = result.preview
                _SNAPSHOT_CANDIDATES[run_id] = result.snapshot_candidate
                _CREATED_AT[run_id] = time.time()

            await _set_run_state(
                run_id,
                {
                    "status": "done",
                    "processed": int(_RUNS.get(run_id, {}).get("total") or 0),
                    "total": int(_RUNS.get(run_id, {}).get("total") or 0),
                    "message": "Done",
                    "error": None,
                },
            )
        except Exception as e:
            import logging

            logging.getLogger(__name__).exception("Rebalance run failed: %s", run_id)
            await _set_run_state(
                run_id,
                {
                    "status": "error",
                    "message": "Error",
                    "error": str(e),
                },
            )

    asyncio.create_task(_task())
    return {"run_id": run_id}


@router.get("/portfolios/{portfolio_id}/rebalance-with-progress/{run_id}")
async def rebalance_progress(portfolio_id: str, run_id: str) -> Dict[str, Any]:
    _ = portfolio_id
    st = await _get_run_state(run_id)
    if not st:
        raise HTTPException(status_code=404, detail="Unknown run_id")

    started_at = st.get("started_at")
    processed = int(st.get("processed") or 0)
    total = int(st.get("total") or 0)
    status = st.get("status") or "running"
    # If an error is recorded, surface it as error status (prevents UI hanging on "running").
    if status == "running" and st.get("error"):
        status = "error"

    eta_seconds: Optional[float] = None
    if started_at and total > 0 and processed > 0 and status not in ("done", "error"):
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


@router.get("/portfolios/{portfolio_id}/rebalance-preview/{run_id}", response_model=MomentumPreview)
async def get_preview(portfolio_id: str, run_id: str) -> MomentumPreview:
    await _gc_previews()
    async with _PREVIEW_LOCK:
        p = _PREVIEWS.get(run_id)
    if not p or p.portfolio_id != portfolio_id:
        raise HTTPException(status_code=404, detail="Preview not found (expired or unknown run_id)")
    return p


@router.post("/portfolios/{portfolio_id}/rebalance-discard/{run_id}")
async def discard_preview(portfolio_id: str, run_id: str) -> Dict[str, Any]:
    await _gc_previews()
    async with _PREVIEW_LOCK:
        p = _PREVIEWS.get(run_id)
        if not p or p.portfolio_id != portfolio_id:
            raise HTTPException(status_code=404, detail="Preview not found")
        _PREVIEWS.pop(run_id, None)
        _SNAPSHOT_CANDIDATES.pop(run_id, None)
        _CREATED_AT.pop(run_id, None)
    return {"ok": True}


@router.post("/portfolios/{portfolio_id}/rebalance-commit/{run_id}", response_model=MomentumSnapshot)
async def commit_preview(portfolio_id: str, run_id: str) -> MomentumSnapshot:
    momentum, store = _services()
    _ = momentum
    await _gc_previews()

    # Idempotency: if already committed, return the same snapshot.
    committed = _COMMITTED.get(run_id)
    if committed and committed.portfolio_id == portfolio_id:
        return committed

    async with _PREVIEW_LOCK:
        snap = _SNAPSHOT_CANDIDATES.get(run_id)
        p = _PREVIEWS.get(run_id)
        if not snap or not p or p.portfolio_id != portfolio_id:
            raise HTTPException(status_code=404, detail="Preview not found")

    await store.append_snapshot(portfolio_id, snap)
    try:
        from app.api.routes.portfolio_analytics import _ANALYTICS_CACHE

        _ANALYTICS_CACHE.pop(portfolio_id, None)
    except Exception:
        pass
    # Phase 7: persist entry prices on commit (fast); backfill daily series in background.
    try:
        from app.main import price_tracking_service, portfolio_store

        await price_tracking_service.on_snapshot_committed(portfolio_id=portfolio_id, snapshot=snap)
        p0 = await portfolio_store.get(portfolio_id)
        if p0:
            _schedule_price_backfill(
                portfolio_id=portfolio_id,
                universe=p0.params.universe,
                benchmark_symbol=p0.params.benchmark,
            )
    except Exception:
        # Never block commits on tracking persistence.
        pass
    _COMMITTED[run_id] = snap
    # discard after commit
    async with _PREVIEW_LOCK:
        _PREVIEWS.pop(run_id, None)
        _SNAPSHOT_CANDIDATES.pop(run_id, None)
        _CREATED_AT.pop(run_id, None)
    return snap


@router.post("/portfolios/{portfolio_id}/rebalance-auto", response_model=MomentumSnapshot)
async def rebalance_auto_commit(portfolio_id: str) -> MomentumSnapshot:
    """
    Phase 6: Scheduler / manual endpoint to run a rebalance and commit directly.
    """
    momentum, store = _services()
    p = await store.get(portfolio_id)
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    latest, prev = await store.get_latest_snapshots(portfolio_id)
    result = await momentum.compute_rebalance_preview(
        portfolio_id=portfolio_id,
        params=p.params,
        latest_snapshot=latest,
        previous_snapshot=prev,
        progress_cb=None,
    )
    await store.append_snapshot(portfolio_id, result.snapshot_candidate)
    # Phase 7: persist entry prices on commit (fast); backfill daily series in background.
    try:
        from app.main import price_tracking_service

        await price_tracking_service.on_snapshot_committed(
            portfolio_id=portfolio_id, snapshot=result.snapshot_candidate
        )
        if p:
            _schedule_price_backfill(
                portfolio_id=portfolio_id,
                universe=p.params.universe,
                benchmark_symbol=p.params.benchmark,
            )
    except Exception:
        pass
    return result.snapshot_candidate


@router.get("/portfolios/{portfolio_id}/holdings", response_model=HoldingsView)
async def holdings_view(portfolio_id: str) -> Response:
    try:
        _, store = _services()
        p = await store.get(portfolio_id)
        if not p:
            raise HTTPException(status_code=404, detail="Portfolio not found")

        latest, prev = await store.get_latest_snapshots(portfolio_id)
        incoming = []
        outgoing = []
        doi: list[dict] = []
        if latest and prev:
            latest_holdings = latest.holdings or []
            prev_holdings = prev.holdings or []
            latest_syms = {h.symbol for h in latest_holdings if h.symbol}
            prev_syms = {h.symbol for h in prev_holdings if h.symbol}
            incoming = [h for h in latest_holdings if h.symbol and h.symbol not in prev_syms]
            outgoing = [h for h in prev_holdings if h.symbol and h.symbol not in latest_syms]
            # Degree-of-improvement uses ranks between prev and latest (top100 maps)
            for sym, cur_rank in (latest.top100_ranks or {}).items():
                if not sym or sym in latest_syms:
                    continue
                if sym not in (prev.top100_ranks or {}):
                    continue
                try:
                    pr = prev.top100_ranks[sym]
                    cr = cur_rank
                    if pr is None or cr is None:
                        continue
                    pr_i = int(pr)
                    cr_i = int(cr)
                except (TypeError, ValueError):
                    continue
                delta = pr_i - cr_i
                if delta <= 0:
                    continue
                doi.append(
                    {
                        "symbol": sym,
                        "rank_delta": delta,
                        "previous_rank": pr_i,
                        "current_rank": cr_i,
                    }
                )
            try:
                doi.sort(key=lambda r: (-int(r["rank_delta"]), int(r["current_rank"]), str(r["symbol"])))
            except (TypeError, ValueError):
                doi = []
            doi = doi[:20]

        # Starlette JSONResponse uses json.dumps(..., allow_nan=False). Snapshot rows can
        # contain NaN from upstream prices; Pydantic's model_dump_json() emits strict JSON (nulls).
        hv = HoldingsView(
            portfolio_id=portfolio_id,
            last_snapshot=latest,
            previous_snapshot=prev,
            incoming=incoming,
            outgoing=outgoing,
            degree_of_improvement_watchlist=doi,
        )
        return Response(content=hv.model_dump_json(), media_type="application/json")
    except HTTPException:
        raise
    except Exception as e:
        _log.exception("holdings_view failed portfolio_id=%s", portfolio_id)
        raise HTTPException(
            status_code=500,
            detail=f"Could not build holdings view: {e!s}",
        ) from e

