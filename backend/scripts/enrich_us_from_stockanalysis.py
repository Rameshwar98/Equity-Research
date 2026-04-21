from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path
from typing import Any, Iterable

import httpx


UNIVERSE_DIR = Path(__file__).resolve().parents[1] / "app" / "universe"


def _load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _dump(path: Path, data: dict[str, Any]) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _extract_cell_value(html: str, label: str) -> str | None:
    """
    StockAnalysis company pages render a key/value table:
      <td>Industry</td><td>Semiconductors</td>
      <td>Sector</td><td>Technology</td>
    We parse the anchor text from the value cell.
    """
    # Match: <td ...>LABEL</td> <td ...> ... >VALUE</a>
    pat = rf">{re.escape(label)}</td>\s*<td[^>]*>.*?>\s*([^<]+?)\s*</a>"
    m = re.search(pat, html, re.I | re.S)
    if m:
        v = m.group(1).strip()
        return v or None
    # Sometimes not linked; fallback to plain text in td
    pat2 = rf">{re.escape(label)}</td>\s*<td[^>]*>\s*([^<]+?)\s*</td>"
    m2 = re.search(pat2, html, re.I | re.S)
    if m2:
        v = m2.group(1).strip()
        return v or None
    return None


async def fetch_sector_industry(client: httpx.AsyncClient, ticker: str) -> tuple[str | None, str | None]:
    url = f"https://stockanalysis.com/stocks/{ticker.lower()}/company/"
    r = await client.get(url, timeout=30)
    r.raise_for_status()
    # StockAnalysis uses "Sector" and "Industry". We map:
    # - sector -> sector
    # - industry -> sub_sector
    industry = _extract_cell_value(r.text, "Industry")
    sector = _extract_cell_value(r.text, "Sector")
    return sector, industry


async def enrich_file(path: Path, only_symbols: set[str] | None = None) -> None:
    raw = _load(path)
    rows = raw.get("constituents") or []
    if not isinstance(rows, list) or not rows:
        return

    need: list[str] = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        sym = (r.get("symbol") or "").strip()
        if not sym:
            continue
        if only_symbols is not None and sym not in only_symbols:
            continue
        if not r.get("sector") or not r.get("sub_sector"):
            need.append(sym)

    if not need:
        return

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }

    sem = asyncio.Semaphore(4)
    async with httpx.AsyncClient(headers=headers, follow_redirects=True) as client:

        async def one(sym: str) -> tuple[str, str | None, str | None]:
            async with sem:
                try:
                    sec, ind = await fetch_sector_industry(client, sym)
                    return sym, sec, ind
                except Exception:
                    return sym, None, None

        results = await asyncio.gather(*(one(s) for s in need))
        m = {sym: {"sector": sec, "sub_sector": ind} for sym, sec, ind in results}

    out_rows: list[dict[str, Any]] = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        sym = (r.get("symbol") or "").strip()
        if sym in m:
            if not r.get("sector") and m[sym]["sector"]:
                r["sector"] = m[sym]["sector"]
            if not r.get("sub_sector") and m[sym]["sub_sector"]:
                r["sub_sector"] = m[sym]["sub_sector"]
        out_rows.append(r)

    _dump(path, {"constituents": out_rows})


async def main() -> None:
    targets = [
        ("nasdaq100.json", None),
        ("dow30.json", None),
    ]
    for fn, only in targets:
        p = UNIVERSE_DIR / fn
        if p.exists():
            await enrich_file(p, only_symbols=only)
            print(f"Updated {fn}")


if __name__ == "__main__":
    asyncio.run(main())

