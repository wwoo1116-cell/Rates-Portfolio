"""Regression tests for irs_pricer/db/trade_repository.py (blueprint A.3/B.2)."""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy.dialects import mysql
from sqlalchemy.exc import IntegrityError
from sqlalchemy.schema import CreateTable

from irs_pricer.db import models, trade_repository


def _make(db, external_position_id="p1", trade_date=date(2026, 1, 5), start_date=date(2026, 1, 5),
          maturity_date=date(2028, 1, 5), notional=1_000_000_000, fixed_rate=0.03, pay_fixed=True, **kw):
    return trade_repository.create(
        db, external_position_id=external_position_id, trade_date=trade_date, start_date=start_date,
        maturity_date=maturity_date, notional=notional, fixed_rate=fixed_rate, pay_fixed=pay_fixed, **kw,
    )


def test_create_and_get_round_trip(db):
    trade = _make(db)
    assert trade.trade_id is not None
    assert trade.status == models.TradeStatus.ACTIVE
    assert trade.float_index == "CD91D"
    assert trade.book is None
    assert trade.ticker is None
    fetched = trade_repository.get(db, trade.trade_id)
    assert fetched.external_position_id == "p1"


def test_book_and_ticker_round_trip(db):
    trade = _make(db, book="RP Trading", ticker="IRS 10Y KRW")
    fetched = trade_repository.get(db, trade.trade_id)
    assert fetched.book == "RP Trading"
    assert fetched.ticker == "IRS 10Y KRW"


def test_get_by_external_id(db):
    trade = _make(db, external_position_id="uuid-abc")
    assert trade_repository.get_by_external_id(db, "uuid-abc").trade_id == trade.trade_id
    assert trade_repository.get_by_external_id(db, "does-not-exist") is None


def test_get_missing_trade_returns_none(db):
    assert trade_repository.get(db, 9999) is None


def test_duplicate_external_id_rejected(db):
    _make(db, external_position_id="dup")
    with pytest.raises(IntegrityError):
        _make(db, external_position_id="dup")


class TestListActive:
    def test_excludes_cancelled(self, db):
        active = _make(db, external_position_id="a")
        cancelled = _make(db, external_position_id="b")
        trade_repository.cancel(db, cancelled.trade_id)
        ids = {t.trade_id for t in trade_repository.list_active(db)}
        assert ids == {active.trade_id}

    def test_as_of_date_excludes_matured_trades(self, db):
        _make(db, external_position_id="short", maturity_date=date(2026, 6, 1))
        _make(db, external_position_id="long", maturity_date=date(2030, 1, 1))
        ids = {t.external_position_id for t in trade_repository.list_active(db, as_of_date=date(2027, 1, 1))}
        assert ids == {"long"}


def test_cancel_is_soft_delete(db):
    trade = _make(db)
    cancelled = trade_repository.cancel(db, trade.trade_id)
    assert cancelled.status == models.TradeStatus.CANCELLED
    # row still exists and is fetchable -- not a hard delete
    assert trade_repository.get(db, trade.trade_id) is not None


def test_cancel_nonexistent_returns_none(db):
    assert trade_repository.cancel(db, 9999) is None


class TestImportLegacy:
    def test_imports_new_positions(self, db):
        positions = [
            {"position_id": "legacy-1", "start_date": date(2026, 1, 1), "maturity_date": date(2029, 1, 1),
             "notional": 1_000_000_000, "fixed_rate": 0.03, "pay_fixed": True, "float_spread": 0.0},
        ]
        imported = trade_repository.import_legacy(db, positions)
        assert len(imported) == 1
        assert imported[0].tenor_months is None  # explicit-date booking, no tenor provenance
        assert imported[0].trade_date == date(2026, 1, 1)  # trade_date defaults to start_date

    def test_reimport_is_idempotent(self, db):
        positions = [
            {"position_id": "legacy-1", "start_date": date(2026, 1, 1), "maturity_date": date(2029, 1, 1),
             "notional": 1_000_000_000, "fixed_rate": 0.03, "pay_fixed": True, "float_spread": 0.0},
        ]
        first = trade_repository.import_legacy(db, positions)
        second = trade_repository.import_legacy(db, positions)
        assert first[0].trade_id == second[0].trade_id
        assert db.query(models.TradeSpecification).count() == 1


def test_maturity_before_start_check_constraint_rejects(db):
    trade = models.TradeSpecification(
        external_position_id="bad", trade_date=date(2028, 1, 1), start_date=date(2028, 1, 1),
        maturity_date=date(2020, 1, 1), notional=1000, fixed_rate=0.03, pay_fixed=True,
    )
    db.add(trade)
    with pytest.raises(IntegrityError):
        db.commit()


def test_notional_must_be_positive(db):
    trade = models.TradeSpecification(
        external_position_id="bad", trade_date=date(2026, 1, 1), start_date=date(2026, 1, 1),
        maturity_date=date(2028, 1, 1), notional=-1, fixed_rate=0.03, pay_fixed=True,
    )
    db.add(trade)
    with pytest.raises(IntegrityError):
        db.commit()


def test_trade_specification_ddl_has_no_cascade_delete():
    """No ON DELETE CASCADE anywhere (blueprint B.2) -- the FK from
    npv_pnl_trace back to trade_specification is checked in
    test_trace_repository.py; this guards trade_specification's own DDL
    shape (surrogate BIGINT UNSIGNED PK, external UUID unique)."""
    ddl = str(CreateTable(models.TradeSpecification.__table__).compile(dialect=mysql.dialect()))
    assert "trade_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT" in ddl
    assert "UNIQUE (external_position_id)" in ddl
    assert "CASCADE" not in ddl
