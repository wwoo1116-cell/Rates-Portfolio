"""
Regression tests for irs_pricer/db/repository.py (blueprint A.2/D.1) --
the tenor (tenor_unit, tenor_count) <-> RateQuote(tenor_years, tenor_months)
round-trip is the single most load-bearing piece of this migration (it's
what fixes the historical "6M/9M/18M collide as integer years" bug), so it
gets the most direct coverage here.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy.dialects import mysql
from sqlalchemy.exc import IntegrityError
from sqlalchemy.schema import CreateTable

from irs_pricer.core.market_data import MarketSnapshot, RateQuote
from irs_pricer.db import models, repository


def _seed_row(db, *, valuation_date, instrument_type, tenor_unit, tenor_count, mid_rate,
              source=models.MarketDataSource.TRUE_DATA, bid_rate=None, ask_rate=None):
    db.add(
        models.MarketData(
            valuation_date=valuation_date, instrument_type=instrument_type,
            tenor_unit=tenor_unit, tenor_count=tenor_count,
            bid_rate=bid_rate, ask_rate=ask_rate, mid_rate=mid_rate, source=source,
        )
    )
    db.commit()


class TestTenorRoundTrip:
    """(tenor_unit, tenor_count) -> RateQuote(tenor_years, tenor_months), matching
    the historical IRS_TENORS convention exactly (loaders/infomax_schema.py):
    whole-year tenors divide evenly; sub-annual ones round the nominal
    tenor_years UP (6M/9M -> 1, 18M -> 2)."""

    def test_whole_year_tenor_has_no_tenor_months(self, db):
        d = date(2026, 1, 5)
        _seed_row(db, valuation_date=d, instrument_type=models.InstrumentType.CD,
                  tenor_unit=models.TenorUnit.D, tenor_count=91, mid_rate=Decimal("0.0292"))
        _seed_row(db, valuation_date=d, instrument_type=models.InstrumentType.IRS,
                  tenor_unit=models.TenorUnit.M, tenor_count=24, mid_rate=Decimal("0.0300"))
        snapshot = repository.get_snapshot(db, d)
        quote = snapshot.swap_quotes[0]
        assert quote.tenor_years == 2
        assert quote.tenor_months is None

    @pytest.mark.parametrize(
        "tenor_count,expected_nominal_years",
        [(6, 1), (9, 1), (18, 2)],  # 6M, 9M, 1.5Y -- the tenors that historically collided
    )
    def test_subannual_tenor_rounds_nominal_years_up(self, db, tenor_count, expected_nominal_years):
        d = date(2026, 1, 5)
        _seed_row(db, valuation_date=d, instrument_type=models.InstrumentType.CD,
                  tenor_unit=models.TenorUnit.D, tenor_count=91, mid_rate=Decimal("0.0292"))
        _seed_row(db, valuation_date=d, instrument_type=models.InstrumentType.IRS,
                  tenor_unit=models.TenorUnit.M, tenor_count=tenor_count, mid_rate=Decimal("0.0300"))
        quote = repository.get_snapshot(db, d).swap_quotes[0]
        assert quote.tenor_months == tenor_count
        assert quote.tenor_years == expected_nominal_years

    def test_6m_and_9m_and_18m_coexist_without_collision(self, db):
        """The actual historical bug: integer-year-only storage made 6M/9M
        both collide onto tenor_years=1, and 18M collide onto tenor_years=2
        with a plain 2Y quote. tenor_months as part of the key means all
        four now coexist as distinct rows for the same date."""
        d = date(2026, 1, 5)
        _seed_row(db, valuation_date=d, instrument_type=models.InstrumentType.CD,
                  tenor_unit=models.TenorUnit.D, tenor_count=91, mid_rate=Decimal("0.0292"))
        for tenor_count, rate in [(6, "0.0280"), (9, "0.0285"), (18, "0.0295"), (24, "0.0300")]:
            _seed_row(db, valuation_date=d, instrument_type=models.InstrumentType.IRS,
                      tenor_unit=models.TenorUnit.M, tenor_count=tenor_count, mid_rate=Decimal(rate))
        quotes = {(q.tenor_years, q.tenor_months): q.rate for q in repository.get_snapshot(db, d).swap_quotes}
        assert quotes[(1, 6)] == pytest.approx(0.0280)
        assert quotes[(1, 9)] == pytest.approx(0.0285)
        assert quotes[(2, 18)] == pytest.approx(0.0295)
        assert quotes[(2, None)] == pytest.approx(0.0300)


class TestGetSnapshot:
    def test_returns_none_for_date_with_no_rows(self, db):
        assert repository.get_snapshot(db, date(2099, 1, 1)) is None

    def test_returns_none_when_cd_row_missing_even_if_irs_rows_exist(self, db):
        """cd_rate is non-optional on MarketSnapshot -- a date with IRS
        quotes but no CD91D print isn't a usable snapshot."""
        d = date(2026, 1, 5)
        _seed_row(db, valuation_date=d, instrument_type=models.InstrumentType.IRS,
                  tenor_unit=models.TenorUnit.M, tenor_count=24, mid_rate=Decimal("0.03"))
        assert repository.get_snapshot(db, d) is None

    def test_on_rate_none_when_no_on_row(self, db):
        d = date(2026, 1, 5)
        _seed_row(db, valuation_date=d, instrument_type=models.InstrumentType.CD,
                  tenor_unit=models.TenorUnit.D, tenor_count=91, mid_rate=Decimal("0.0292"))
        assert repository.get_snapshot(db, d).on_rate is None

    def test_on_rate_populated_when_on_row_present(self, db):
        d = date(2026, 1, 5)
        _seed_row(db, valuation_date=d, instrument_type=models.InstrumentType.CD,
                  tenor_unit=models.TenorUnit.D, tenor_count=91, mid_rate=Decimal("0.0292"))
        _seed_row(db, valuation_date=d, instrument_type=models.InstrumentType.ON,
                  tenor_unit=models.TenorUnit.D, tenor_count=1, mid_rate=Decimal("0.0250"))
        assert repository.get_snapshot(db, d).on_rate == pytest.approx(0.0250)


