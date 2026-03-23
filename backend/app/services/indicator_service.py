from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class Indicators:
    ema: Dict[int, pd.Series]  # period -> EMA series
    avg_all_emas: pd.Series
    high_52w: float | None
    low_52w: float | None


class IndicatorService:
    def compute_emas(self, close: pd.Series, periods: List[int]) -> Tuple[Dict[int, pd.Series], pd.Series]:
        emas: Dict[int, pd.Series] = {}
        for p in periods:
            emas[p] = close.ewm(span=p, adjust=False).mean()
        df = pd.DataFrame({f"ema_{p}": s for p, s in emas.items()})
        avg = df.mean(axis=1)
        return emas, avg

    def compute_52w_high_low(self, high: pd.Series, low: pd.Series) -> tuple[float | None, float | None]:
        # 52 weeks ~= 252 trading days
        h = high.tail(252).max() if high is not None and not high.empty else None
        l = low.tail(252).min() if low is not None and not low.empty else None
        if pd.isna(h):
            h = None
        if pd.isna(l):
            l = None
        return (float(h) if h is not None else None, float(l) if l is not None else None)

    def compute_indicators(self, prices: pd.DataFrame) -> Indicators:
        close = prices["Close"].astype(float)
        high = prices["High"].astype(float)
        low = prices["Low"].astype(float)

        periods = [10, 20, 30, 50, 100, 200]
        emas, avg_all = self.compute_emas(close, periods)
        high_52w, low_52w = self.compute_52w_high_low(high, low)
        return Indicators(ema=emas, avg_all_emas=avg_all, high_52w=high_52w, low_52w=low_52w)

    def avg_last_5_close(self, close: pd.Series) -> pd.Series:
        return close.rolling(window=5, min_periods=5).mean()

    def prev_close(self, close: pd.Series) -> pd.Series:
        return close.shift(1)

