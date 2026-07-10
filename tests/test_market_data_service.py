"""
Regression tests for irs_pricer/services/market_data_service.py's DB-first/
Excel-fallback logic (blueprint D.1, plus the resilience fallback added on
top of it after explicit confirmation -- see PROGRESS.md/session notes:
migration day must never take pricing down mid-session).

market_data_service.py imports session_scope and the loaders.factory
functions directly (`from X import Y`), which binds new names into its own
module namespace -- monkeypatching irs_pricer.db.database.session_scope
would NOT affect market_data_service's already-bound reference, so every
patch below targets market_data_service's own attributes.
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import date

import pytest
from sqlalchemy.exc import SQLAlchemyError

from irs_pricer.core.market_data import MarketSnapshot, RateQuote
from irs_pricer.db import repository
from irs_pricer.db.connection_settings import DatabaseNotConfiguredError
from irs_pricer.services import market_data_service

_FAKE_DATE = date(2026, 1, 5)


@pytest.fixture(autouse=True)
def _reset_live_snapshot_cache():
    """_live_snapshots is module-level mutable state -- without resetting it,
    a value set by one test would leak into the next."""
    market_data_service._live_snapshots.clear()
    yield
    market_data_service._live_snapshots.clear()


@pytest.fixture(autouse=True)
def _reset_db_availability():
    """_db_market_data_unavailable is also module-level mutable state (a
    fast-path latch set on the first DB failure, see market_data_service.py) --
    same leakage risk as _live_snapshots above."""
    market_data_service._db_market_data_unavailable = False
    yield
    market_data_service._db_market_data_unavailable = False


@pytest.fixture
def db_reachable(monkeypatch, db):
    """Point market_data_service at the shared `db` fixture's session (tables
    created, tenor_pillar seeded) as if the real MySQL connection were live."""

    @contextmanager
    def _scope():
        yield db

    monkeypatch.setattr(market_data_service, "session_scope", _scope)
    return db


@pytest.fixture
def db_unconfigured(monkeypatch):
    @contextmanager
    def _scope():
        raise DatabaseNotConfiguredError()
        yield  # pragma: no cover -- unreachable, required for generator syntax

    monkeypatch.setattr(market_data_service, "session_scope", _scope)


@pytest.fixture
def db_connection_broken(monkeypatch):
    @contextmanager
    def _scope():
        raise SQLAlchemyError("connection refused")
        yield  # pragma: no cover

    monkeypatch.setattr(market_data_service, "session_scope", _scope)


def _no_excel_source(monkeypatch, *, dates=None, fixings=None):
    """Stand in for loaders/factory.py without touching real Excel files --
    default is 'no file source available at all' (raises ValueError), since
    most fallback tests care about DB behavior, not Excel's own logic (that's
    covered by loaders/ tests directly)."""
    dates = dates if dates is not None else []

    def _list_dates(_data_dir):
        if not dates:
            raise ValueError("no file source")
        return list(dates)

    def _load_snapshot(_data_dir, _valuation_date):
        raise ValueError("no file source")

    def _load_fixings(_data_dir):
        return fixings if fixings is not None else {}

    monkeypatch.setattr(market_data_service, "_list_available_dates", _list_dates)
    monkeypatch.setattr(market_data_service, "load_market_snapshot", _load_snapshot)
    monkeypatch.setattr(market_data_service, "load_fixing_history", _load_fixings)


class TestLoadSnapshotFallback:
    def test_falls_back_to_excel_when_db_unconfigured(self, monkeypatch, db_unconfigured):
        excel_snapshot = MarketSnapshot(valuation_date=_FAKE_DATE, cd_rate=0.0292, swap_quotes=[RateQuote(2, 0.03)])
        monkeypatch.setattr(market_data_service, "load_market_snapshot", lambda _dir, _d: excel_snapshot)
        result = market_data_service.load_snapshot(_FAKE_DATE)
        assert result is excel_snapshot

    def test_falls_back_to_excel_when_db_connection_broken(self, monkeypatch, db_connection_broken):
        excel_snapshot = MarketSnapshot(valuation_date=_FAKE_DATE, cd_rate=0.0292, swap_quotes=[RateQuote(2, 0.03)])
        monkeypatch.setattr(market_data_service, "load_market_snapshot", lambda _dir, _d: excel_snapshot)
        result = market_data_service.load_snapshot(_FAKE_DATE)
        assert result is excel_snapshot

    def test_falls_back_to_excel_when_db_has_no_row_for_date(self, monkeypatch, db_reachable):
        """DB is reachable and empty for this date -- still falls through to Excel."""
        excel_snapshot = MarketSnapshot(valuation_date=_FAKE_DATE, cd_rate=0.0292, swap_quotes=[RateQuote(2, 0.03)])
        monkeypatch.setattr(market_data_service, "load_market_snapshot", lambda _dir, _d: excel_snapshot)
        result = market_data_service.load_snapshot(_FAKE_DATE)
        assert result is excel_snapshot

    def test_prefers_db_over_excel_when_both_have_data(self, monkeypatch, db_reachable):
        """The whole point of DB-first: once MySQL has a row, Excel is never
        even touched (asserted via a loader that would fail the test if called)."""
        repository.upsert_snapshot(
            db_reachable,
            MarketSnapshot(valuation_date=_FAKE_DATE, cd_rate=0.0299, swap_quotes=[RateQuote(2, 0.031)]),
            source=repository.MarketDataSource.TRUE_DATA,
        )

        def _fail_if_called(_dir, _d):
            raise AssertionError("Excel loader should not be called when DB has the date")

        monkeypatch.setattr(market_data_service, "load_market_snapshot", _fail_if_called)
        result = market_data_service.load_snapshot(_FAKE_DATE)
        assert result.cd_rate == pytest.approx(0.0299)

    def test_live_cache_takes_priority_over_db_and_excel(self, monkeypatch, db_reachable):
        repository.upsert_snapshot(
            db_reachable,
            MarketSnapshot(valuation_date=_FAKE_DATE, cd_rate=0.05, swap_quotes=[RateQuote(2, 0.05)]),
            source=repository.MarketDataSource.TRUE_DATA,
        )
        live = MarketSnapshot(valuation_date=_FAKE_DATE, cd_rate=0.0301, swap_quotes=[RateQuote(2, 0.031)])
        market_data_service.update_live(live)
        assert market_data_service.load_snapshot(_FAKE_DATE) is live

    def test_neither_db_nor_excel_has_data_raises_value_error(self, monkeypatch, db_reachable):
        _no_excel_source(monkeypatch)
        with pytest.raises(ValueError):
            market_data_service.load_snapshot(_FAKE_DATE)

    def test_db_failure_short_circuits_subsequent_lookups_in_same_process(self, monkeypatch, db_connection_broken):
        """rate_history_service.get_rate_history can iterate several thousand
        dates in one request -- once the DB has failed once, later dates in
        the same process must not pay for another doomed round-trip."""
        excel_snapshot = MarketSnapshot(valuation_date=_FAKE_DATE, cd_rate=0.0292, swap_quotes=[RateQuote(2, 0.03)])
        monkeypatch.setattr(market_data_service, "load_market_snapshot", lambda _dir, _d: excel_snapshot)
        market_data_service.load_snapshot(_FAKE_DATE)  # first call: hits (and fails) the DB, latches the flag
        assert market_data_service._db_market_data_unavailable is True

        def _fail_if_called():
            raise AssertionError("session_scope should not be called once DB has already failed this process")

        monkeypatch.setattr(market_data_service, "session_scope", _fail_if_called)
        other_date = date(2026, 1, 6)
        result = market_data_service.load_snapshot(other_date)
        assert result is excel_snapshot

    def test_weekend_raises_non_business_day_before_touching_db_or_excel(self, db_unconfigured):
        from irs_pricer.core.errors import NonBusinessDayError

        saturday = date(2026, 1, 3)  # 2026-01-03 is a Saturday
        with pytest.raises(NonBusinessDayError):
            market_data_service.load_snapshot(saturday)


class TestListAvailableDates:
    def test_merges_db_and_excel_dates(self, monkeypatch, db_reachable):
        repository.upsert_snapshot(
            db_reachable,
            MarketSnapshot(valuation_date=date(2026, 1, 10), cd_rate=0.03, swap_quotes=[RateQuote(2, 0.03)]),
            source=repository.MarketDataSource.TRUE_DATA,
        )
        _no_excel_source(monkeypatch, dates=[date(2026, 1, 5), date(2026, 1, 20)])
        assert market_data_service.list_available_dates() == [date(2026, 1, 5), date(2026, 1, 10), date(2026, 1, 20)]

    def test_db_unreachable_still_returns_excel_dates(self, monkeypatch, db_connection_broken):
        _no_excel_source(monkeypatch, dates=[date(2026, 1, 5)])
        assert market_data_service.list_available_dates() == [date(2026, 1, 5)]

    def test_raises_when_no_source_has_any_dates(self, monkeypatch, db_unconfigured):
        _no_excel_source(monkeypatch)
        with pytest.raises(ValueError):
            market_data_service.list_available_dates()


class TestUpdateLive:
    def test_always_updates_in_memory_cache_even_if_db_unreachable(self, db_connection_broken):
        snap = MarketSnapshot(valuation_date=_FAKE_DATE, cd_rate=0.03, swap_quotes=[RateQuote(2, 0.03)])
        market_data_service.update_live(snap)  # must not raise
        assert market_data_service.load_snapshot(_FAKE_DATE) is snap

    def test_persists_to_db_as_live_feed_source_when_reachable(self, db_reachable):
        snap = MarketSnapshot(valuation_date=_FAKE_DATE, cd_rate=0.03, swap_quotes=[RateQuote(2, 0.03)])
        market_data_service.update_live(snap)
        row = repository.get_snapshot(db_reachable, _FAKE_DATE)
        assert row is not None
        stored = db_reachable.query(repository.MarketData).filter_by(instrument_type=repository.InstrumentType.CD).one()
        assert stored.source == repository.MarketDataSource.LIVE_FEED


class TestLoadFixings:
    def test_prefers_db_when_it_has_any_rows(self, monkeypatch, db_reachable):
        repository.upsert_snapshot(
            db_reachable,
            MarketSnapshot(valuation_date=_FAKE_DATE, cd_rate=0.0292, swap_quotes=[RateQuote(2, 0.03)]),
            source=repository.MarketDataSource.TRUE_DATA,
        )
        monkeypatch.setattr(
            market_data_service, "load_fixing_history",
            lambda _dir: (_ for _ in ()).throw(AssertionError("Excel fixings should not be read when DB has rows")),
        )
        fixings = market_data_service.load_fixings()
        assert fixings == {_FAKE_DATE: pytest.approx(0.0292)}

    def test_falls_back_to_excel_when_db_empty(self, monkeypatch, db_reachable):
        monkeypatch.setattr(market_data_service, "load_fixing_history", lambda _dir: {_FAKE_DATE: 0.0288})
        assert market_data_service.load_fixings() == {_FAKE_DATE: 0.0288}
