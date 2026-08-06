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

    # --- Client "Dashboard" metric set (monthly periods, RF + MAR assumptions below) ---
    # Assumptions used (echoed for display)
    periods: int = 0  # number of monthly return periods used
    periods_per_year: int = 12
    rf_annual: Optional[float] = None  # risk-free rate (annual) used
    mar_annual: Optional[float] = None  # target / minimum acceptable return (annual)

    # Window the metrics actually cover (first → last snapshot effective date). The
    # cumulative CHART is daily and runs to today, so it can extend past period_end.
    period_start: Optional[str] = None
    period_end: Optional[str] = None
    years_elapsed: Optional[float] = None  # true calendar span used to annualize
    # Fraction of holdings that had usable prices: 1.0 = every name priced every period.
    price_coverage: Optional[float] = None
    min_price_coverage: Optional[float] = None  # worst single period

    # Return metrics
    cumulative_return: Optional[float] = None
    cagr: Optional[float] = None  # annualized (geometric)
    avg_periodic_return: Optional[float] = None
    benchmark_cumulative: Optional[float] = None
    excess_return_cum: Optional[float] = None
    best_period: Optional[float] = None
    worst_period: Optional[float] = None
    win_rate: Optional[float] = None

    # Risk metrics (annualized where applicable)
    volatility_annualized: Optional[float] = None
    downside_deviation: Optional[float] = None
    beta: Optional[float] = None
    tracking_error: Optional[float] = None
    max_drawdown: Optional[float] = None
    var_95: Optional[float] = None  # periodic 5th-percentile return
    r_squared: Optional[float] = None

    # Risk-adjusted ratios (sharpe + sortino above)
    treynor: Optional[float] = None
    information_ratio: Optional[float] = None
    calmar: Optional[float] = None
    jensens_alpha: Optional[float] = None  # annualized

    # Benchmark-side values of the same metric set (keys mirror _dashboard_metrics
    # output: cumulative_return, cagr, avg_periodic_return, best_period, worst_period,
    # win_rate, volatility_annualized, downside_deviation, max_drawdown, var_95,
    # sharpe, sortino, calmar, treynor). Lets the UI render Portfolio | Benchmark | Diff.
    benchmark_metrics: Dict[str, Optional[float]] = Field(default_factory=dict)


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
    on_deck: List[MomentumComputedRow] = Field(default_factory=list)
    scatter_median_return_1y: Optional[float] = None
    scatter_median_sd: Optional[float] = None

    sector_over_time: List[SectorOverTimePoint] = Field(default_factory=list)
    # Benchmark sector mix for over/under-weight comparison, derived from the index
    # constituent list. Normally market-cap weighted (matching the ETF); falls back to
    # equal-weight when caps are unavailable — `benchmark_sector_basis` says which.
    benchmark_sectors: Dict[str, float] = Field(default_factory=dict)  # sector -> 0..1
    benchmark_sector_label: Optional[str] = None
    benchmark_sector_basis: Optional[str] = None  # "cap" | "count"
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

