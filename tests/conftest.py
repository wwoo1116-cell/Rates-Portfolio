"""
Shared fixtures for DB-backed tests (repositories, and services that read/write
through them). Uses an in-memory SQLite database per test rather than a real
MySQL server -- fast, no external dependency for local/CI runs.

Two SQLite-only accommodations here, neither of which touches production code:

- BIGINT UNSIGNED (models.py's autoincrement PKs) only gets SQLite's special
  rowid-alias behavior if the compiled type name is exactly "INTEGER"; MySQL
  has no such restriction, so this is a test-only compiler override.
- INSERT ... ON DUPLICATE KEY UPDATE (repository.py/trace_repository.py's
  upsert helpers) is MySQL-specific syntax SQLite's driver can't execute at
  all. The `db` fixture below monkeypatches in a portable
  select-then-update-or-insert equivalent for the duration of each test.
  The real MySQL statements are verified separately, by compiling them
  against the mysql dialect without needing a live connection
  (see test_market_data_repository.py's test_upsert_sql_compiles_for_mysql).
"""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine, event, select
from sqlalchemy.dialects.mysql import BIGINT
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker

from irs_pricer.core import ttl_cache
from irs_pricer.db import models, repository, trace_repository


@pytest.fixture(autouse=True)
def _isolate_caches():
    """Reset the process-global TTL cache around every test.

    market_data_service's load_snapshot/load_fixings/list_available_dates are
    TTL-cached, and these tests deliberately swap the underlying source
    (monkeypatched DB vs Excel) between cases. Without this, one test's cached
    snapshot answers the next test's differently-mocked call and the failure
    lands somewhere unrelated. Autouse because it's needed by any test that
    touches market data, directly or transitively.
    """
    ttl_cache.clear()
    yield
    ttl_cache.clear()


@compiles(BIGINT, "sqlite")
def _bigint_as_integer_on_sqlite(element, compiler, **kw):
    return "INTEGER"


def _enable_sqlite_foreign_keys(dbapi_connection, connection_record):
    """SQLite ignores FK constraints unless a connection explicitly turns
    them on -- MySQL enforces them unconditionally, so without this, FK
    behavior (e.g. ON DELETE RESTRICT) would silently no-op in tests."""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


def _portable_upsert_quote_row(
    db,
    *,
    valuation_date,
    instrument_type,
    tenor_unit,
    tenor_count,
    mid_rate,
    source,
    bid_rate=None,
    ask_rate=None,
):
    existing = db.execute(
        select(models.MarketData).where(
            models.MarketData.valuation_date == valuation_date,
            models.MarketData.instrument_type == instrument_type,
            models.MarketData.tenor_unit == tenor_unit,
            models.MarketData.tenor_count == tenor_count,
        )
    ).scalar_one_or_none()
    if existing is not None:
        existing.bid_rate = bid_rate
        existing.ask_rate = ask_rate
        existing.mid_rate = mid_rate
        existing.source = source
    else:
        db.add(
            models.MarketData(
                valuation_date=valuation_date,
                instrument_type=instrument_type,
                tenor_unit=tenor_unit,
                tenor_count=tenor_count,
                bid_rate=bid_rate,
                ask_rate=ask_rate,
                mid_rate=mid_rate,
                source=source,
            )
        )


def _portable_upsert_snapshot(db, snapshot, source, on_rate_source=None):
    _portable_upsert_quote_row(
        db,
        valuation_date=snapshot.valuation_date,
        instrument_type=models.InstrumentType.CD,
        tenor_unit=models.TenorUnit.D,
        tenor_count=91,
        mid_rate=snapshot.cd_rate,
        source=source,
    )
    if snapshot.on_rate is not None:
        _portable_upsert_quote_row(
            db,
            valuation_date=snapshot.valuation_date,
            instrument_type=models.InstrumentType.ON,
            tenor_unit=models.TenorUnit.D,
            tenor_count=1,
            mid_rate=snapshot.on_rate,
            source=on_rate_source if on_rate_source is not None else source,
        )
    for q in snapshot.swap_quotes:
        tenor_count = q.tenor_months if q.tenor_months is not None else q.tenor_years * 12
        _portable_upsert_quote_row(
            db,
            valuation_date=snapshot.valuation_date,
            instrument_type=models.InstrumentType.IRS,
            tenor_unit=models.TenorUnit.M,
            tenor_count=tenor_count,
            mid_rate=q.rate,
            source=source,
        )
    db.commit()


