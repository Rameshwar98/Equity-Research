from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class DailySeriesPoint(BaseModel):
    date: str
    portfolio_value: float
    benchmark_value: float


class HoldingPnlRow(BaseModel):
    symbol: str
    name: Optional[str] = None
    sector: Optional[str] = None
    entry_price: float
    entry_date: str
    current_price: Optional[float] = None
    pnl_pct: Optional[float] = None
    pnl_abs: Optional[float] = None
    days_held: int = 0


class PriceHistorySummary(BaseModel):
    total_return_pct: Optional[float] = None
    benchmark_return_pct: Optional[float] = None
    alpha: Optional[float] = None
    best_performer: Optional[str] = None
    worst_performer: Optional[str] = None
    inception_date: Optional[str] = None
    days_tracked: int = 0


class PortfolioPriceHistoryResponse(BaseModel):
    daily_series: List[DailySeriesPoint] = Field(default_factory=list)
    holdings_pnl: List[HoldingPnlRow] = Field(default_factory=list)
    summary: PriceHistorySummary
    rebalance_dates: List[str] = Field(default_factory=list)

