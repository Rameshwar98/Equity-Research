from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from app.utils.types import Signal

# "band" is the label shown in UI tables; for BUY rows we show BUY instead of HOLD/WATCH/EXIT.
ScoreBand = Literal["BUY", "HOLD", "WATCH", "EXIT"]
ActionType = Literal["HOLD", "HOLD_WITH_WATCH", "EXIT", "BUY"]
ExitReason = Literal["score_breach", "ma_breach", "score_and_ma_breach", "dropped_out_of_top100"]


class MomentumComputedRow(BaseModel):
    symbol: str
    name: Optional[str] = None
    sector: Optional[str] = None

    last_price: float
    price_date: str

    return_1y: float
    annualized_sd: float

    mkt_cap: float | None = None
    high_52w: float | None = None
    low_52w: float | None = None

    return_1w: float | None = None
    return_1m: float | None = None
    return_3m: float | None = None
    return_ytd: float | None = None

    signals_1y: list[Signal] = Field(default_factory=list)
    signals_1y_dates: list[str] = Field(default_factory=list)

    # Screener score_3: last close / average of EMA10–EMA200 (same as AnalysisService).
    score_3: float | None = None

    return_rank: int
    sd_rank: int
    combined_score: int
    combined_rank: int

    price_vs_50ma: Literal["above", "below"]
    ma50: float
    ma_override_active: bool

    band: ScoreBand
    action: ActionType
    exit_reason: Optional[ExitReason] = None

    target_weight: float = 0.04

    # These are filled from snapshot history (Phase 2).
    months_held: int = 0
    rank_change_vs_last_month: Optional[int] = None


class MomentumSnapshot(BaseModel):
    snapshot_id: str
    portfolio_id: str
    created_at: datetime
    holdings: List[MomentumComputedRow]

    # For watchlist / rank delta computations
    top100_ranks: Dict[str, int] = Field(default_factory=dict)  # symbol -> combined_rank (1..100)

    # Persist the last committed rebalance decision breakdown (so Holdings can render tables after commit).
    incoming: List[MomentumComputedRow] = Field(default_factory=list)
    outgoing: List[MomentumComputedRow] = Field(default_factory=list)
    hold: List[MomentumComputedRow] = Field(default_factory=list)
    watch: List[MomentumComputedRow] = Field(default_factory=list)
    degree_of_improvement_watchlist: List[dict] = Field(default_factory=list)
    skipped_symbols: List[str] = Field(default_factory=list)

    # Latest ranked top-100 rows used for scatter/histogram (non-held included).
    top100_rows: List[MomentumComputedRow] = Field(default_factory=list)

    # Ranks 26–50 by combined rank (static "next up" list), excluding current holdings.
    on_deck: List[MomentumComputedRow] = Field(default_factory=list)


class MomentumPreview(BaseModel):
    run_id: str
    portfolio_id: str
    created_at: datetime

    current_holdings: List[MomentumComputedRow] = Field(default_factory=list)
    incoming: List[MomentumComputedRow] = Field(default_factory=list)
    outgoing: List[MomentumComputedRow] = Field(default_factory=list)
    hold: List[MomentumComputedRow] = Field(default_factory=list)
    watch: List[MomentumComputedRow] = Field(default_factory=list)

    degree_of_improvement_watchlist: List[dict] = Field(default_factory=list)
    skipped_symbols: List[str] = Field(default_factory=list)


class HoldingsView(BaseModel):
    portfolio_id: str
    last_snapshot: Optional[MomentumSnapshot] = None
    previous_snapshot: Optional[MomentumSnapshot] = None
    incoming: List[MomentumComputedRow] = Field(default_factory=list)
    outgoing: List[MomentumComputedRow] = Field(default_factory=list)
    degree_of_improvement_watchlist: List[dict] = Field(default_factory=list)

