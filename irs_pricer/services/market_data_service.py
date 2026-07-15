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

from sqlalchemy.exc import SQLAlchemyError

from ..config import DATA_DIR
from ..core import ttl_cache
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

# In-memory cache of intraday rates pushed by data_updater.py (xlwings poller).
# Keyed by valuation_date; takes priority over DB/file so the UI reflects RTD
# updates without waiting for a poll cycle to land in MySQL.
_live_snapshots: dict[date, MarketSnapshot] = {}

# Set the first time a DB-first lookup raises (e.g. the market-data table
# doesn't exist yet on this connection -- the same remote DB this app's
# trade_specification table is also still missing from). A schema/connection
# error isn't going to un-happen for the next date in the same bulk request
# (rate_history_service.get_rate_history can iterate several thousand dates
# in a single call), so short-circuiting straight to Excel here turned a
# confirmed ~100s worst case into sub-second. Reset by database.reconfigure()
# so fixing the connection and saving new settings gets a fresh try.
_db_market_data_unavailable = False


def _load_snapshot_from_db(valuation_date: date) -> MarketSnapshot | None:
    """None if the DB isn't configured/reachable, has no row for this date, or
    has already failed once this process -- either way the caller falls back
    to Excel."""
    global _db_market_data_unavailable
    if _db_market_data_unavailable:
        return None
    try:
        with session_scope() as db:
            return repository.get_snapshot(db, valuation_date)
    except (DatabaseNotConfiguredError, SQLAlchemyError):
        _db_market_data_unavailable = True
        return None


def reset_db_availability() -> None:
    """Call after saving new connection settings (db_settings.router) so a
    fixed/changed connection gets a fresh attempt instead of staying stuck on
    the previous connection's failure.

    Also drops the TTL caches below. Repointing at a different database changes
    where snapshots/fixings come FROM, so anything cached off the previous
    connection (typically Excel-fallback values served while the DB was
    unreachable) is answering from the wrong source, not merely a stale one --
    that must not survive the switch just because it's under 60s old.
    """
    global _db_market_data_unavailable
    _db_market_data_unavailable = False
    ttl_cache.clear()


def _load_snapshot_uncached(valuation_date: date) -> MarketSnapshot:
    snapshot = _load_snapshot_from_db(valuation_date)
    if snapshot is not None:
        return snapshot
    return load_market_snapshot(DATA_DIR, valuation_date)


def load_snapshot(valuation_date: date) -> MarketSnapshot:
    """DB first (MySQL), falling back to the three-tier Excel/CSV factory.

    Raises NonBusinessDayError for weekends/holidays.
    Raises ValueError if neither the DB nor any file source has data for the date.

    TTL-cached per date: a closed date's snapshot is immutable, and the callers
    that dominate load hammer the same handful of dates -- Home's Status trend
    samples 12 dates, and portfolio_analytics_service walks the same window
    once per book. The live-snapshot check stays OUTSIDE the cache so an
    intraday RTD push is never masked by a cached DB/file value. Neither
    _check_business_day's NonBusinessDayError nor a missing-data ValueError is
    cached -- the factory raises before anything is stored.
    """
    if valuation_date in _live_snapshots:
        return _live_snapshots[valuation_date]
    _check_business_day(valuation_date)  # both the DB and Excel paths below need this checked up front
    return ttl_cache.get_or_compute(
        ("market-snapshot", valuation_date),
        lambda: _load_snapshot_uncached(valuation_date),
    )


def list_available_dates() -> list[date]:
    """Aggregate available dates from the DB (if reachable) and Excel/CSV sources, sorted ascending.

    TTL-cached: compute_historical_pnl calls this once per book, and it costs a
    DB round trip plus a workbook scan every time. update_live() invalidates it
    when a genuinely new date shows up.
    """
    return ttl_cache.get_or_compute(("market-available-dates",), _list_available_dates_uncached)


def _list_available_dates_uncached() -> list[date]:
    dates: set[date] = set()
    try:
        with session_scope() as db:
            dates |= set(repository.get_available_dates(db))
    except (DatabaseNotConfiguredError, SQLAlchemyError):
        pass

    try:
        dates |= set(_list_available_dates(DATA_DIR))
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
    is_new_date = snapshot.valuation_date not in _live_snapshots
    _live_snapshots[snapshot.valuation_date] = snapshot
    # Only the date LIST needs invalidating, and only when this tick introduces
    # a date it didn't already have. The per-date snapshot cache doesn't:
    # load_snapshot checks _live_snapshots ahead of it. Blanket-clearing here
    # would wipe the cache on every RTD tick and keep it permanently cold.
    if is_new_date:
        ttl_cache.invalidate(("market-available-dates",))
    try:
        with session_scope() as db:
            repository.upsert_snapshot(db, snapshot, source=MarketDataSource.LIVE_FEED)
    except (DatabaseNotConfiguredError, SQLAlchemyError):
        pass


def load_fixings() -> dict[date, float]:
    """Return historical CD91D fixings used for MTM past-reset estimation.
    DB first (if it has any rows at all); else the Excel/CSV history --
    same DB-first, whole-source-at-a-time precedence as load_snapshot().

    TTL-cached: every analytics endpoint loads this once per request, and
    compute_historical_pnl loads it again per book -- all to get the same
    whole-history dict, which only changes on a data upload.

    The cached dict is shared by reference, not copied. Callers treat fixings
    as read-only (they only ever look up past resets); test_market_data_cache
    pins that. Copying a multi-thousand-entry dict per call would give back a
    chunk of what the cache just saved.
    """
    return ttl_cache.get_or_compute(("cd-fixings",), _load_fixings_uncached)


def _load_fixings_uncached() -> dict[date, float]:
    try:
        with session_scope() as db:
            history = repository.get_cd_fixing_history(db)
            if history:
                return history
    except (DatabaseNotConfiguredError, SQLAlchemyError):
        pass
    return load_fixing_history(DATA_DIR)
