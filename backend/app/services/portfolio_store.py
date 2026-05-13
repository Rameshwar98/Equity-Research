from __future__ import annotations

import asyncio
import json
import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from app.schemas.momentum import MomentumSnapshot
from app.schemas.portfolio import CreatePortfolioRequest, Portfolio, PortfolioListItem, UpdatePortfolioRequest


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _dt_to_iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def _iso_to_dt(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


@dataclass(frozen=True)
class PortfolioStoreConfig:
    data_path: Path


class PortfolioStore:
    """
    Simple durable store for v1 (single-user).
    Persists server-side across restarts without requiring SQLite/cache flags.

    File format:
      {
        "version": 1,
        "portfolios": [ ...Portfolio json... ],
        "snapshots_by_portfolio": { "<portfolio_id>": [ ...MomentumSnapshot json... ] }
      }
    """

    def __init__(self, config: PortfolioStoreConfig) -> None:
        self._path = config.data_path
        self._lock = asyncio.Lock()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        # Avoid re-parsing / re-validating the full JSON on every API call (snapshots can be huge).
        self._cache_mtime_ns: int | None = None
        self._cache_payload: tuple[list[Portfolio], dict[str, list[MomentumSnapshot]]] | None = None

    def _snapshot_file_mtime_ns(self) -> int | None:
        try:
            st = self._path.stat()
        except OSError:
            return None
        ns = getattr(st, "st_mtime_ns", None)
        if ns is not None:
            return int(ns)
        return int(st.st_mtime * 1_000_000_000)

    def _set_cache(
        self,
        mtime_ns: int | None,
        payload: tuple[list[Portfolio], dict[str, list[MomentumSnapshot]]],
    ) -> None:
        self._cache_mtime_ns = mtime_ns
        self._cache_payload = payload

    def _clear_cache(self) -> None:
        self._cache_mtime_ns = None
        self._cache_payload = None

    async def list(self) -> List[Portfolio]:
        async with self._lock:
            return list(await self._load_unlocked())

    async def get(self, portfolio_id: str) -> Optional[Portfolio]:
        async with self._lock:
            items = await self._load_unlocked()
            for p in items:
                if p.id == portfolio_id:
                    return p
            return None

    async def get_latest_snapshots(
        self, portfolio_id: str
    ) -> Tuple[Optional[MomentumSnapshot], Optional[MomentumSnapshot]]:
        """
        Returns (latest, previous) committed snapshots for the portfolio.
        """
        async with self._lock:
            items, snapshots_by = await self._load_all_unlocked()
            _ = items  # unused; kept for future validations
            snaps = snapshots_by.get(portfolio_id) or []
            latest = snaps[-1] if len(snaps) >= 1 else None
            prev = snaps[-2] if len(snaps) >= 2 else None
            return latest, prev

    async def list_snapshots(self, portfolio_id: str) -> list[MomentumSnapshot]:
        async with self._lock:
            _, snapshots_by = await self._load_all_unlocked()
            snaps = snapshots_by.get(portfolio_id) or []
            # already sorted by created_at in loader
            return list(snaps)

    async def append_snapshot(self, portfolio_id: str, snapshot: MomentumSnapshot) -> None:
        async with self._lock:
            items, snapshots_by = await self._load_all_unlocked()
            if not any(p.id == portfolio_id for p in items):
                raise KeyError("not found")
            snaps = list(snapshots_by.get(portfolio_id) or [])
            snaps.append(snapshot)
            snapshots_by[portfolio_id] = snaps
            await self._save_all_unlocked(items, snapshots_by)

    async def delete_snapshots(self, portfolio_id: str) -> None:
        async with self._lock:
            items, snapshots_by = await self._load_all_unlocked()
            if not any(p.id == portfolio_id for p in items):
                raise KeyError("not found")
            snapshots_by.pop(portfolio_id, None)
            await self._save_all_unlocked(items, snapshots_by)

    async def create(self, req: CreatePortfolioRequest) -> Portfolio:
        async with self._lock:
            items = await self._load_unlocked()
            name = (req.name or "").strip()
            if not name:
                raise ValueError("name is required")
            if any(p.name.strip().lower() == name.lower() for p in items):
                raise ValueError("name must be unique")

            now = _utc_now()
            pid = uuid.uuid4().hex
            p = Portfolio(
                id=pid,
                name=name,
                strategy=req.strategy,
                params=req.params,
                chart_prefs={},
                is_test_mode=False,
                created_at=now,
                updated_at=now,
            )
            items.append(p)
            await self._save_unlocked(items)
            return p

    async def update(self, portfolio_id: str, req: UpdatePortfolioRequest) -> Portfolio:
        async with self._lock:
            items = await self._load_unlocked()
            idx = next((i for i, p in enumerate(items) if p.id == portfolio_id), None)
            if idx is None:
                raise KeyError("not found")

            cur = items[idx]
            name = cur.name
            if req.name is not None:
                next_name = req.name.strip()
                if not next_name:
                    raise ValueError("name is required")
                if any(
                    p.id != cur.id and p.name.strip().lower() == next_name.lower() for p in items
                ):
                    raise ValueError("name must be unique")
                name = next_name

            params = req.params if req.params is not None else cur.params
            now = _utc_now()
            updated = Portfolio(
                id=cur.id,
                name=name,
                strategy=cur.strategy,
                params=params,
                chart_prefs=dict(cur.chart_prefs or {}),
                is_test_mode=cur.is_test_mode,
                created_at=cur.created_at,
                updated_at=now,
            )
            items[idx] = updated
            await self._save_unlocked(items)
            return updated

    async def set_test_mode(self, portfolio_id: str, *, is_test_mode: bool) -> Portfolio:
        async with self._lock:
            items = await self._load_unlocked()
            idx = next((i for i, p in enumerate(items) if p.id == portfolio_id), None)
            if idx is None:
                raise KeyError("not found")
            cur = items[idx]
            now = _utc_now()
            updated = Portfolio(
                id=cur.id,
                name=cur.name,
                strategy=cur.strategy,
                params=cur.params,
                chart_prefs=dict(cur.chart_prefs or {}),
                is_test_mode=is_test_mode,
                created_at=cur.created_at,
                updated_at=now,
            )
            items[idx] = updated
            await self._save_unlocked(items)
            return updated

    async def update_chart_prefs(self, portfolio_id: str, prefs: dict[str, bool]) -> Portfolio:
        async with self._lock:
            items = await self._load_unlocked()
            idx = next((i for i, p in enumerate(items) if p.id == portfolio_id), None)
            if idx is None:
                raise KeyError("not found")

            cur = items[idx]
            merged = dict(cur.chart_prefs or {})
            for k, v in (prefs or {}).items():
                if not isinstance(k, str):
                    continue
                merged[k] = bool(v)

            now = _utc_now()
            updated = Portfolio(
                id=cur.id,
                name=cur.name,
                strategy=cur.strategy,
                params=cur.params,
                chart_prefs=merged,
                is_test_mode=cur.is_test_mode,
                created_at=cur.created_at,
                updated_at=now,
            )
            items[idx] = updated
            await self._save_unlocked(items)
            return updated

    async def delete(self, portfolio_id: str) -> None:
        async with self._lock:
            items = await self._load_unlocked()
            next_items = [p for p in items if p.id != portfolio_id]
            if len(next_items) == len(items):
                raise KeyError("not found")
            await self._save_unlocked(next_items)

    async def duplicate(self, portfolio_id: str) -> Portfolio:
        async with self._lock:
            items = await self._load_unlocked()
            src = next((p for p in items if p.id == portfolio_id), None)
            if src is None:
                raise KeyError("not found")

            base = f"{src.name} (copy)"
            candidate = base
            n = 2
            existing = {p.name.strip().lower() for p in items}
            while candidate.strip().lower() in existing:
                candidate = f"{base} {n}"
                n += 1

            now = _utc_now()
            p = Portfolio(
                id=uuid.uuid4().hex,
                name=candidate,
                strategy=src.strategy,
                params=src.params,
                chart_prefs=dict(src.chart_prefs or {}),
                is_test_mode=False,
                created_at=now,
                updated_at=now,
            )
            items.append(p)
            await self._save_unlocked(items)
            return p

    async def list_items(self) -> List[PortfolioListItem]:
        items, snapshots_by = await self._load_all()
        out: List[PortfolioListItem] = []
        for p in items:
            snaps = snapshots_by.get(p.id) or []
            latest = snaps[-1] if snaps else None
            out.append(
                PortfolioListItem(
                    id=p.id,
                    name=p.name,
                    strategy=p.strategy,
                    universe=p.params.universe,
                    momentum_screen_size=p.params.momentum_screen_size,
                    final_portfolio_size=p.params.final_portfolio_size,
                    is_test_mode=p.is_test_mode,
                    last_run_at=latest.created_at if latest else None,
                    holdings_count=len(latest.holdings) if latest else 0,
                    created_at=p.created_at,
                    updated_at=p.updated_at,
                )
            )
        out.sort(key=lambda x: x.updated_at, reverse=True)
        return out

    async def _load_unlocked(self) -> List[Portfolio]:
        items, _ = await self._load_all_unlocked()
        return items

    async def _load_all(self) -> tuple[list[Portfolio], dict[str, list[MomentumSnapshot]]]:
        async with self._lock:
            return await self._load_all_unlocked()

    async def _load_all_unlocked(self) -> tuple[list[Portfolio], dict[str, list[MomentumSnapshot]]]:
        if not self._path.exists():
            self._clear_cache()
            return ([], {})
        mtime_ns = self._snapshot_file_mtime_ns()
        if (
            mtime_ns is not None
            and self._cache_mtime_ns == mtime_ns
            and self._cache_payload is not None
        ):
            return self._cache_payload
        raw = self._path.read_text(encoding="utf-8").strip()
        if not raw:
            self._set_cache(mtime_ns, ([], {}))
            return ([], {})
        try:
            doc = json.loads(raw)
        except Exception:
            self._clear_cache()
            return ([], {})
        if not isinstance(doc, dict):
            self._clear_cache()
            return ([], {})

        rows = doc.get("portfolios")
        out: List[Portfolio] = []
        if isinstance(rows, list):
            for r in rows:
                if not isinstance(r, dict):
                    continue
                try:
                    out.append(Portfolio.model_validate(r))
                except Exception:
                    continue

        snaps_raw = doc.get("snapshots_by_portfolio") or {}
        snaps_by: dict[str, list[MomentumSnapshot]] = {}
        if isinstance(snaps_raw, dict):
            for pid, arr in snaps_raw.items():
                if not isinstance(pid, str) or not isinstance(arr, list):
                    continue
                snaps: list[MomentumSnapshot] = []
                for r in arr:
                    if not isinstance(r, dict):
                        continue
                    try:
                        snaps.append(MomentumSnapshot.model_validate(r))
                    except Exception:
                        continue
                snaps.sort(key=lambda s: s.created_at)
                snaps_by[pid] = snaps

        payload = (out, snaps_by)
        self._set_cache(mtime_ns, payload)
        return payload

    async def _save_unlocked(self, items: List[Portfolio]) -> None:
        # Preserve snapshots if present.
        _, snapshots_by = await self._load_all_unlocked()
        await self._save_all_unlocked(items, snapshots_by)

    async def _save_all_unlocked(
        self, items: list[Portfolio], snapshots_by: dict[str, list[MomentumSnapshot]]
    ) -> None:
        doc = {
            "version": 2,
            "updated_at": _dt_to_iso(_utc_now()),
            "portfolios": [p.model_dump(mode="json") for p in items],
            "snapshots_by_portfolio": {
                pid: [s.model_dump(mode="json") for s in snaps] for pid, snaps in snapshots_by.items()
            },
        }
        tmp = self._path.with_suffix(self._path.suffix + ".tmp")
        tmp.write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, self._path)
        # In-memory state matches disk; skip a full re-parse on the next read.
        new_mtime = self._snapshot_file_mtime_ns()
        self._set_cache(new_mtime, (list(items), snapshots_by))

