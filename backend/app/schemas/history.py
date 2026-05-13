from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from app.schemas.momentum import MomentumComputedRow


HistoryEventType = Literal["entry", "exit"]


class SnapshotListItem(BaseModel):
    snapshot_id: str
    created_at: datetime
    effective_date: str  # yyyy-mm-dd, usually holdings[0].price_date
    holdings_count: int = 0


class MonthlyMovementRow(BaseModel):
    snapshot_id: str
    effective_date: str
    entries: int = 0
    exits: int = 0
    turnover_pct: float = 0.0


class EntryExitEvent(BaseModel):
    effective_date: str
    created_at: datetime
    type: HistoryEventType
    symbol: str
    name: Optional[str] = None
    sector: Optional[str] = None
    rank: Optional[int] = None


class TurnoverPoint(BaseModel):
    effective_date: str
    turnover_pct: float


class HoldingDurationBucket(BaseModel):
    label: str
    count: int


class StableHoldingRow(BaseModel):
    symbol: str
    name: Optional[str] = None
    sector: Optional[str] = None
    total_snapshots_held: int = 0
    longest_streak: int = 0


class RankHeatmapRow(BaseModel):
    symbol: str
    name: Optional[str] = None
    sector: Optional[str] = None
    ranks_by_snapshot: Dict[str, Optional[int]] = Field(default_factory=dict)  # snapshot_id -> rank (1..100)


class HeatmapColumn(BaseModel):
    key: str  # snapshot_id
    label: str  # effective_date (yyyy-mm-dd)


class HistoryCharts(BaseModel):
    turnover: List[TurnoverPoint] = Field(default_factory=list)
    duration_histogram: List[HoldingDurationBucket] = Field(default_factory=list)
    heatmap_columns: List[HeatmapColumn] = Field(default_factory=list)
    rank_heatmap: List[RankHeatmapRow] = Field(default_factory=list)
    most_stable_holdings: List[StableHoldingRow] = Field(default_factory=list)


class PortfolioHistoryResponse(BaseModel):
    portfolio_id: str
    snapshots: List[SnapshotListItem] = Field(default_factory=list)
    movements: List[MonthlyMovementRow] = Field(default_factory=list)
    events: List[EntryExitEvent] = Field(default_factory=list)

    charts: HistoryCharts = Field(default_factory=HistoryCharts)

    # For the side panel (selected snapshot), simplest MVP is embed all holdings by snapshot_id.
    holdings_by_snapshot: Dict[str, List[MomentumComputedRow]] = Field(default_factory=dict)

