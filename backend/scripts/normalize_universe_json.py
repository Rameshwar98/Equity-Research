from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from app.services.fmp_provider import FMPProvider


UNIVERSE_DIR = Path(__file__).resolve().parents[1] / "app" / "universe"


def _load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _dump(path: Path, data: dict[str, Any]) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _as_obj(item: Any) -> dict[str, Any]:
    if isinstance(item, str):
        return {"symbol": item, "name": None, "sector": None, "sub_sector": None}
    if isinstance(item, dict):
        return {
            "symbol": item.get("symbol"),
            "name": item.get("name"),
            "sector": item.get("sector"),
            "sub_sector": item.get("sub_sector") or item.get("subSector"),
        }
    return {"symbol": None, "name": None, "sector": None, "sub_sector": None}


def _build_sp500_sector_index() -> dict[str, dict[str, str | None]]:
    """
    Use sp500.json as the canonical sector/sub-sector mapping.
    This lets us enrich other US universes without any API calls.
    """
    p = UNIVERSE_DIR / "sp500.json"
    if not p.exists():
        return {}
    raw = _load(p)
    out: dict[str, dict[str, str | None]] = {}
    for it in raw.get("constituents", []) or []:
        obj = _as_obj(it)
        sym = obj.get("symbol")
        if not sym:
            continue
        out[str(sym)] = {
            "sector": obj.get("sector"),
            "sub_sector": obj.get("sub_sector"),
        }
    return out


async def _normalize_index(
    provider: FMPProvider | None,
    sp500_index: dict[str, dict[str, str | None]],
    index_name: str,
) -> None:
    p = UNIVERSE_DIR / f"{index_name}.json"
    if not p.exists():
        return

    raw = _load(p)
    items = [_as_obj(x) for x in raw.get("constituents", [])]

    # Drop empties
    items = [x for x in items if x.get("symbol")]

    # First: enrich from sp500.json mapping (covers most US tickers).
    if sp500_index:
        for it in items:
            sym = it["symbol"]
            m = sp500_index.get(sym) or {}
            it["sector"] = it.get("sector") or m.get("sector")
            it["sub_sector"] = it.get("sub_sector") or m.get("sub_sector")

    # Second: use FMP index-constituent endpoints when available (optional).
    if provider is not None:
        try:
            sector_map = await provider.fetch_sector_map(index_name)
        except Exception:
            sector_map = {}
        if sector_map:
            for it in items:
                sym = it["symbol"]
                m = sector_map.get(sym) or {}
                it["sector"] = it.get("sector") or m.get("sector")
                it["sub_sector"] = it.get("sub_sector") or m.get("sub_sector")

    # India indices: ensure `sub_sector` exists; use existing sector when no finer breakdown.
    if index_name in ("nifty50", "niftynext50", "nifty500"):
        for it in items:
            if not it.get("sub_sector"):
                it["sub_sector"] = it.get("sector")

    # Ensure keys exist everywhere
    for it in items:
        it.setdefault("name", None)
        it.setdefault("sector", None)
        it.setdefault("sub_sector", None)

    _dump(p, {"constituents": items})


async def main() -> None:
    sp500_index = _build_sp500_sector_index()
    key = os.environ.get("FMP_API_KEY", "").strip()
    provider = FMPProvider(api_key=key) if key else None

    for idx in [
        "sp500",
        "nasdaq100",
        "dow30",
        "nifty50",
        "niftynext50",
        "nifty500",
        "global_indices",
        "global_us",
        "global_europe",
        "global_asia",
        "commodities",
        "sector_indices",
    ]:
        await _normalize_index(provider, sp500_index, idx)


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())

