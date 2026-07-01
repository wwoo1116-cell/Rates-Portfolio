"""
Market data service: snapshot loading, date enumeration, and live-cache management.

Owns the three-tier resolution (True Data.xlsx → Total Data.xlsx → CSV), the
in-memory live-quotes cache populated by data_updater.py, and the available-date
index.  Route handlers call these functions; no path or loader logic lives in api/.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

from ..core.errors import NonBusinessDayError
from ..core.market_data import MarketSnapshot
from ..loaders.factory import (
    latest_common_date,
    list_available_dates as _list_available_dates,
    load_fixing_history,
    load_market_snapshot,
)

_DATA_DIR = Path(__file__).resolve().parent.parent.parent   # irs_pricer/services/ → project root

# In-memory cache of intraday rates pushed by data_updater.py (xlwings poller).
# Keyed by valuation_date; takes priority over the static xlsx/csv files so the
# UI reflects RTD updates without waiting for a file save.
_live_snapshots: dict[date, MarketSnapshot] = {}


def load_snapshot(valuation_date: date) -> MarketSnapshot:
    """Three-tier resolution via the factory.
    
    Raises NonBusinessDayError for weekends/holidays.
    Raises ValueError if no source has data for the date.
    """
    if valuation_date in _live_snapshots:
        return _live_snapshots[valuation_date]
    return load_market_snapshot(_DATA_DIR, valuation_date)


def list_available_dates() -> list[date]:
    """Aggregate available dates from all sources, sorted ascending."""
    try:
        dates = set(_list_available_dates(_DATA_DIR))
    except ValueError:
        dates = set()
    
    dates |= set(_live_snapshots.keys())
    if not dates:
        raise ValueError("사용 가능한 시장 데이터가 없습니다.")
    return sorted(dates)


def update_live(snapshot: MarketSnapshot) -> None:
    """Store an intraday snapshot pushed by data_updater.py."""
    _live_snapshots[snapshot.valuation_date] = snapshot


def load_fixings() -> dict[date, float]:
    """Return historical CD91D fixings used for MTM past-reset estimation."""
    return load_fixing_history(_DATA_DIR)
