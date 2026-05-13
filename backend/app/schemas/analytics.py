from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from app.schemas.momentum import MomentumComputedRow


class AnalyticsKpis(BaseModel):
    sharpe: Optional[float] = None
    sortino: Optional[float] = None
    sharpe_rf_assumption: str = "vs 5% RF"
    sortino_rf_assumption: str = "vs 5% RF"

    quality_score: Optional[float] = None  # 0..1
    avg_1y_return: Optional[float] = None
    avg_annualized_sd: Optional[float] = None

    spread_1m: Optional[float] = None
    spread_3m: Optional[float] = None
    spread_ytd: Optional[float] = None
    spread_1y: Optional[float] = None


class SeriesPoint(BaseModel):
    date: str  # ISO yyyy-mm-dd (snapshot effective date)
    portfolio: Optional[float] = None
    benchmark: Optional[float] = None


class SingleSeriesPoint(BaseModel):
    date: str
    value: float


class SectorOverTimePoint(BaseModel):
    date: str
    sectors: Dict[str, float] = Field(default_factory=dict)  # sector -> weight (0..1)


class ContributorsDetractors(BaseModel):
    contributors: List[MomentumComputedRow] = Field(default_factory=list)
    detractors: List[MomentumComputedRow] = Field(default_factory=list)


class RankMovementItem(BaseModel):
    symbol: str
    name: Optional[str] = None
    sector: Optional[str] = None
    delta: int
    prev_rank: int
    cur_rank: int


class ConcentrationCard(BaseModel):
    herfindahl: Optional[float] = None
    max_sector_weight: Optional[float] = None
    distinct_sectors: int = 0


class AnalyticsCharts(BaseModel):
    cumulative: List[SeriesPoint] = Field(default_factory=list)
    drawdown: List[SeriesPoint] = Field(default_factory=list)
    rolling_sharpe: List[SeriesPoint] = Field(default_factory=list)

    scatter_holdings: List[MomentumComputedRow] = Field(default_factory=list)
    scatter_top100: List[MomentumComputedRow] = Field(default_factory=list)
    scatter_median_return_1y: Optional[float] = None
    scatter_median_sd: Optional[float] = None

    sector_over_time: List[SectorOverTimePoint] = Field(default_factory=list)
    contributors_detractors: ContributorsDetractors = Field(default_factory=ContributorsDetractors)
    rank_movement: Dict[str, List[RankMovementItem]] = Field(
        default_factory=lambda: {"improved": [], "deteriorated": []}
    )
    concentration: ConcentrationCard = Field(default_factory=ConcentrationCard)


class PortfolioAnalyticsResponse(BaseModel):
    portfolio_id: str
    benchmark_symbol: str
    inception_date: Optional[str] = None
    snapshots: int = 0

    kpis: AnalyticsKpis = Field(default_factory=AnalyticsKpis)
    charts: AnalyticsCharts = Field(default_factory=AnalyticsCharts)

    # Copy of per-portfolio prefs; frontend will use analytics_* keys.
    chart_prefs: Dict[str, bool] = Field(default_factory=dict)

