from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Dict, Iterable, Optional

import pandas as pd


@dataclass(frozen=True)
class DownloadResult:
    prices_by_symbol: Dict[str, pd.DataFrame]  # columns: Open, High, Low, Close, Adj Close, Volume; index: DatetimeIndex
    names_by_symbol: Dict[str, Optional[str]]


class DataProvider(ABC):
    @abstractmethod
    async def download_daily_history(
        self,
        symbols: Iterable[str],
        period: str,
        interval: str,
        timeout_seconds: float,
    ) -> DownloadResult:
        raise NotImplementedError

    async def fetch_sector_map(self, index_name: str, timeout_seconds: float = 15.0) -> Dict[str, Dict[str, str | None]]:
        return {}

    async def fetch_symbol_classification(
        self, symbols: list[str], timeout_seconds: float = 30.0
    ) -> Dict[str, Dict[str, str | None]]:
        """
        Best-effort per symbol: {sector, sub_sector}.
        Default implementation returns empty classification.
        """
        _ = (symbols, timeout_seconds)
        return {}

    async def fetch_sector_map(
        self, index_name: str, timeout_seconds: float = 15.0
    ) -> Dict[str, Dict[str, Optional[str]]]:
        return {}

