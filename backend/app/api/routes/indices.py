from __future__ import annotations

import asyncio
import time

from fastapi import APIRouter, Depends, HTTPException, Query

from app.schemas.common import Constituent, IndexInfo
from app.services.universe_service import UniverseService

router = APIRouter()


def get_universe_service() -> UniverseService:
    # late import to avoid cycles
    from app.main import universe_service

    return universe_service


def get_provider():
    from app.main import provider

    return provider


# In-memory cache for enriched constituent lists.
_enriched_cache: dict[str, tuple[float, list[Constituent]]] = {}
_enriched_lock = asyncio.Lock()
_ENRICH_TTL_SECONDS = 6 * 60 * 60  # 6 hours


@router.get("/indices", response_model=list[IndexInfo])
async def list_indices(svc: UniverseService = Depends(get_universe_service)) -> list[IndexInfo]:
    return svc.list_indices()


@router.get("/index/{index_name}/constituents", response_model=list[Constituent])
async def constituents(index_name: str, svc: UniverseService = Depends(get_universe_service)) -> list[Constituent]:
    try:
        u = svc.get_universe(index_name)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    # Use universe version + ttl to avoid hammering FMP.
    cache_key = f"{index_name}::{svc.universe_version(index_name)}"
    now = time.time()
    async with _enriched_lock:
        cached = _enriched_cache.get(cache_key)
        if cached and (now - cached[0]) < _ENRICH_TTL_SECONDS:
            return cached[1]

    provider = get_provider()
    items = list(u.constituents)

    # First: attempt index-level mapping (US indices have dedicated endpoints).
    sector_map = {}
    try:
        fetch_sector_map = getattr(provider, "fetch_sector_map", None)
        if fetch_sector_map:
            sector_map = await fetch_sector_map(index_name)
    except Exception:
        sector_map = {}

    # Fill from sector_map if present.
    enriched: list[Constituent] = []
    missing_symbols: list[str] = []
    for c in items:
        if (c.sector is None or c.sub_sector is None) and c.symbol in sector_map:
            m = sector_map.get(c.symbol) or {}
            c = c.model_copy(
                update={
                    "sector": c.sector or m.get("sector"),
                    "sub_sector": c.sub_sector or m.get("sub_sector"),
                }
            )
        if c.sector is None or c.sub_sector is None:
            missing_symbols.append(c.symbol)
        enriched.append(c)

    # Fallback: per-symbol classification (works for India indices too).
    if missing_symbols:
        try:
            fetch_cls = getattr(provider, "fetch_symbol_classification", None)
            if fetch_cls:
                cls = await fetch_cls(missing_symbols)
                cls = cls or {}
                enriched2: list[Constituent] = []
                for c in enriched:
                    if c.symbol in cls and (c.sector is None or c.sub_sector is None):
                        m = cls.get(c.symbol) or {}
                        c = c.model_copy(
                            update={
                                "sector": c.sector or m.get("sector"),
                                "sub_sector": c.sub_sector or m.get("sub_sector"),
                            }
                        )
                    enriched2.append(c)
                enriched = enriched2
        except Exception:
            pass

    async with _enriched_lock:
        _enriched_cache[cache_key] = (now, enriched)
    return enriched


@router.get("/stocks", response_model=list[Constituent])
async def list_stocks(
    q: str | None = Query(None, description="Filter by symbol or name (case-insensitive)"),
    index_name: str | None = Query(None, description="Optional index filter (e.g. sp500, nifty50)"),
    limit: int = Query(200, ge=1, le=5000),
    svc: UniverseService = Depends(get_universe_service),
) -> list[Constituent]:
    """
    "Live list" of stocks for search/autocomplete.
    Uses universe JSON(s) and enriches sector/sub-sector via the same logic as constituents().
    """
    qn = (q or "").strip().lower()

    indices = [index_name] if index_name else [i.name for i in svc.list_indices() if i.name != "custom"]
    seen: set[str] = set()
    out: list[Constituent] = []

    for idx in indices:
        try:
            rows = await constituents(idx, svc)
        except Exception:
            continue
        for c in rows:
            if c.symbol in seen:
                continue
            seen.add(c.symbol)
            if qn:
                hay = f"{c.symbol} {c.name or ''} {c.sector or ''} {c.sub_sector or ''}".lower()
                if qn not in hay:
                    continue
            out.append(c)
            if len(out) >= limit:
                return out
    return out

