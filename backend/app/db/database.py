from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import aiosqlite


@dataclass(frozen=True)
class DbConfig:
    db_path: str


async def ensure_db(db_path: str) -> None:
    Path(os.path.dirname(db_path) or ".").mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(db_path) as db:
        await db.execute("PRAGMA journal_mode=WAL;")
        await db.execute("PRAGMA synchronous=NORMAL;")
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS price_history (
              symbol TEXT NOT NULL,
              date TEXT NOT NULL,
              open REAL,
              high REAL,
              low REAL,
              close REAL,
              adj_close REAL,
              volume REAL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY(symbol, date)
            );
            """
        )
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS analysis_runs (
              run_id TEXT PRIMARY KEY,
              index_name TEXT NOT NULL,
              selected_score TEXT NOT NULL,
              refresh_data INTEGER NOT NULL,
              cached_at TEXT NOT NULL,
              payload_json TEXT NOT NULL
            );
            """
        )
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS stock_meta (
              symbol TEXT PRIMARY KEY,
              name TEXT,
              updated_at TEXT NOT NULL
            );
            """
        )
        await db.commit()


def connect(db_path: str) -> aiosqlite.Connection:
    return aiosqlite.connect(db_path)

