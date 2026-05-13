from __future__ import annotations

from dataclasses import dataclass
from datetime import date
import calendar
from functools import lru_cache
from typing import Literal, Optional

import exchange_calendars as xcals


Market = Literal["US", "IN"]


def market_for_universe(universe: str) -> Market:
    u = (universe or "").strip().lower()
    if u.startswith("nifty"):
        return "IN"
    return "US"


@lru_cache(maxsize=8)
def _calendar_for_market(market: Market):
    # exchange_calendars calendar names
    if market == "IN":
        return xcals.get_calendar("XNSE")
    return xcals.get_calendar("XNYS")


def _first_session_of_month(market: Market, year: int, month: int) -> date:
    cal = _calendar_for_market(market)
    # Avoid `sessions_in_range` due to pandas timezone object incompatibilities
    # on some Windows/Python builds; filter the precomputed calendar sessions instead.
    sessions = cal.sessions
    sel = sessions[(sessions.year == year) & (sessions.month == month)]
    if len(sel) < 1:
        return date(year, month, 1)
    return sel[0].date()


def next_auto_rebalance_date(*, market: Market, today: date) -> date:
    """
    Returns the next scheduled rebalance date (1st trading day of month) on/after today.
    """
    y, m = today.year, today.month
    d0 = _first_session_of_month(market, y, m)
    if today <= d0:
        return d0
    # next month
    if m == 12:
        y2, m2 = y + 1, 1
    else:
        y2, m2 = y, m + 1
    return _first_session_of_month(market, y2, m2)


@dataclass(frozen=True)
class PortfolioScheduleInfo:
    market: Market
    next_auto_rebalance: date

