from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

import aiosqlite
import pandas as pd

from app.utils.time import utc_now

logger = logging.getLogger(__name__)


def _dt_to_iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def _iso_to_dt(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


@dataclass(frozen=True)
class CachedRun:
    run_id: str
    cached_at: datetime
    payload: Dict[str, Any]


class CacheService:
    def __init__(self, db_path: str, cache_dir: str) -> None:
        self.db_path = db_path
        self.cache_dir = cache_dir
        Path(cache_dir).mkdir(parents=True, exist_ok=True)

    async def upsert_price_history(self, symbol: str, prices: pd.DataFrame) -> None:
        if prices is None or prices.empty:
            return

        now = _dt_to_iso(utc_now())
        rows = []
        for idx, r in prices.iterrows():
            date = idx.date().isoformat()
            rows.append(
                (
                    symbol,
                    date,
                    float(r.get("Open")) if pd.notna(r.get("Open")) else None,
                    float(r.get("High")) if pd.notna(r.get("High")) else None,
                    float(r.get("Low")) if pd.notna(r.get("Low")) else None,
                    float(r.get("Close")) if pd.notna(r.get("Close")) else None,
                    float(r.get("Adj Close")) if pd.notna(r.get("Adj Close")) else None,
                    float(r.get("Volume")) if pd.notna(r.get("Volume")) else None,
                    now,
                )
            )

        async with aiosqlite.connect(self.db_path) as db:
            await db.executemany(
                """
                INSERT INTO price_history(symbol,date,open,high,low,close,adj_close,volume,updated_at)
                VALUES(?,?,?,?,?,?,?,?,?)
                ON CONFLICT(symbol,date) DO UPDATE SET
                  open=excluded.open,
                  high=excluded.high,
                  low=excluded.low,
                  close=excluded.close,
                  adj_close=excluded.adj_close,
                  volume=excluded.volume,
                  updated_at=excluded.updated_at
                """,
                rows,
            )
            await db.commit()

    async def get_price_history(self, symbol: str, limit_days: int = 800) -> pd.DataFrame:
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            cur = await db.execute(
                """
                SELECT date, open, high, low, close, adj_close, volume
                FROM price_history
                WHERE symbol = ?
                ORDER BY date ASC
                """,
                (symbol,),
            )
            rows = await cur.fetchall()

        if not rows:
            return pd.DataFrame()

        # aiosqlite.Row doesn't always become named columns via DataFrame(rows)
        df = pd.DataFrame([dict(r) for r in rows])
        df["date"] = pd.to_datetime(df["date"])
        df = df.set_index("date")
        df = df.rename(
            columns={
                "open": "Open",
                "high": "High",
                "low": "Low",
                "close": "Close",
                "adj_close": "Adj Close",
                "volume": "Volume",
            }
        )
        if limit_days and len(df) > limit_days:
            df = df.iloc[-limit_days:]
        return df

    async def put_run(self, run_id: str, index_name: str, selected_score: str, refresh_data: bool, payload: Dict[str, Any]) -> datetime:
        cached_at = utc_now()
        cached_at_iso = _dt_to_iso(cached_at)
        payload_json = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                """
                INSERT INTO analysis_runs(run_id,index_name,selected_score,refresh_data,cached_at,payload_json)
                VALUES(?,?,?,?,?,?)
                ON CONFLICT(run_id) DO UPDATE SET
                  index_name=excluded.index_name,
                  selected_score=excluded.selected_score,
                  refresh_data=excluded.refresh_data,
                  cached_at=excluded.cached_at,
                  payload_json=excluded.payload_json
                """,
                (run_id, index_name, selected_score, 1 if refresh_data else 0, cached_at_iso, payload_json),
            )
            await db.commit()

        # latest run JSON for fast boot
        latest_path = Path(self.cache_dir) / "latest_run.json"
        latest_path.write_text(payload_json, encoding="utf-8")
        return cached_at

    async def get_latest_run(self) -> Optional[CachedRun]:
        latest_path = Path(self.cache_dir) / "latest_run.json"
        if latest_path.exists():
            try:
                payload = json.loads(latest_path.read_text(encoding="utf-8"))
                cached_at = payload.get("cached_at")
                if cached_at:
                    return CachedRun(run_id="latest", cached_at=_iso_to_dt(cached_at), payload=payload)
            except Exception:
                pass
        return None

    async def get_recent_run_for_key(self, run_key: str, ttl_seconds: int) -> Optional[CachedRun]:
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            cur = await db.execute(
                "SELECT run_id, cached_at, payload_json FROM analysis_runs WHERE run_id = ?",
                (run_key,),
            )
            row = await cur.fetchone()
        if not row:
            return None

        cached_at = _iso_to_dt(row["cached_at"])
        age = (utc_now() - cached_at).total_seconds()
        if ttl_seconds > 0 and age > ttl_seconds:
            return None
        payload = json.loads(row["payload_json"])
        return CachedRun(run_id=row["run_id"], cached_at=cached_at, payload=payload)