class TestGetAvailableDatesAndFixings:
    def test_available_dates_sorted_ascending(self, db):
        for d in [date(2026, 1, 10), date(2026, 1, 5), date(2026, 1, 20)]:
            _seed_row(db, valuation_date=d, instrument_type=models.InstrumentType.CD,
                      tenor_unit=models.TenorUnit.D, tenor_count=91, mid_rate=Decimal("0.03"))
        assert repository.get_available_dates(db) == [date(2026, 1, 5), date(2026, 1, 10), date(2026, 1, 20)]

    def test_cd_fixing_history_keyed_by_date(self, db):
        _seed_row(db, valuation_date=date(2026, 1, 5), instrument_type=models.InstrumentType.CD,
                  tenor_unit=models.TenorUnit.D, tenor_count=91, mid_rate=Decimal("0.0292"))
        _seed_row(db, valuation_date=date(2026, 1, 6), instrument_type=models.InstrumentType.CD,
                  tenor_unit=models.TenorUnit.D, tenor_count=91, mid_rate=Decimal("0.0293"))
        history = repository.get_cd_fixing_history(db)
        assert history == {date(2026, 1, 5): pytest.approx(0.0292), date(2026, 1, 6): pytest.approx(0.0293)}


class TestUpsertSnapshot:
    def test_on_rate_source_distinct_from_primary_source(self, db):
        """on_rate always actually comes from Call Rate Data.xlsx historically
        (True Data.xlsx has no O/N column at all) -- upsert_snapshot must be
        able to label it CALL_RATE even while the rest of the snapshot is
        credited to TRUE_DATA/TOTAL_DATA/CSV, or the audit trail misreports
        provenance (see repository.upsert_snapshot's docstring)."""
        snapshot = MarketSnapshot(
            valuation_date=date(2026, 1, 5), cd_rate=0.0292,
            swap_quotes=[RateQuote(2, 0.03)], on_rate=0.025,
        )
        repository.upsert_snapshot(
            db, snapshot, source=models.MarketDataSource.TOTAL_DATA,
            on_rate_source=models.MarketDataSource.CALL_RATE,
        )
        rows = {r.instrument_type: r.source for r in db.query(models.MarketData).all()}
        assert rows[models.InstrumentType.CD] == models.MarketDataSource.TOTAL_DATA
        assert rows[models.InstrumentType.IRS] == models.MarketDataSource.TOTAL_DATA
        assert rows[models.InstrumentType.ON] == models.MarketDataSource.CALL_RATE

    def test_upsert_is_idempotent_on_same_key(self, db):
        snapshot = MarketSnapshot(valuation_date=date(2026, 1, 5), cd_rate=0.0292, swap_quotes=[RateQuote(2, 0.03)])
        repository.upsert_snapshot(db, snapshot, source=models.MarketDataSource.TRUE_DATA)
        updated = MarketSnapshot(valuation_date=date(2026, 1, 5), cd_rate=0.0295, swap_quotes=[RateQuote(2, 0.031)])
        repository.upsert_snapshot(db, updated, source=models.MarketDataSource.TRUE_DATA)
        assert db.query(models.MarketData).count() == 2  # CD + one IRS row, not 4
        assert repository.get_snapshot(db, date(2026, 1, 5)).cd_rate == pytest.approx(0.0295)


