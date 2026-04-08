from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional
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


def _qf_income(x: Any) -> float | None:
    try:
        if x is None:
            return None
        v = float(x)
        return v if v == v else None
    except (TypeError, ValueError):
        return None


def _q_row_date(r: dict[str, Any]) -> str:
    return str(r.get("date") or r.get("endDate") or "")[:10]


def _index_quarterly_by_date(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    m: dict[str, dict[str, Any]] = {}
    for r in rows:
        d = _q_row_date(r)
        if len(d) >= 10:
            m[d] = r
    return m


def _align_quarter_row(
    inc_row: dict[str, Any],
    by_date: dict[str, dict[str, Any]],
    all_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    d = _q_row_date(inc_row)
    if d and d in by_date:
        return by_date[d]
    p, cy = inc_row.get("period"), inc_row.get("calendarYear")
    if p is not None and cy is not None:
        for r in all_rows:
            if r.get("period") == p and r.get("calendarYear") == cy:
                return r
    return {}


def _income_yoy_index(rows: list[dict[str, Any]]) -> dict[tuple[str, int], dict[str, Any]]:
    m: dict[tuple[str, int], dict[str, Any]] = {}
    for r in rows:
        p = str(r.get("period") or "").strip().upper()
        cy = r.get("calendarYear")
        if not p.startswith("Q") or cy is None:
            continue
        try:
            m[(p, int(cy))] = r
        except (TypeError, ValueError):
            continue
    return m


def _row_fiscal_year(r: dict[str, Any]) -> int | None:
    """FMP uses calendarYear on many payloads; stable/legacy may omit it — fall back to statement date."""
    for key in ("calendarYear", "calendar_year", "fiscalYear", "year"):
        if key not in r or r[key] is None:
            continue
        try:
            return int(r[key])
        except (TypeError, ValueError):
            continue
    d = _q_row_date(r)
    if len(d) >= 4:
        try:
            return int(d[:4])
        except ValueError:
            pass
    return None


def _is_quarter_period_only_row(r: dict[str, Any]) -> bool:
    """True for quarterly rows (Q1–Q4), not FY/annual."""
    p = str(r.get("period") or "").strip().upper()
    return p in ("Q1", "Q2", "Q3", "Q4")


def _income_yoy_by_year(rows: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    """Map fiscal year → income row (annual statements)."""
    m: dict[int, dict[str, Any]] = {}
    for r in rows:
        if _is_quarter_period_only_row(r):
            continue
        fy = _row_fiscal_year(r)
        if fy is None:
            continue
        m[fy] = r
    return m


def _pick_float(row: dict[str, Any], *keys: str) -> float | None:
    for k in keys:
        if k in row and row[k] is not None:
            return _qf_income(row[k])
    return None


def _as_display_percent(row: dict[str, Any], *keys: str) -> float | None:
    v = _pick_float(row, *keys)
    if v is None:
        return None
    if -1.0 < v < 1.0 and v != 0.0:
        return round(v * 100.0, 2)
    return round(v, 2)


def build_financials_payload(
    income: list[dict[str, Any]],
    balance: list[dict[str, Any]],
    ratios: list[dict[str, Any]],
    cashflow: list[dict[str, Any]],
    key_metrics: list[dict[str, Any]],
    last_close: float | None,
    n: int,
    period_kind: Literal["quarterly", "annual"],
) -> dict[str, Any] | None:
    """
    Oldest → newest columns. Merges FMP income + balance + ratios + cash flow + key metrics.
    Quarterly: last n quarters. Annual: last n fiscal years (non-quarter rows).
    """
    if not income:
        return None

    year_ix: dict[int, dict[str, Any]] | None = None
    yoy_ix_q: dict[tuple[str, int], dict[str, Any]] | None = None
    picked_inc: list[dict[str, Any]]

    if period_kind == "quarterly":
        sorted_inc = sorted(
            [r for r in income if isinstance(r, dict) and _q_row_date(r)],
            key=_q_row_date,
            reverse=True,
        )
        if not sorted_inc:
            return None
        picked_inc = list(reversed(sorted_inc[:n]))
        yoy_ix_q = _income_yoy_index(income)
    else:
        annual_cand: list[dict[str, Any]] = []
        for r in income:
            if not isinstance(r, dict) or not _q_row_date(r):
                continue
            if _is_quarter_period_only_row(r):
                continue
            if _row_fiscal_year(r) is None:
                continue
            annual_cand.append(r)
        if not annual_cand:
            return None
        sorted_inc = sorted(
            annual_cand,
            key=lambda r: (_row_fiscal_year(r) or 0),
            reverse=True,
        )
        picked_inc = list(reversed(sorted_inc[:n]))
        year_ix = _income_yoy_by_year(income)

    nc = len(picked_inc)

    bal_by = _index_quarterly_by_date(balance)
    ratio_by = _index_quarterly_by_date(ratios)
    cf_by = _index_quarterly_by_date(cashflow)
    km_by = _index_quarterly_by_date(key_metrics)

    columns: list[str] = []
    period_end_dates: list[str] = []
    for r in picked_inc:
        if period_kind == "quarterly":
            period = str(r.get("period") or "").strip()
            cy = r.get("calendarYear")
            if cy is not None and period.upper().startswith("Q"):
                columns.append(f"{period} {cy}")
            else:
                columns.append(_q_row_date(r) or "—")
        else:
            fy = _row_fiscal_year(r)
            columns.append(f"FY {fy}" if fy is not None else (_q_row_date(r) or "—"))
        period_end_dates.append(_q_row_date(r))

    def bal_i(i: int) -> dict[str, Any]:
        return _align_quarter_row(picked_inc[i], bal_by, balance)

    def ratio_i(i: int) -> dict[str, Any]:
        return _align_quarter_row(picked_inc[i], ratio_by, ratios)

    def cf_i(i: int) -> dict[str, Any]:
        return _align_quarter_row(picked_inc[i], cf_by, cashflow)

    def km_i(i: int) -> dict[str, Any]:
        return _align_quarter_row(picked_inc[i], km_by, key_metrics)

    def col_inc(*keys: str) -> list[float | None]:
        return [_pick_float(picked_inc[i], *keys) for i in range(nc)]

    rows_out: list[dict[str, Any]] = []

    def push(
        label: str,
        vals: list[float | None],
        fmt: str,
        *,
        spacer: bool = False,
    ) -> None:
        row: dict[str, Any] = {"label": label, "values": vals, "format": fmt}
        if spacer:
            row["spacer"] = True
        rows_out.append(row)

    lp = [None] * nc
    if last_close is not None and nc:
        lp[-1] = round(float(last_close), 4)
    push("Last price (live)", lp, "price")
    push("", [None] * nc, "price", spacer=True)

    push(
        "Total equity",
        [
            _pick_float(
                bal_i(i),
                "totalStockholdersEquity",
                "totalEquity",
                "totalShareholdersEquity",
            )
            for i in range(nc)
        ],
        "compact_currency",
    )
    push("Preferred stock", [_pick_float(bal_i(i), "preferredStock") for i in range(nc)], "compact_currency")
    td_vals: list[float | None] = []
    for i in range(nc):
        b = bal_i(i)
        t = _pick_float(b, "totalDebt")
        if t is None:
            st = _pick_float(b, "shortTermDebt") or 0.0
            lt = _pick_float(b, "longTermDebt") or 0.0
            if st or lt:
                t = float(st + lt)
            else:
                t = None
        td_vals.append(t)
    push("Total debt", td_vals, "compact_currency")
    push(
        "Cash & equivalents",
        [
            _pick_float(
                bal_i(i),
                "cashAndCashEquivalents",
                "cashAndShortTermInvestments",
            )
            for i in range(nc)
        ],
        "compact_currency",
    )
    net_d: list[float | None] = []
    for i in range(nc):
        b = bal_i(i)
        debt = td_vals[i]
        cash = _pick_float(b, "cashAndCashEquivalents", "cashAndShortTermInvestments")
        if debt is not None and cash is not None:
            net_d.append(round(debt - cash, 2))
        else:
            net_d.append(_pick_float(b, "netDebt"))
    push("Net debt", net_d, "compact_currency")

    push("", [None] * nc, "price", spacer=True)

    rev_yoy: list[float | None] = []
    for i in range(nc):
        ir = picked_inc[i]
        rev = _pick_float(ir, "revenue")
        if period_kind == "quarterly":
            p = str(ir.get("period") or "").strip().upper()
            cy = ir.get("calendarYear")
            if rev is None or not p.startswith("Q") or cy is None or not yoy_ix_q:
                rev_yoy.append(None)
                continue
            try:
                prior = yoy_ix_q.get((p, int(cy) - 1))
            except (TypeError, ValueError):
                rev_yoy.append(None)
                continue
        else:
            if rev is None or not year_ix:
                rev_yoy.append(None)
                continue
            icy = _row_fiscal_year(ir)
            if icy is None:
                rev_yoy.append(None)
                continue
            prior = year_ix.get(icy - 1)
        if not prior:
            rev_yoy.append(None)
            continue
        pr = _pick_float(prior, "revenue")
        if pr and pr != 0:
            rev_yoy.append(round(100.0 * (rev - pr) / abs(pr), 2))
        else:
            rev_yoy.append(None)

    push("Revenue", col_inc("revenue"), "compact_currency")
    push("Revenue growth (YoY %)", rev_yoy, "percent")
    push("Cost of revenue", col_inc("costOfRevenue"), "compact_currency")
    gp = col_inc("grossProfit")
    push("Gross profit", gp, "compact_currency")
    gm_pct: list[float | None] = []
    for i in range(nc):
        rv = _as_display_percent(ratio_i(i), "grossProfitMargin")
        if rv is not None:
            gm_pct.append(rv)
        else:
            rev = _pick_float(picked_inc[i], "revenue")
            g = gp[i]
            if rev and rev != 0 and g is not None:
                gm_pct.append(round(100.0 * g / rev, 2))
            else:
                gm_pct.append(None)
    push("Gross margin %", gm_pct, "percent")

    push(
        "Operating expenses",
        col_inc("operatingExpenses", "totalOperatingExpenses"),
        "compact_currency",
    )
    push("Operating income", col_inc("operatingIncome"), "compact_currency")
    om: list[float | None] = []
    for i in range(nc):
        ov = _as_display_percent(ratio_i(i), "operatingProfitMargin")
        if ov is not None:
            om.append(ov)
        else:
            rev = _pick_float(picked_inc[i], "revenue")
            oi = _pick_float(picked_inc[i], "operatingIncome")
            if rev and rev != 0 and oi is not None:
                om.append(round(100.0 * oi / rev, 2))
            else:
                om.append(None)
    push("Operating margin %", om, "percent")

    ebitda_v = col_inc("ebitda")
    push("EBITDA", ebitda_v, "compact_currency")
    em: list[float | None] = []
    for i in range(nc):
        ev = _as_display_percent(ratio_i(i), "ebitdaMargin", "ebitMargin")
        if ev is not None:
            em.append(ev)
        else:
            rev = _pick_float(picked_inc[i], "revenue")
            e = ebitda_v[i]
            if rev and rev != 0 and e is not None:
                em.append(round(100.0 * e / rev, 2))
            else:
                em.append(None)
    push("EBITDA margin %", em, "percent")

    ni = col_inc("netIncome")
    push("Net income", ni, "compact_currency")
    nm: list[float | None] = []
    for i in range(nc):
        nv = _as_display_percent(ratio_i(i), "netProfitMargin")
        if nv is not None:
            nm.append(nv)
        else:
            rev = _pick_float(picked_inc[i], "revenue")
            nn = ni[i]
            if rev and rev != 0 and nn is not None:
                nm.append(round(100.0 * nn / rev, 2))
            else:
                nm.append(None)
    push("Net margin %", nm, "percent")

    eps_dil = col_inc("epsdiluted")
    eps_bas = col_inc("eps")
    eps_use = eps_dil if any(v is not None for v in eps_dil) else eps_bas
    eps_lbl = "EPS (diluted)" if any(v is not None for v in eps_dil) else "EPS"
    push(eps_lbl, eps_use, "per_share")
    push("Interest expense", col_inc("interestExpense"), "compact_currency")
    push("Income tax expense", col_inc("incomeTaxExpense"), "compact_currency")

    push("", [None] * nc, "price", spacer=True)

    ocf: list[float | None] = []
    capex: list[float | None] = []
    fcf: list[float | None] = []
    for i in range(nc):
        c = cf_i(i)
        oc = _pick_float(
            c,
            "operatingCashFlow",
            "netCashProvidedByOperatingActivities",
        )
        cx = _pick_float(
            c,
            "capitalExpenditure",
            "investmentsInPropertyPlantAndEquipment",
        )
        ocf.append(oc)
        capex.append(cx)
        if oc is not None:
            if cx is not None:
                fcf.append(round(oc - abs(cx), 2))
            else:
                fcf.append(oc)
        else:
            fcf.append(_pick_float(c, "freeCashFlow"))
    push("Operating cash flow", ocf, "compact_currency")
    push("Capital expenditure", capex, "compact_currency")
    push("Free cash flow", fcf, "compact_currency")

    push("", [None] * nc, "price", spacer=True)

    push(
        "ROE %",
        [
            _as_display_percent(ratio_i(i), "returnOnEquity", "roe")
            or _as_display_percent(km_i(i), "returnOnEquity", "roe")
            for i in range(nc)
        ],
        "percent",
    )
    push(
        "Debt to equity",
        [
            _pick_float(ratio_i(i), "debtToEquity")
            or _pick_float(km_i(i), "debtToEquity")
            for i in range(nc)
        ],
        "ratio",
    )
    push(
        "Current ratio",
        [
            _pick_float(ratio_i(i), "currentRatio")
            or _pick_float(km_i(i), "currentRatio")
            for i in range(nc)
        ],
        "ratio",
    )

    return {
        "columns": columns,
        "period_end_dates": period_end_dates,
        "rows": rows_out,
    }


def build_quarterly_financials_payload(
    income: list[dict[str, Any]],
    balance: list[dict[str, Any]],
    ratios: list[dict[str, Any]],
    cashflow: list[dict[str, Any]],
    key_metrics: list[dict[str, Any]],
    last_close: float | None,
    n: int = 8,
) -> dict[str, Any] | None:
    return build_financials_payload(
        income, balance, ratios, cashflow, key_metrics, last_close, n, "quarterly"
    )


def build_annual_financials_payload(
    income: list[dict[str, Any]],
    balance: list[dict[str, Any]],
    ratios: list[dict[str, Any]],
    cashflow: list[dict[str, Any]],
    key_metrics: list[dict[str, Any]],
    last_close: float | None,
    n: int = 3,
) -> dict[str, Any] | None:
    return build_financials_payload(
        income, balance, ratios, cashflow, key_metrics, last_close, n, "annual"
    )


@router.get("/stock/{symbol}/details")
async def stock_details(
    symbol: str,
    history_months: int = Query(12, ge=1, le=18, description="How many months of trend history to return"),
    selected_score: str = Query("score_3", description="Which score to use for signal classification"),
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

    selected: ScoreKey = selected_score if selected_score in ("score_1", "score_2", "score_3") else "score_3"  # type: ignore[assignment]
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
    ema_series = {p: ind.ema[p].reindex(recent.index) for p in [10, 20, 30, 50, 100, 200]}

    # RSI 14
    delta = close.diff()
    gain = delta.where(delta > 0, 0.0).ewm(span=14, adjust=False).mean()
    loss = (-delta.where(delta < 0, 0.0)).ewm(span=14, adjust=False).mean()
    rs = gain / loss.replace(0, float("nan"))
    rsi_full = 100 - (100 / (1 + rs))
    rsi_series = rsi_full.reindex(recent.index)

    # MACD (12, 26, 9)
    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    macd_line_full = ema12 - ema26
    macd_signal_full = macd_line_full.ewm(span=9, adjust=False).mean()
    macd_hist_full = macd_line_full - macd_signal_full
    macd_line_s = macd_line_full.reindex(recent.index)
    macd_signal_s = macd_signal_full.reindex(recent.index)
    macd_hist_s = macd_hist_full.reindex(recent.index)

    # Volume data + EMA5 volume + volume ratio for heatmap
    vol_col = None
    for col_name in ("Volume", "volume"):
        if col_name in prices.columns:
            vol_col = col_name
            break
    volume_series = prices[vol_col].reindex(recent.index) if vol_col else None

    vol_ema5_series = None
    vol_ratio_series = None
    if volume_series is not None:
        vol_full = prices[vol_col].astype(float)
        vol_ema5_full = vol_full.ewm(span=5, adjust=False).mean()
        vol_avg20_full = vol_full.rolling(window=20, min_periods=1).mean()
        vol_ema5_series = vol_ema5_full.reindex(recent.index)
        vol_ratio_series = (vol_full / vol_avg20_full.replace(0, float("nan"))).reindex(recent.index)

    close_change_series = close.diff().reindex(recent.index)

    def _r2(s: pd.Series, i: int) -> float | None:
        v = s.iloc[i]
        return round(float(v), 2) if pd.notna(v) else None

    # Build chart_data array (chronological: oldest first)
    chart_data = []
    for idx_pos, dt_idx in enumerate(recent.index):
        d = dates[idx_pos]
        entry: Dict[str, Any] = {
            "date": d,
            "close": _r2(close_for_dates, idx_pos),
            "ema10": _r2(ema_series[10], idx_pos),
            "ema20": _r2(ema_series[20], idx_pos),
            "ema30": _r2(ema_series[30], idx_pos),
            "ema50": _r2(ema_series[50], idx_pos),
            "ema100": _r2(ema_series[100], idx_pos),
            "ema200": _r2(ema_series[200], idx_pos),
            "rsi": _r2(rsi_series, idx_pos),
            "macd": _r2(macd_line_s, idx_pos),
            "macdSignal": _r2(macd_signal_s, idx_pos),
            "macdHist": _r2(macd_hist_s, idx_pos),
            "signal": signals[idx_pos] if idx_pos < len(signals) else None,
        }
        if volume_series is not None and pd.notna(volume_series.iloc[idx_pos]):
            entry["volume"] = int(volume_series.iloc[idx_pos])
        if vol_ema5_series is not None and pd.notna(vol_ema5_series.iloc[idx_pos]):
            entry["volEma5"] = int(vol_ema5_series.iloc[idx_pos])
        if vol_ratio_series is not None and pd.notna(vol_ratio_series.iloc[idx_pos]):
            entry["volRatio"] = round(float(vol_ratio_series.iloc[idx_pos]), 2)
        if pd.notna(close_change_series.iloc[idx_pos]):
            entry["priceUp"] = float(close_change_series.iloc[idx_pos]) >= 0
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
    def _qf_list(res: Any) -> list[dict[str, Any]]:
        if isinstance(res, Exception):
            logger.debug("quarterly fetch: %s", res)
            return []
        return [r for r in res if isinstance(r, dict)] if isinstance(res, list) else []

    try:
        (
            inc_t,
            bal_t,
            rat_t,
            cf_t,
            km_t,
            inc_a,
            bal_a,
            rat_a,
            cf_a,
            km_a,
        ) = await asyncio.gather(
            provider.fetch_fmp_quarterly_series(symbol, "income-statement", 24, 20.0, True),
            provider.fetch_fmp_quarterly_series(
                symbol, "balance-sheet-statement", 24, 20.0, True
            ),
            provider.fetch_fmp_quarterly_series(symbol, "ratios", 24, 20.0, True),
            provider.fetch_fmp_quarterly_series(
                symbol, "cash-flow-statement", 24, 20.0, True
            ),
            provider.fetch_fmp_quarterly_series(symbol, "key-metrics", 24, 20.0, True),
            provider.fetch_fmp_annual_series(symbol, "income-statement", 6, 20.0),
            provider.fetch_fmp_annual_series(symbol, "balance-sheet-statement", 6, 20.0),
            provider.fetch_fmp_annual_series(symbol, "ratios", 6, 20.0),
            provider.fetch_fmp_annual_series(symbol, "cash-flow-statement", 6, 20.0),
            provider.fetch_fmp_annual_series(symbol, "key-metrics", 6, 20.0),
            return_exceptions=True,
        )
        payload["quarterly_financials"] = build_quarterly_financials_payload(
            _qf_list(inc_t),
            _qf_list(bal_t),
            _qf_list(rat_t),
            _qf_list(cf_t),
            _qf_list(km_t),
            close_latest,
            n=8,
        )
        payload["annual_financials"] = build_annual_financials_payload(
            _qf_list(inc_a),
            _qf_list(bal_a),
            _qf_list(rat_a),
            _qf_list(cf_a),
            _qf_list(km_a),
            close_latest,
            n=3,
        )
    except Exception as e:
        logger.warning("fundamentals financials %s: %s", symbol, e)
        payload["quarterly_financials"] = None
        payload["annual_financials"] = None

    return payload


def _peer_sig_classify(v: Any) -> str:
    try:
        if v is None or (hasattr(v, "__float__") and (v != v)):
            return "N/A"
        f = float(v)
    except Exception:
        return "N/A"
    if f > 1.08:
        return "BUY"
    if f < 0.95:
        return "SELL"
    return "HOLD"


def _peer_pct_return(close: pd.Series, days: int) -> float | None:
    s = close.dropna()
    if len(s) <= days:
        return None
    try:
        latest = float(s.iloc[-1])
        old = float(s.iloc[-(days + 1)])
        if old == 0:
            return None
        return round((latest - old) / old * 100, 2)
    except Exception:
        return None


def _peer_ytd(close: pd.Series) -> float | None:
    s = close.dropna()
    if s.empty:
        return None
    try:
        latest = float(s.iloc[-1])
        y = s.index[-1].year
        prev = s[s.index.year < y]
        if prev.empty:
            return None
        base = float(prev.iloc[-1])
        if base == 0:
            return None
        return round((latest - base) / base * 100, 2)
    except Exception:
        return None


def _peer_safe_float_series_val(v: Any) -> float | None:
    """Match analysis_service._safe_float (handles pd.NA / NaN)."""
    try:
        if v is None or pd.isna(v):
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def _peer_weekly_signals_1y(score_series: pd.Series | None) -> tuple[list[str], list[str]]:
    """
    Last ~52 weekly score classifications (Fri week-end), oldest → newest — same logic as dashboard heatmap.
    """
    if score_series is None or len(score_series) < 2:
        return [], []
    ser = score_series.sort_index()
    if not isinstance(ser.index, pd.DatetimeIndex):
        ser = ser.copy()
        ser.index = pd.to_datetime(ser.index, errors="coerce")
    # Drop bad / duplicate calendar rows (bad cache rows used to break .date() and trip the old bare except → empty heatmap).
    ser = ser[ser.index.notna()]
    ser = ser[~ser.index.duplicated(keep="last")].sort_index()
    if len(ser) < 2:
        return [], []

    weekly_dates: list[str] = []
    weekly_signals: list[str] = []
    fri_grouper = pd.Grouper(freq="W-FRI", label="right", closed="right")
    for _week_end, grp in ser.groupby(fri_grouper):
        if grp.empty:
            continue
        last_ts = grp.index[-1]
        if pd.isna(last_ts):
            continue
        try:
            weekly_dates.append(pd.Timestamp(last_ts).date().isoformat())
        except (ValueError, OSError):
            continue
        weekly_signals.append(_peer_sig_classify(_peer_safe_float_series_val(grp.iloc[-1])))

    n_1y = 52
    tail_d = weekly_dates[-n_1y:] if weekly_dates else []
    tail_s = weekly_signals[-n_1y:] if weekly_signals else []
    return tail_s, tail_d


def _norm_peer_symbol(s: str) -> str:
    """Match universe tickers to FMP (BRK-B vs BRK.B)."""
    return s.upper().replace("-", ".").strip()


# Max tickers in the peer table (subject + peers).
PEER_TABLE_MAX = 10
# Max FMP peer names to consider before ranking by market cap.
_FMP_PEER_CANDIDATE_CAP = 55


async def _peer_merge_fmp_meta(
    cache: Any,
    provider: Any,
    symbols: List[str],
    meta_ttl: int,
    timeout_seconds: float,
) -> Dict[str, Dict[str, Any]]:
    fresh, stale = await cache.get_symbol_fmp_meta_batch(symbols, meta_ttl)
    if not stale:
        return fresh
    fetched = await provider.fetch_peer_metadata(stale, timeout_seconds=timeout_seconds)
    await cache.put_symbol_fmp_meta_batch(fetched)
    out = dict(fresh)
    empty = {"mkt_cap": None, "name": None, "announcement_date": None}
    for s in stale:
        out[s] = fetched.get(s) or dict(empty)
    return out


@router.get("/stock/{symbol}/peers")
async def stock_peers(
    symbol: str,
    index_name: str = Query(..., description="Universe index (e.g. sp500)"),
    selected_score: str = Query("score_3"),
    limit: int = Query(10, ge=2, le=10),
) -> Dict[str, Any]:
    """
    Peers: FMP stock-peers (index-filtered) or sector fallback; ranked by market cap; up to 10 names.
    Peer list + FMP metadata are cached (SQLite when persist_cache=True, else in-memory).
    """
    from app.main import analysis_service, indicator_service, provider, scoring_service, universe_service, settings

    if selected_score not in ("score_1", "score_2", "score_3"):
        selected_score = "score_3"
    sk: ScoreKey = selected_score  # type: ignore[assignment]

    cap_limit = min(limit, PEER_TABLE_MAX)
    cache = analysis_service.cache
    peer_ttl = settings.peer_cache_ttl_seconds
    meta_ttl = settings.peer_fmp_meta_ttl_seconds

    try:
        universe = universe_service.get_universe(index_name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    constituents = universe.constituents
    if not constituents:
        return {"subject_symbol": symbol.upper(), "sector": None, "peer_source": None, "peers": []}

    sym_u = symbol.upper()
    anchor = next((c for c in constituents if c.symbol.upper() == sym_u), None)
    if anchor is None:
        raise HTTPException(status_code=404, detail=f"Symbol {symbol} not in index {index_name}")

    sector = (anchor.sector or "").strip()
    sym_to_c = {c.symbol: c for c in constituents}

    chosen: List[Any] = []
    meta: Dict[str, Dict[str, Any]] = {}
    peer_source = "fmp"

    pc = await cache.get_peer_comparison_cache(index_name, sym_u, peer_ttl)
    if pc:
        ok = True
        resolved: List[Any] = []
        for s in pc["symbols"]:
            c = sym_to_c.get(s)
            if c is None:
                ok = False
                break
            resolved.append(c)
        if ok and len(resolved) >= 2:
            chosen = resolved[:cap_limit]
            meta = {c.symbol: pc["meta"].get(c.symbol, {}) for c in chosen}
            peer_source = pc["peer_source"]

    if not chosen:
        by_norm: Dict[str, Any] = {_norm_peer_symbol(c.symbol): c for c in constituents}
        peer_source = "fmp"
        seen_norm = {_norm_peer_symbol(anchor.symbol)}
        fmp_candidates: List[Any] = []

        fmp_raw = await provider.fetch_stock_peers_symbols(symbol, timeout_seconds=22.0)
        for raw in fmp_raw:
            c = by_norm.get(_norm_peer_symbol(raw))
            if c is None:
                continue
            nn = _norm_peer_symbol(c.symbol)
            if nn in seen_norm:
                continue
            seen_norm.add(nn)
            fmp_candidates.append(c)
            if len(fmp_candidates) >= _FMP_PEER_CANDIDATE_CAP:
                break

        if not fmp_candidates:
            peer_source = "sector"
            if sector:
                pool = [c for c in constituents if (c.sector or "").strip() == sector]
            else:
                pool = list(constituents)
            seen: Dict[str, Any] = {}
            for c in pool:
                seen[c.symbol] = c
            pool_list = sorted(seen.values(), key=lambda x: x.symbol)
            if len(pool_list) > 45:
                pool_list = pool_list[:45]

            meta_all = await _peer_merge_fmp_meta(
                cache,
                provider,
                [c.symbol for c in pool_list],
                meta_ttl,
                35.0,
            )

            def cap_val(c: Any) -> float:
                m = meta_all.get(c.symbol, {}).get("mkt_cap")
                return float(m) if m is not None else -1.0

            pool_sorted_cap = sorted(pool_list, key=cap_val, reverse=True)
            others = [c for c in pool_sorted_cap if c.symbol.upper() != sym_u][: max(1, cap_limit - 1)]
            chosen = [anchor] + others
            meta = {
                c.symbol: meta_all.get(
                    c.symbol, {"mkt_cap": None, "name": None, "announcement_date": None}
                )
                for c in chosen
            }
        else:
            sym_meta = list({anchor.symbol, *[c.symbol for c in fmp_candidates]})
            meta_all = await _peer_merge_fmp_meta(cache, provider, sym_meta, meta_ttl, 35.0)
            others_sorted = sorted(
                fmp_candidates,
                key=lambda c: float(meta_all.get(c.symbol, {}).get("mkt_cap") or -1),
                reverse=True,
            )
            others = others_sorted[: max(1, cap_limit - 1)]
            chosen = [anchor] + others
            meta = {
                c.symbol: meta_all.get(
                    c.symbol, {"mkt_cap": None, "name": None, "announcement_date": None}
                )
                for c in chosen
            }

        try:
            await cache.put_peer_comparison_cache(
                index_name,
                sym_u,
                peer_source,
                [c.symbol for c in chosen],
                meta,
            )
        except Exception as e:
            logger.debug("peer_comparison_cache put: %s", e)

    sym_load = [c.symbol for c in chosen]
    try:
        prices_by = await analysis_service._load_prices(
            sym_load, refresh=False, timeout_seconds=45.0
        )
    except Exception as e:
        logger.warning("peer prices load: %s", e)
        prices_by = {}

    peers_out: list[Dict[str, Any]] = []
    for c in chosen:
        df = prices_by.get(c.symbol)
        if df is None or df.empty or "Close" not in df.columns:
            peers_out.append(
                {
                    "symbol": c.symbol,
                    "name": meta.get(c.symbol, {}).get("name") or c.name,
                    "mkt_cap": meta.get(c.symbol, {}).get("mkt_cap"),
                    "signal": "N/A",
                    "return_1d": None,
                    "return_1w": None,
                    "return_1m": None,
                    "return_3m": None,
                    "return_ytd": None,
                    "signals_1y": [],
                    "signals_1y_dates": [],
                    "is_subject": c.symbol.upper() == sym_u,
                }
            )
            continue

        prices = df.dropna(subset=["Close"]).sort_index()
        close = prices["Close"].astype(float)
        if len(close) < 65:
            peers_out.append(
                {
                    "symbol": c.symbol,
                    "name": meta.get(c.symbol, {}).get("name") or c.name,
                    "mkt_cap": meta.get(c.symbol, {}).get("mkt_cap"),
                    "signal": "N/A",
                    "return_1d": None,
                    "return_1w": None,
                    "return_1m": None,
                    "return_3m": None,
                    "return_ytd": None,
                    "signals_1y": [],
                    "signals_1y_dates": [],
                    "is_subject": c.symbol.upper() == sym_u,
                }
            )
            continue

        ind = indicator_service.compute_indicators(prices)
        avg_last5 = indicator_service.avg_last_5_close(close)
        prev_close = indicator_service.prev_close(close)
        scores = scoring_service.compute_scores(close, avg_last5, prev_close, ind.avg_all_emas)
        series = scores.get(sk)
        sig = _peer_sig_classify(series.iloc[-1]) if series is not None and len(series) else "N/A"
        sig_1y, sig_1y_dates = _peer_weekly_signals_1y(series)

        peers_out.append(
            {
                "symbol": c.symbol,
                "name": meta.get(c.symbol, {}).get("name") or c.name,
                "mkt_cap": meta.get(c.symbol, {}).get("mkt_cap"),
                "signal": sig,
                "return_1d": _peer_pct_return(close, 1),
                "return_1w": _peer_pct_return(close, 5),
                "return_1m": _peer_pct_return(close, 21),
                "return_3m": _peer_pct_return(close, 63),
                "return_ytd": _peer_ytd(close),
                "signals_1y": sig_1y,
                "signals_1y_dates": sig_1y_dates,
                "is_subject": c.symbol.upper() == sym_u,
            }
        )

    peers_out.sort(key=lambda r: (not r.get("is_subject"), -(r.get("mkt_cap") or -1)))

    return {
        "subject_symbol": symbol.upper(),
        "sector": sector or None,
        "peer_source": peer_source,
        "peers": peers_out,
    }