class EphemeralCacheService:
    """
    Drop-in cache service that disables persistence.
    Useful for local runs where we want fetch->compute->respond only.
    """

    async def upsert_price_history(self, symbol: str, prices: pd.DataFrame) -> None:
        return None

    async def get_price_history(self, symbol: str, limit_days: int = 800) -> pd.DataFrame:
        return pd.DataFrame()

    async def put_run(self, run_id: str, index_name: str, selected_score: str, refresh_data: bool, payload: Dict[str, Any]) -> datetime:
        return utc_now()

    async def get_latest_run(self) -> Optional[CachedRun]:
        return None

    async def get_recent_run_for_key(self, run_key: str, ttl_seconds: int) -> Optional[CachedRun]:
        return None


class MemoryCacheService:
    """
    In-memory cache (no disk writes).
    - Speeds up repeated requests within the same backend process lifetime.
    - Avoids FMP rate limits much better than the purely-ephemeral mode.
    """

    def __init__(self, price_history_limit_days: int = 800) -> None:
        self.price_history_limit_days = price_history_limit_days
        self._price_history_by_symbol: Dict[str, pd.DataFrame] = {}
        self._analysis_runs_by_run_id: Dict[str, CachedRun] = {}
        self._latest_run: Optional[CachedRun] = None
        self._lock = asyncio.Lock()

    async def upsert_price_history(self, symbol: str, prices: pd.DataFrame) -> None:
        if prices is None or prices.empty:
            return

        async with self._lock:
            df = prices.copy()
            if self.price_history_limit_days and len(df) > self.price_history_limit_days:
                df = df.iloc[-self.price_history_limit_days :]
            self._price_history_by_symbol[symbol] = df

    async def get_price_history(self, symbol: str, limit_days: int = 800) -> pd.DataFrame:
        async with self._lock:
            df = self._price_history_by_symbol.get(symbol)
            if df is None or df.empty:
                return pd.DataFrame()

            if limit_days and len(df) > limit_days:
                return df.iloc[-limit_days:]
            return df

    async def put_run(
        self,
        run_id: str,
        index_name: str,
        selected_score: str,
        refresh_data: bool,
        payload: Dict[str, Any],
    ) -> datetime:
        cached_at = utc_now()
        cached = CachedRun(run_id=run_id, cached_at=cached_at, payload=payload)

        async with self._lock:
            self._analysis_runs_by_run_id[run_id] = cached
            self._latest_run = cached

        return cached_at

    async def get_latest_run(self) -> Optional[CachedRun]:
        async with self._lock:
            return self._latest_run

    async def get_recent_run_for_key(self, run_key: str, ttl_seconds: int) -> Optional[CachedRun]:
        async with self._lock:
            cached = self._analysis_runs_by_run_id.get(run_key)
            if not cached:
                return None

            age = (utc_now() - cached.cached_at).total_seconds()
            if ttl_seconds > 0 and age > ttl_seconds:
                return None

            return cached