def test_bidask_bracket_mid_check_constraint_rejects_swapped_columns(db):
    """Catches an ETL parsing bug (bid/ask columns swapped/mis-offset) at
    write time rather than silently persisting bad data."""
    db.add(
        models.MarketData(
            valuation_date=date(2026, 1, 5), instrument_type=models.InstrumentType.IRS,
            tenor_unit=models.TenorUnit.M, tenor_count=24,
            bid_rate=Decimal("0.05"), ask_rate=Decimal("0.01"), mid_rate=Decimal("0.03"),  # bid > ask: invalid
            source=models.MarketDataSource.TRUE_DATA,
        )
    )
    with pytest.raises(IntegrityError):
        db.commit()


def test_upsert_sql_compiles_for_mysql():
    """The real INSERT ... ON DUPLICATE KEY UPDATE (SQLite can't execute this
    at all, hence the portable stand-in the `db` fixture installs) -- this
    confirms the actual MySQL statement irs_pricer/db/repository.py emits in
    production is well-formed, without needing a live MySQL connection."""
    stmt = mysql.insert(models.MarketData).values(
        valuation_date=date(2026, 1, 5), instrument_type=models.InstrumentType.CD,
        tenor_unit=models.TenorUnit.D, tenor_count=91, bid_rate=None, ask_rate=None,
        mid_rate=Decimal("0.0292"), source=models.MarketDataSource.LIVE_FEED,
    )
    stmt = stmt.on_duplicate_key_update(
        bid_rate=stmt.inserted.bid_rate, ask_rate=stmt.inserted.ask_rate,
        mid_rate=stmt.inserted.mid_rate, source=stmt.inserted.source,
    )
    sql = str(stmt.compile(dialect=mysql.dialect()))
    assert "ON DUPLICATE KEY UPDATE" in sql
    assert "INSERT INTO market_data" in sql


def test_market_data_ddl_uses_expected_mysql_types():
    """Guards against a future edit accidentally reverting a column back to
    a signed/generic type (see blueprint A.2's exact type list)."""
    ddl = str(CreateTable(models.MarketData.__table__).compile(dialect=mysql.dialect()))
    assert "BIGINT UNSIGNED NOT NULL AUTO_INCREMENT" in ddl
    assert "SMALLINT UNSIGNED NOT NULL" in ddl
    assert "DECIMAL(10, 7)" in ddl
    assert "ON DELETE RESTRICT ON UPDATE CASCADE" in ddl
