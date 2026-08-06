from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Iterable, Optional

import aiosqlite


@dataclass(frozen=True)
class EntryRow:
    portfolio_id: str
    symbol: str
    entry_date: str  # YYYY-MM-DD
    entry_price: float
    name: str | None
    sector: str | None
    status: str = "open"  # 'open' | 'exited'
    exit_date: str | None = None  # YYYY-MM-DD when the position left the portfolio
    exit_price: float | None = None  # close on/near exit_date


@dataclass(frozen=True)
class DailyPoint:
    date: str  # YYYY-MM-DD
    portfolio_value: float
    benchmark_value: float


class PriceTrackingStore:
    """
    Phase 7 store: daily portfolio tracking persisted to a dedicated SQLite db.
    This is always-on and independent of the analysis cache db.
    """

    def __init__(self, db_path: Path) -> None:
        self.db_path = str(db_path)
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_lock = asyncio.Lock()
        self._initialized = False

    async def ensure_schema(self) -> None:
        if self._initialized:
            return
        async with self._init_lock:
            if self._initialized:
                return
            async with aiosqlite.connect(self.db_path) as db:
                await db.execute(
                    """
                    CREATE TABLE IF NOT EXISTS portfolio_daily_series (
                      portfolio_id TEXT NOT NULL,
                      date TEXT NOT NULL,
                      portfolio_value REAL NOT NULL,
                      benchmark_value REAL NOT NULL,
                      PRIMARY KEY (portfolio_id, date)
                    );
                    """
                )
                await db.execute(
                    """
                    CREATE TABLE IF NOT EXISTS portfolio_daily_prices (
                      portfolio_id TEXT NOT NULL,
                      date TEXT NOT NULL,
                      symbol TEXT NOT NULL,
                      close REAL NOT NULL,
                      PRIMARY KEY (portfolio_id, date, symbol)
                    );
                    """
                )
                await db.execute(
                    """
                    CREATE TABLE IF NOT EXISTS portfolio_entries (
                      portfolio_id TEXT NOT NULL,
                      symbol TEXT NOT NULL,
                      entry_date TEXT NOT NULL,
                      entry_price REAL NOT NULL,
                      name TEXT,
                      sector TEXT,
                      status TEXT NOT NULL DEFAULT 'open',
                      exit_date TEXT,
                      exit_price REAL,
                      PRIMARY KEY (portfolio_id, symbol, entry_date)
                    );
                    """
                )
                # Migration 1: DBs created before exit tracking existed.
                for ddl in (
                    "ALTER TABLE portfolio_entries ADD COLUMN status TEXT NOT NULL DEFAULT 'open'",
                    "ALTER TABLE portfolio_entries ADD COLUMN exit_date TEXT",
                    "ALTER TABLE portfolio_entries ADD COLUMN exit_price REAL",
                ):
                    try:
                        await db.execute(ddl)
                    except Exception:
                        pass  # column already exists
                # Migration 2: single-row-per-symbol → per-leg rows. Old PK was
                # (portfolio_id, symbol), which made a re-entry overwrite the prior
                # round-trip. Rebuild with entry_date in the PK so each entry→exit
                # leg is its own row.
                cur = await db.execute(
                    "SELECT sql FROM sqlite_master WHERE type='table' AND name='portfolio_entries'"
                )
                row = await cur.fetchone()
                ddl_sql = (row[0] or "") if row else ""
                if "entry_date" not in ddl_sql.split("PRIMARY KEY", 1)[-1]:
                    await db.execute("ALTER TABLE portfolio_entries RENAME TO portfolio_entries_old")
                    await db.execute(
                        """
                        CREATE TABLE portfolio_entries (
                          portfolio_id TEXT NOT NULL,
                          symbol TEXT NOT NULL,
                          entry_date TEXT NOT NULL,
                          entry_price REAL NOT NULL,
                          name TEXT,
                          sector TEXT,
                          status TEXT NOT NULL DEFAULT 'open',
                          exit_date TEXT,
                          exit_price REAL,
                          PRIMARY KEY (portfolio_id, symbol, entry_date)
                        );
                        """
                    )
                    await db.execute(
                        """
                        INSERT OR IGNORE INTO portfolio_entries
                        SELECT portfolio_id, symbol, entry_date, entry_price, name, sector,
                               status, exit_date, exit_price
                        FROM portfolio_entries_old
                        """
                    )
                    await db.execute("DROP TABLE portfolio_entries_old")
                await db.commit()
            self._initialized = True

    async def upsert_entries_from_snapshot(
        self,
        *,
        portfolio_id: str,
        entries: Iterable[tuple[str, str, float, str | None, str | None, str]],
    ) -> None:
        """
        Maintain per-LEG entry basis for P&L (one row per entry→exit round-trip).

        Each tuple is (symbol, entry_date, entry_price, name, sector, action).

        A new leg is inserted only when the symbol has no OPEN leg — a held symbol
        keeps its original basis (full holding-period return), while a re-entry after
        an exit naturally creates a fresh leg because exit detection already closed
        the previous one. The action flag no longer matters for storage.
        """
        await self.ensure_schema()
        rows = [(sym, d, float(px), nm, sec) for sym, d, px, nm, sec, _act in entries]
        if not rows:
            return
        sql = """
                INSERT OR IGNORE INTO portfolio_entries(
                  portfolio_id, symbol, entry_date, entry_price, name, sector,
                  status, exit_date, exit_price
                )
                SELECT ?,?,?,?,?,?,'open',NULL,NULL
                WHERE NOT EXISTS (
                  SELECT 1 FROM portfolio_entries
                  WHERE portfolio_id=? AND symbol=? AND status='open'
                )
                """
        async with aiosqlite.connect(self.db_path) as db:
            for sym, d, px, nm, sec in rows:
                await db.execute(sql, (portfolio_id, sym, d, px, nm, sec, portfolio_id, sym))
            await db.commit()

    async def mark_exited(
        self,
        *,
        portfolio_id: str,
        exits: Iterable[tuple[str, str, Optional[float]]],
    ) -> None:
        """Mark positions as exited. Each tuple is (symbol, exit_date, exit_price|None).

        Only flips rows that are currently open — an already-exited row keeps its
        original exit (first exit wins until a BUY re-opens the symbol).
        """
        await self.ensure_schema()
        rows = [(d, px, portfolio_id, sym) for sym, d, px in exits]
        if not rows:
            return
        async with aiosqlite.connect(self.db_path) as db:
            await db.executemany(
                """
                UPDATE portfolio_entries
                SET status='exited', exit_date=?, exit_price=?
                WHERE portfolio_id=? AND symbol=? AND status='open'
                """,
                rows,
            )
            await db.commit()

    async def get_entries(self, *, portfolio_id: str) -> list[EntryRow]:
        await self.ensure_schema()
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            cur = await db.execute(
                """
                SELECT portfolio_id, symbol, entry_date, entry_price, name, sector,
                       status, exit_date, exit_price
                FROM portfolio_entries
                WHERE portfolio_id = ?
                ORDER BY symbol ASC, entry_date ASC
                """,
                (portfolio_id,),
            )
            rows = await cur.fetchall()
        return [
            EntryRow(
                portfolio_id=r["portfolio_id"],
                symbol=r["symbol"],
                entry_date=r["entry_date"],
                entry_price=float(r["entry_price"]),
                name=r["name"],
                sector=r["sector"],
                status=r["status"] or "open",
                exit_date=r["exit_date"],
                exit_price=float(r["exit_price"]) if r["exit_price"] is not None else None,
            )
            for r in rows
        ]

    async def get_inception_date(self, *, portfolio_id: str) -> str | None:
        await self.ensure_schema()
        async with aiosqlite.connect(self.db_path) as db:
            cur = await db.execute(
                "SELECT MIN(entry_date) FROM portfolio_entries WHERE portfolio_id = ?",
                (portfolio_id,),
            )
            row = await cur.fetchone()
        if not row:
            return None
        return row[0] or None

    async def get_max_tracked_date(self, *, portfolio_id: str) -> str | None:
        await self.ensure_schema()
        async with aiosqlite.connect(self.db_path) as db:
            cur = await db.execute(
                "SELECT MAX(date) FROM portfolio_daily_series WHERE portfolio_id = ?",
                (portfolio_id,),
            )
            row = await cur.fetchone()
        if not row:
            return None
        return row[0] or None

    async def upsert_daily_prices(
        self, *, portfolio_id: str, date: str, closes: Iterable[tuple[str, float]]
    ) -> None:
        await self.ensure_schema()
        rows = [(portfolio_id, date, sym, float(px)) for sym, px in closes]
        if not rows:
            return
        async with aiosqlite.connect(self.db_path) as db:
            await db.executemany(
                """
                INSERT INTO portfolio_daily_prices(portfolio_id, date, symbol, close)
                VALUES(?,?,?,?)
                ON CONFLICT(portfolio_id, date, symbol) DO UPDATE SET
                  close=excluded.close
                """,
                rows,
            )
            await db.commit()

    async def upsert_daily_series_point(
        self, *, portfolio_id: str, date: str, portfolio_value: float, benchmark_value: float
    ) -> None:
        await self.ensure_schema()
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                """
                INSERT INTO portfolio_daily_series(portfolio_id, date, portfolio_value, benchmark_value)
                VALUES(?,?,?,?)
                ON CONFLICT(portfolio_id, date) DO UPDATE SET
                  portfolio_value=excluded.portfolio_value,
                  benchmark_value=excluded.benchmark_value
                """,
                (portfolio_id, date, float(portfolio_value), float(benchmark_value)),
            )
            await db.commit()

    async def get_daily_series(self, *, portfolio_id: str) -> list[DailyPoint]:
        await self.ensure_schema()
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            cur = await db.execute(
                """
                SELECT date, portfolio_value, benchmark_value
                FROM portfolio_daily_series
                WHERE portfolio_id = ?
                ORDER BY date ASC
                """,
                (portfolio_id,),
            )
            rows = await cur.fetchall()
        return [
            DailyPoint(
                date=r["date"],
                portfolio_value=float(r["portfolio_value"]),
                benchmark_value=float(r["benchmark_value"]),
            )
            for r in rows
        ]

    async def delete_portfolio_tracking(self, *, portfolio_id: str) -> None:
        """Remove all daily tracking and entry rows for a portfolio (e.g. before test regeneration)."""
        await self.ensure_schema()
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("DELETE FROM portfolio_entries WHERE portfolio_id = ?", (portfolio_id,))
            await db.execute("DELETE FROM portfolio_daily_series WHERE portfolio_id = ?", (portfolio_id,))
            await db.execute("DELETE FROM portfolio_daily_prices WHERE portfolio_id = ?", (portfolio_id,))
            await db.commit()

    async def get_latest_closes(self, *, portfolio_id: str) -> dict[str, float]:
        """
        Returns {symbol: close} for the latest date present in portfolio_daily_prices.
        """
        await self.ensure_schema()
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            cur = await db.execute(
                "SELECT MAX(date) AS max_date FROM portfolio_daily_prices WHERE portfolio_id = ?",
                (portfolio_id,),
            )
            row = await cur.fetchone()
            max_date = row["max_date"] if row else None
            if not max_date:
                return {}
            cur2 = await db.execute(
                """
                SELECT symbol, close
                FROM portfolio_daily_prices
                WHERE portfolio_id = ? AND date = ?
                """,
                (portfolio_id, max_date),
            )
            rows = await cur2.fetchall()
        return {r["symbol"]: float(r["close"]) for r in rows if r["symbol"]}

