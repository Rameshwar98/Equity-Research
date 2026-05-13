from __future__ import annotations

from datetime import datetime
from typing import Dict, Literal, Optional

from pydantic import BaseModel, Field
from pydantic_settings import SettingsConfigDict


StrategyType = Literal["MomentumIQ"]
RebalanceMode = Literal["manual", "auto", "both"]


class PortfolioParams(BaseModel):
    model_config = SettingsConfigDict(extra="ignore")
    universe: str = Field(..., description="Index/universe name (e.g. sp500, nifty50)")
    universe_size_cap: Optional[int] = Field(
        default=None, ge=1, description="Optional: cap universe to top N by market cap"
    )
    momentum_screen_size: int = Field(default=100, ge=1)
    final_portfolio_size: int = Field(default=25, ge=1)
    ma_exit_override: bool = Field(default=True)
    rebalance_mode: RebalanceMode = Field(default="manual")
    benchmark: Optional[str] = Field(default=None, description="Benchmark symbol (e.g. SPY)")


class Portfolio(BaseModel):
    id: str
    name: str
    strategy: StrategyType = "MomentumIQ"
    params: PortfolioParams
    chart_prefs: Dict[str, bool] = Field(default_factory=dict)
    is_test_mode: bool = Field(default=False, description="True when portfolio was seeded with dev test history")
    created_at: datetime
    updated_at: datetime


class CreatePortfolioRequest(BaseModel):
    name: str
    strategy: StrategyType = "MomentumIQ"
    params: PortfolioParams


class UpdatePortfolioRequest(BaseModel):
    name: Optional[str] = None
    params: Optional[PortfolioParams] = None


class UpdatePortfolioPrefsRequest(BaseModel):
    chart_prefs: Dict[str, bool]


class PortfolioListItem(BaseModel):
    id: str
    name: str
    strategy: StrategyType
    universe: str
    momentum_screen_size: int
    final_portfolio_size: int
    is_test_mode: bool = False
    last_run_at: Optional[datetime] = None
    holdings_count: int = 0
    created_at: datetime
    updated_at: datetime


class GenerateTestHistoryResponse(BaseModel):
    ok: bool = True
    portfolio_id: str
    snapshots_created: int
    inception_date: Optional[str] = None
    daily_series_points: int

