from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Iterable

import httpx


def _read_env_key(dotenv_path: Path) -> str:
    if not dotenv_path.exists():
        return os.environ.get("FMP_API_KEY", "").strip()
    for line in dotenv_path.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, v = s.split("=", 1)
        if k.strip() == "FMP_API_KEY":
            return v.strip()
    return os.environ.get("FMP_API_KEY", "").strip()


def _norm_row(row: dict[str, Any]) -> dict[str, Any]:
    # FMP payload keys differ slightly by endpoint; normalize to our universe schema.
    sym = (row.get("symbol") or row.get("ticker") or "").strip()
    name = (
        row.get("name")
        or row.get("companyName")
        or row.get("company")
        or row.get("security")
        or None
    )
    sector = row.get("sector") or None
    sub_sector = row.get("subSector") or row.get("industry") or row.get("sub_sector") or None
    out: dict[str, Any] = {"symbol": sym, "name": name}
    if sector is not None:
        out["sector"] = sector
    if sub_sector is not None:
        out["sub_sector"] = sub_sector
    return out


def _fetch_list(url: str, api_key: str, timeout_seconds: float = 30.0) -> list[dict[str, Any]]:
    headers = {"User-Agent": "Mozilla/5.0"}
    with httpx.Client(timeout=timeout_seconds, headers=headers) as client:
        resp = client.get(url, params={"apikey": api_key})
        if resp.status_code in (401, 403):
            raise RuntimeError(f"FMP auth failed ({resp.status_code}). Check key/plan.")
        resp.raise_for_status()
        data = resp.json()
    if not isinstance(data, list):
        raise RuntimeError(f"Unexpected FMP payload for {url}: {type(data).__name__}")
    return [r for r in data if isinstance(r, dict)]


def _unique_by_symbol(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for r in rows:
        sym = (r.get("symbol") or "").strip()
        if not sym or sym in seen:
            continue
        seen.add(sym)
        out.append(r)
    return out


def _write_universe(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"constituents": rows}
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    backend_dir = repo_root / "backend"
    universe_dir = backend_dir / "app" / "universe"
    dotenv_path = backend_dir / ".env"
    api_key = _read_env_key(dotenv_path)
    if not api_key:
        raise SystemExit("Missing FMP_API_KEY (backend/.env or env var).")

    # FMP v3 constituent endpoints.
    # Note: S&P 500 already exists in repo; this script is mainly for Dow/Nasdaq.
    endpoints = {
        "dow30": "https://financialmodelingprep.com/api/v3/dowjones_constituent",
        "nasdaq100": "https://financialmodelingprep.com/api/v3/nasdaq_constituent",
    }

    for name, url in endpoints.items():
        raw = _fetch_list(url, api_key)
        norm = _unique_by_symbol([_norm_row(r) for r in raw])
        if len(norm) < 20:
            raise RuntimeError(f"{name}: suspiciously small constituent count: {len(norm)}")
        _write_universe(universe_dir / f"{name}.json", norm)
        print(f"Wrote {name}.json ({len(norm)} constituents)")


if __name__ == "__main__":
    main()

