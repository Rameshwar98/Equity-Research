from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from app.schemas.history import (
    EntryExitEvent,
    HeatmapColumn,
    HoldingDurationBucket,
    HistoryCharts,
    MonthlyMovementRow,
    PortfolioHistoryResponse,
    RankHeatmapRow,
    SnapshotListItem,
    StableHoldingRow,
    TurnoverPoint,
)
from app.schemas.momentum import MomentumComputedRow, MomentumSnapshot


def _effective_date(s: MomentumSnapshot) -> str:
    if s.holdings and s.holdings[0].price_date:
        return s.holdings[0].price_date
    return s.created_at.date().isoformat()


def _row_meta(rows: List[MomentumComputedRow]) -> Dict[str, MomentumComputedRow]:
    return {r.symbol: r for r in (rows or []) if r.symbol}


def _pct(num: float) -> float:
    if num < 0:
        return 0.0
    return float(num)


@dataclass(frozen=True)
class HistoryConfig:
    heatmap_max_symbols: int = 75
    stable_leaderboard_size: int = 20


class HistoryService:
    def __init__(self, config: HistoryConfig = HistoryConfig()) -> None:
        self.config = config

    def compute(self, *, portfolio_id: str, snapshots: List[MomentumSnapshot]) -> PortfolioHistoryResponse:
        snaps = list(snapshots or [])
        snaps.sort(key=lambda s: s.created_at)

        out = PortfolioHistoryResponse(portfolio_id=portfolio_id)

        # Snapshot list + holdings map (for side panel)
        out.snapshots = [
            SnapshotListItem(
                snapshot_id=s.snapshot_id,
                created_at=s.created_at,
                effective_date=_effective_date(s),
                holdings_count=len(s.holdings or []),
            )
            for s in snaps
        ]
        out.holdings_by_snapshot = {s.snapshot_id: list(s.holdings or []) for s in snaps}

        if len(snaps) < 2:
            # still include empty chart structures for the UI
            out.charts = HistoryCharts()
            return out

        # Movements + event feed
        movements: List[MonthlyMovementRow] = []
        events: List[EntryExitEvent] = []
        turnover: List[TurnoverPoint] = []

        for prev, cur in zip(snaps[:-1], snaps[1:]):
            prev_map = _row_meta(prev.holdings)
            cur_map = _row_meta(cur.holdings)
            prev_syms = set(prev_map.keys())
            cur_syms = set(cur_map.keys())

            entered = sorted(cur_syms - prev_syms)
            exited = sorted(prev_syms - cur_syms)

            denom = max(1, len(prev_syms))
            turnover_pct = _pct((len(entered) + len(exited)) / denom)

            d = _effective_date(cur)
            movements.append(
                MonthlyMovementRow(
                    snapshot_id=cur.snapshot_id,
                    effective_date=d,
                    entries=len(entered),
                    exits=len(exited),
                    turnover_pct=float(turnover_pct),
                )
            )
            turnover.append(TurnoverPoint(effective_date=d, turnover_pct=float(turnover_pct)))

            for sym in entered:
                r = cur_map.get(sym)
                events.append(
                    EntryExitEvent(
                        effective_date=d,
                        created_at=cur.created_at,
                        type="entry",
                        symbol=sym,
                        name=r.name if r else None,
                        sector=r.sector if r else None,
                        rank=r.combined_rank if r else None,
                    )
                )
            for sym in exited:
                r = prev_map.get(sym)
                events.append(
                    EntryExitEvent(
                        effective_date=d,
                        created_at=cur.created_at,
                        type="exit",
                        symbol=sym,
                        name=r.name if r else None,
                        sector=r.sector if r else None,
                        rank=r.combined_rank if r else None,
                    )
                )

        # chronological, stable ordering
        events.sort(key=lambda e: (e.created_at, 0 if e.type == "entry" else 1, e.symbol))

        out.movements = movements
        out.events = events

        # Holding durations across snapshot timeline (contiguous streaks)
        # Track for each symbol: current streak, longest streak, total snapshots present
        current_streak: Dict[str, int] = {}
        longest_streak: Dict[str, int] = {}
        total_held: Dict[str, int] = {}
        last_seen: Dict[str, int] = {}

        for i, s in enumerate(snaps):
            syms = set(_row_meta(s.holdings).keys())
            for sym in syms:
                total_held[sym] = total_held.get(sym, 0) + 1
                if last_seen.get(sym) == i - 1:
                    current_streak[sym] = current_streak.get(sym, 0) + 1
                else:
                    current_streak[sym] = 1
                last_seen[sym] = i
                longest_streak[sym] = max(longest_streak.get(sym, 0), current_streak[sym])

        # Histogram buckets by snapshots held (not calendar months; 1 snapshot ~= one run)
        buckets = [
            ("1", lambda n: n == 1),
            ("2", lambda n: n == 2),
            ("3", lambda n: n == 3),
            ("4", lambda n: n == 4),
            ("5-6", lambda n: 5 <= n <= 6),
            ("7-9", lambda n: 7 <= n <= 9),
            ("10-12", lambda n: 10 <= n <= 12),
            ("13+", lambda n: n >= 13),
        ]
        hist: List[HoldingDurationBucket] = []
        for label, pred in buckets:
            cnt = sum(1 for _, n in total_held.items() if pred(n))
            hist.append(HoldingDurationBucket(label=label, count=int(cnt)))

        # Most-stable holdings leaderboard (prefer metadata from latest snapshot holdings/top100)
        latest = snaps[-1]
        meta = _row_meta(latest.top100_rows or []) or _row_meta(latest.holdings or [])
        stable_rows: List[StableHoldingRow] = []
        for sym, n in total_held.items():
            m = meta.get(sym)
            stable_rows.append(
                StableHoldingRow(
                    symbol=sym,
                    name=m.name if m else None,
                    sector=m.sector if m else None,
                    total_snapshots_held=int(n),
                    longest_streak=int(longest_streak.get(sym, 0)),
                )
            )
        stable_rows.sort(key=lambda r: (-r.total_snapshots_held, -r.longest_streak, r.symbol))
        stable_rows = stable_rows[: self.config.stable_leaderboard_size]

        # Rank evolution heatmap (symbol rows, time columns)
        # Choose symbols that appear most frequently in top100_ranks across timeline.
        freq: Dict[str, int] = {}
        for s in snaps:
            for sym in (s.top100_ranks or {}).keys():
                freq[sym] = freq.get(sym, 0) + 1
        candidates = sorted(freq.items(), key=lambda kv: (-kv[1], kv[0]))
        symbols = [sym for sym, _ in candidates[: self.config.heatmap_max_symbols]]
        cols = [
            HeatmapColumn(key=s.snapshot_id, label=_effective_date(s))
            for s in snaps
            if s.snapshot_id
        ]

        # meta for heatmap: latest top100_rows is best source
        meta2 = _row_meta(latest.top100_rows or [])
        heat_rows: List[RankHeatmapRow] = []
        for sym in symbols:
            m = meta2.get(sym)
            ranks_by_snapshot: Dict[str, Optional[int]] = {}
            for s in snaps:
                r = (s.top100_ranks or {}).get(sym)
                ranks_by_snapshot[s.snapshot_id] = int(r) if r is not None else None
            heat_rows.append(
                RankHeatmapRow(
                    symbol=sym,
                    name=m.name if m else None,
                    sector=m.sector if m else None,
                    ranks_by_snapshot=ranks_by_snapshot,
                )
            )

        out.charts = HistoryCharts(
            turnover=turnover,
            duration_histogram=hist,
            heatmap_columns=cols,
            rank_heatmap=heat_rows,
            most_stable_holdings=stable_rows,
        )

        return out

