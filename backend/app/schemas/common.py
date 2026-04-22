from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, model_validator


class ApiError(BaseModel):
    message: str
    details: Optional[Dict[str, Any]] = None


class HealthResponse(BaseModel):
    status: str = "ok"
    timestamp: datetime


class IndexInfo(BaseModel):
    name: str
    label: str


class Constituent(BaseModel):
    symbol: str
    name: str | None = None
    sector: str | None = None
    sub_sector: str | None = None


class SummaryStats(BaseModel):
    total: int
    buy: int
    hold: int
    sell: int


class Metadata(BaseModel):
    index_name: str
    selected_score: str
    refresh_data: bool


class AnalysisRow(BaseModel):
    symbol: str
    name: str | None = None
    sector: str | None = None
    sub_sector: str | None = None
    # Order of this symbol in the universe definition (0-based). Used for stable layouts.
    universe_rank: int | None = None
    score_1: float | None = None
    score_2: float | None = None
    score_3: float | None = None
    last_price: float | None = None
    last_price_date: str | None = None  # YYYY-MM-DD of EOD close used for last_price
    mkt_cap: float | None = None
    high_52w: float | None = None
    low_52w: float | None = None
    return_1d: float | None = None
    return_1w: float | None = None
    return_1m: float | None = None
    return_3m: float | None = None
    return_ytd: float | None = None
    signals: List[str] = Field(default_factory=list)
    # ~52 weeks (1y) Fri-week signals, oldest → newest (dashboard strip)
    signals_1y: List[str] = Field(default_factory=list)
    signals_1y_dates: List[str] = Field(default_factory=list)
    # ~52 weeks (1y) Fri-week closes aligned to signals_1y_dates, oldest → newest
    trend_1y_closes: List[float | None] = Field(default_factory=list)
    trend_1y_dates: List[str] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _migrate_legacy_heatmap(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        if not data.get("signals_1y") and data.get("signals_6m"):
            data["signals_1y"] = list(data["signals_6m"])
            data["signals_1y_dates"] = list(data.get("signals_6m_dates") or [])
        return data


class RunAnalysisRequest(BaseModel):
    index_name: str
    selected_score: str  # "score_1" | "score_2" | "score_3"
    refresh_data: bool = False


class RunAnalysisResponse(BaseModel):
    metadata: Metadata
    date_labels: List[str]  # up to 16 weeks (most-recent first)
    rows: List[AnalysisRow]
    summary: SummaryStats
    cached_at: datetime


class FibLevels(BaseModel):
    high_52week: float | None = None
    low_52week: float | None = None
    px_last: float | None = None
    fib_61_8: float | None = None
    fib_50: float | None = None
    fib_38_2: float | None = None
    fib_23_6: float | None = None


class EmaValues(BaseModel):
    ema_10: float | None = None
    ema_20: float | None = None
    ema_30: float | None = None
    ema_50: float | None = None
    ema_100: float | None = None
    ema_200: float | None = None
    avg_all_emas: float | None = None


class StockDetailsResponse(BaseModel):
    symbol: str
    name: str | None = None
    date_labels: List[str]  # len=16 (most-recent first)
    signals: List[str]  # len=16
    closes: List[float | None] | None = None
    selected_score: str | None = None
    score_timeline: List[float | None] | None = None
    close: float | None = None
    scores: Dict[str, float | None]
    emas: EmaValues
    fib: FibLevels

