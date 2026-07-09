"""
Market data service: snapshot loading, date enumeration, and live-cache management.

Tries MySQL first (db/repository.py), falling back to the three-tier Excel/CSV
resolution (loaders/factory.py) whenever the DB isn't configured yet, isn't
reachable, or simply has no row for the requested date -- so a fresh install
(no connection saved via the Settings page) or a partial ETL backfill never
breaks the app; it just keeps serving from Excel exactly as before until
MySQL has that date covered. This fallback is a deliberate resilience
addition on top of the approved migration blueprint (D.1 describes the
DB-only end state) -- confirmed with the user before wiring it this way,
specifically so migration day can't take pricing down mid-session.

Route handlers call these functions; no path/loader/DB-session logic lives in api/.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

from sqlalchemy.exc import SQLAlchemyError

from ..core.errors import _check_business_day
from ..core.market_data import MarketSnapshot
from ..db import repository
from ..db.connection_settings import DatabaseNotConfiguredError
from ..db.database import session_scope
from ..db.models import MarketDataSource
from ..loaders.factory import (
    latest_common_date,
    list_available_dates as _list_available_dates,
    load_fixing_history,
    load_market_snapshot,
)

_DATA_DIR = Path(__file__).resolve().parent.parent.parent   # irs_pricer/services/ → project root

# In-memory cache of intraday rates pushed by data_updater.py (xlwings poller).
# Keyed by valuation_date; takes priority over DB/file so the UI reflects RTD
# updates without waiting for a poll cycle to land in MySQL.
_live_snapshots: dict[date, MarketSnapshot] = {}


def _load_snapshot_from_db(valuation_date: date) -> MarketSnapshot | None:
    """None if the DB isn't configured/reachable, or has no row for this date
    -- either way the caller falls back to Excel."""
    try:
        with session_scope() as db:
            return repository.get_snapshot(db, valuation_date)
    except (DatabaseNotConfiguredError, SQLAlchemyError):
        return None


def load_snapshot(valuation_date: date) -> MarketSnapshot:
    """DB first (MySQL), falling back to the three-tier Excel/CSV factory.

    Raises NonBusinessDayError for weekends/holidays.
    Raises ValueError if neither the DB nor any file source has data for the date.
    """
    if valuation_date in _live_snapshots:
        return _live_snapshots[valuation_date]
    _check_business_day(valuation_date)  # both the DB and Excel paths below need this checked up front
    snapshot = _load_snapshot_from_db(valuation_date)
    if snapshot is not None:
        return snapshot
    return load_market_snapshot(_DATA_DIR, valuation_date)


def list_available_dates() -> list[date]:
    """Aggregate available dates from the DB (if reachable) and Excel/CSV sources, sorted ascending."""
    dates: set[date] = set()
    try:
        with session_scope() as db:
            dates |= set(repository.get_available_dates(db))
    except (DatabaseNotConfiguredError, SQLAlchemyError):
        pass

    try:
        dates |= set(_list_available_dates(_DATA_DIR))
    except ValueError:
        pass

    dates |= set(_live_snapshots.keys())
    if not dates:
        raise ValueError("사용 가능한 시장 데이터가 없습니다.")
    return sorted(dates)


def update_live(snapshot: MarketSnapshot) -> None:
    """Store an intraday snapshot pushed by data_updater.py.

    Always cached in-memory (unchanged) -- additionally persisted to MySQL as
    source=LIVE_FEED, best-effort, when the DB is reachable. A DB hiccup must
    never break the live RTD feed the desk is actively watching, so failures
    here are swallowed rather than raised.
    """
    _live_snapshots[snapshot.valuation_date] = snapshot
    try:
        with session_scope() as db:
            repository.upsert_snapshot(db, snapshot, source=MarketDataSource.LIVE_FEED)
    except (DatabaseNotConfiguredError, SQLAlchemyError):
        pass


def load_fixings() -> dict[date, float]:
    """Return historical CD91D fixings used for MTM past-reset estimation.
    DB first (if it has any rows at all); else the Excel/CSV history --
    same DB-first, whole-source-at-a-time precedence as load_snapshot()."""
    try:
        with session_scope() as db:
            history = repository.get_cd_fixing_history(db)
            if history:
                return history
    except (DatabaseNotConfiguredError, SQLAlchemyError):
        pass
    return load_fixing_history(_DATA_DIR)