def _portable_upsert_points(db, trade_id, points, source=None):
    if not points:
        return
    for p in points:
        existing = db.get(models.NpvPnlTrace, (trade_id, p["valuation_date"]))
        if existing is not None:
            existing.clean_npv = p["clean_npv"]
            existing.dirty_npv = p["dirty_npv"]
            existing.daily_pnl = p.get("daily_pnl")
            existing.cumulative_pnl = p["cumulative_pnl"]
            existing.market_data_source = source
        else:
            db.add(
                models.NpvPnlTrace(
                    trade_id=trade_id,
                    valuation_date=p["valuation_date"],
                    clean_npv=p["clean_npv"],
                    dirty_npv=p["dirty_npv"],
                    daily_pnl=p.get("daily_pnl"),
                    cumulative_pnl=p["cumulative_pnl"],
                    market_data_source=source,
                )
            )
    db.commit()


# Same 23 rows as alembic/versions/..._seed_tenor_pillar_reference_data.py
# (blueprint C.1) -- duplicated rather than imported, since a migration file
# is a frozen historical snapshot, not a library other code should depend
# on. tenor_pillar is always seeded before any market_data row can exist in
# real deployments (FK), so the `db` fixture seeds it automatically here too.
_TENOR_PILLAR_SEED = [
    ("D", 0, "BOK", 0, False), ("D", 1, "1D", 1, False), ("M", 3, "3M", 90, False),
    ("D", 91, "CD91D", 91, False), ("M", 6, "6M", 180, True), ("M", 9, "9M", 270, True),
    ("M", 12, "1Y", 360, True), ("M", 18, "1.5Y", 540, True), ("M", 24, "2Y", 720, True),
    ("M", 36, "3Y", 1080, True), ("M", 48, "4Y", 1440, True), ("M", 60, "5Y", 1800, True),
    ("M", 72, "6Y", 2160, True), ("M", 84, "7Y", 2520, True), ("M", 96, "8Y", 2880, True),
    ("M", 108, "9Y", 3240, True), ("M", 120, "10Y", 3600, True), ("M", 132, "11Y", 3960, True),
    ("M", 144, "12Y", 4320, True), ("M", 180, "15Y", 5400, True), ("M", 240, "20Y", 7200, True),
    ("M", 300, "25Y", 9000, True), ("M", 360, "30Y", 10800, True),
]


@pytest.fixture
def db(monkeypatch):
    """Fresh in-memory SQLite session per test, with all tables created,
    tenor_pillar pre-seeded (see _TENOR_PILLAR_SEED), and the MySQL-only
    upsert helpers swapped for portable equivalents (see module docstring).
    Pass this directly to repository/service functions that take a
    `db: Session` parameter."""
    engine = create_engine("sqlite:///:memory:")
    event.listen(engine, "connect", _enable_sqlite_foreign_keys)
    models.Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    session = session_factory()

    for unit, count, label, sort_order, is_standard in _TENOR_PILLAR_SEED:
        session.add(
            models.TenorPillar(
                tenor_unit=unit, tenor_count=count, label=label,
                sort_order=sort_order, is_standard_pillar=is_standard,
            )
        )
    session.commit()

    monkeypatch.setattr(repository, "upsert_quote_row", _portable_upsert_quote_row)
    monkeypatch.setattr(repository, "upsert_snapshot", _portable_upsert_snapshot)
    monkeypatch.setattr(trace_repository, "upsert_points", _portable_upsert_points)

    try:
        yield session
    finally:
        session.close()
        engine.dispose()
