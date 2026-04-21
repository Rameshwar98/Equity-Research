from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Any

import httpx


UNIVERSE_DIR = Path(__file__).resolve().parents[1] / "app" / "universe"
NSE_BASE = "https://www.nseindia.com"


def _load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _dump(path: Path, data: dict[str, Any]) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _nse_symbol(sym: str) -> str:
    # Our universe uses Yahoo-style `.NS`; NSE API expects plain symbol.
    s = (sym or "").strip()
    return s[:-3] if s.endswith(".NS") else s


async def _nse_bootstrap(client: httpx.AsyncClient) -> None:
    # NSE requires cookies; a landing page visit usually sets them.
    await client.get(f"{NSE_BASE}/", timeout=45)


async def fetch_industry_info(client: httpx.AsyncClient, sym: str) -> dict[str, str | None]:
    url = f"{NSE_BASE}/api/quote-equity"
    params = {"symbol": sym}
    # Retry a few times – NSE often drops requests.
    last_exc: Exception | None = None
    for attempt in range(1, 5):
        try:
            r = await client.get(url, params=params, timeout=45)
            r.raise_for_status()
            data = r.json()
            last_exc = None
            break
        except Exception as e:
            last_exc = e
            await asyncio.sleep(0.5 * attempt)
    if last_exc is not None:
        raise last_exc
    info = data.get("industryInfo") if isinstance(data, dict) else None
    if not isinstance(info, dict):
        return {"sector": None, "sub_sector": None}
    sector = info.get("sector")
    # Prefer micro-level "basicIndustry"; fall back to "industry"
    sub = info.get("basicIndustry") or info.get("industry")
    return {
        "sector": str(sector).strip() if sector else None,
        "sub_sector": str(sub).strip() if sub else None,
    }


async def enrich_file(path: Path) -> None:
    raw = _load(path)
    items = raw.get("constituents") or []
    if not isinstance(items, list) or not items:
        return

    # Normalize to objects
    out_items: list[dict[str, Any]] = []
    symbols: list[str] = []
    for it in items:
        if isinstance(it, str):
            obj = {"symbol": it, "name": None, "sector": None, "sub_sector": None}
        else:
            obj = dict(it)
            obj.setdefault("name", None)
            obj.setdefault("sector", None)
            obj.setdefault("sub_sector", None)
        sym = obj.get("symbol")
        if sym:
            symbols.append(str(sym))
        out_items.append(obj)

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        "Accept": "application/json,text/plain,*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": f"{NSE_BASE}/get-quotes/equity",
        "Connection": "keep-alive",
    }

    async with httpx.AsyncClient(headers=headers, follow_redirects=True) as client:
        await _nse_bootstrap(client)

        # Throttle to be friendly to NSE; still faster than manual.
        sem = asyncio.Semaphore(2)

        async def one(sym_full: str) -> tuple[str, dict[str, str | None]]:
            async with sem:
                sym = _nse_symbol(sym_full)
                # tiny delay to avoid triggering blocks
                await asyncio.sleep(0.12)
                try:
                    return sym_full, await fetch_industry_info(client, sym)
                except Exception:
                    return sym_full, {"sector": None, "sub_sector": None}

        results = await asyncio.gather(*(one(s) for s in symbols))
        info_map = {k: v for k, v in results}

    # Apply: overwrite incorrect "sector" with NSE sector; store old sector as sub_sector if NSE missing.
    for obj in out_items:
        sym = obj.get("symbol")
        if not sym:
            continue
        info = info_map.get(str(sym)) or {}
        nse_sector = info.get("sector")
        nse_sub = info.get("sub_sector")

        old_sector = obj.get("sector")

        if nse_sector:
            obj["sector"] = nse_sector
        if nse_sub:
            obj["sub_sector"] = nse_sub
        else:
            # if NSE failed for this symbol, at least keep prior value as sub-sector hint
            if obj.get("sub_sector") is None and old_sector:
                obj["sub_sector"] = old_sector

    _dump(path, {"constituents": out_items})


async def main() -> None:
    targets = [
        UNIVERSE_DIR / "nifty50.json",
        UNIVERSE_DIR / "niftynext50.json",
        UNIVERSE_DIR / "nifty500.json",
    ]
    for p in targets:
        if p.exists():
            t0 = time.time()
            await enrich_file(p)
            dt = time.time() - t0
            print(f"Updated {p.name} in {dt:.1f}s")


if __name__ == "__main__":
    asyncio.run(main())

