"""Regression tests for irs_pricer/db/trace_repository.py (blueprint A.4/D.1)."""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import delete
from sqlalchemy.dialects import mysql
from sqlalchemy.exc import IntegrityError

from irs_pricer.db import models, trace_repository, trade_repository


@pytest.fixture
def trade(db):
    return trade_repository.create(
        db, external_position_id="t1", trade_date=date(2026, 1, 5), start_date=date(2026, 1, 5),
        maturity_date=date(2028, 1, 5), notional=1_000_000_000, fixed_rate=0.03, pay_fixed=True,
    )


def _points(*rows):
    """rows: (date, clean_npv, cumulative_pnl) tuples -> upsert_points payload."""
    return [
        {"valuation_date": d, "clean_npv": clean, "dirty_npv": clean, "daily_pnl": None, "cumulative_pnl": cum}
        for d, clean, cum in rows
    ]


def test_upsert_then_get_points_round_trip(db, trade):
    trace_repository.upsert_points(
        db, trade.trade_id,
        _points((date(2026, 1, 5), 0.0, 0.0), (date(2026, 1, 6), 1500.0, 1500.0)),
    )
    points = trace_repository.get_points(db, trade.trade_id, date(2026, 1, 1), date(2026, 1, 31))
    assert [(p.valuation_date, float(p.clean_npv)) for p in points] == [
        (date(2026, 1, 5), 0.0), (date(2026, 1, 6), 1500.0),
    ]


def test_get_points_filters_to_date_range(db, trade):
    trace_repository.upsert_points(
        db, trade.trade_id,
        _points((date(2026, 1, 5), 0.0, 0.0), (date(2026, 2, 5), 100.0, 100.0)),
    )
    points = trace_repository.get_points(db, trade.trade_id, date(2026, 1, 1), date(2026, 1, 31))
    assert len(points) == 1
    assert points[0].valuation_date == date(2026, 1, 5)


def test_upsert_overwrites_existing_row_on_same_key(db, trade):
    trace_repository.upsert_points(db, trade.trade_id, _points((date(2026, 1, 5), 0.0, 0.0)))
    trace_repository.upsert_points(db, trade.trade_id, _points((date(2026, 1, 5), 999.0, 999.0)))
    points = trace_repository.get_points(db, trade.trade_id, date(2026, 1, 1), date(2026, 1, 31))
    assert len(points) == 1
    assert float(points[0].clean_npv) == 999.0


def test_get_covered_dates(db, trade):
    trace_repository.upsert_points(
        db, trade.trade_id,
        _points((date(2026, 1, 5), 0.0, 0.0), (date(2026, 1, 7), 10.0, 10.0)),
    )
    covered = trace_repository.get_covered_dates(db, trade.trade_id, date(2026, 1, 1), date(2026, 1, 31))
    assert covered == {date(2026, 1, 5), date(2026, 1, 7)}


def test_get_entry_point_is_earliest_date(db, trade):
    trace_repository.upsert_points(
        db, trade.trade_id,
        _points((date(2026, 1, 10), 50.0, 50.0), (date(2026, 1, 5), 0.0, 0.0), (date(2026, 1, 20), 80.0, 80.0)),
    )
    entry = trace_repository.get_entry_point(db, trade.trade_id)
    assert entry.valuation_date == date(2026, 1, 5)


def test_get_entry_point_none_when_no_history(db, trade):
    assert trace_repository.get_entry_point(db, trade.trade_id) is None


def test_get_latest_before(db, trade):
    trace_repository.upsert_points(
        db, trade.trade_id,
        _points((date(2026, 1, 5), 0.0, 0.0), (date(2026, 1, 6), 10.0, 10.0), (date(2026, 1, 10), 20.0, 20.0)),
    )
    latest = trace_repository.get_latest_before(db, trade.trade_id, date(2026, 1, 8))
    assert latest.valuation_date == date(2026, 1, 6)
    assert trace_repository.get_latest_before(db, trade.trade_id, date(2026, 1, 5)) is None


def test_get_points_for_date_across_multiple_trades(db):
    t1 = trade_repository.create(db, external_position_id="t1", trade_date=date(2026, 1, 1),
                                  start_date=date(2026, 1, 1), maturity_date=date(2028, 1, 1),
                                  notional=1, fixed_rate=0.03, pay_fixed=True)
    t2 = trade_repository.create(db, external_position_id="t2", trade_date=date(2026, 1, 1),
                                  start_date=date(2026, 1, 1), maturity_date=date(2028, 1, 1),
                                  notional=1, fixed_rate=0.03, pay_fixed=False)
    trace_repository.upsert_points(db, t1.trade_id, _points((date(2026, 1, 5), 10.0, 10.0)))
    trace_repository.upsert_points(db, t2.trade_id, _points((date(2026, 1, 5), -5.0, -5.0)))
    trace_repository.upsert_points(db, t2.trade_id, _points((date(2026, 1, 6), -6.0, -6.0)))  # different date

    rows = trace_repository.get_points_for_date(db, [t1.trade_id, t2.trade_id], date(2026, 1, 5))
    assert {(r.trade_id, float(r.clean_npv)) for r in rows} == {(t1.trade_id, 10.0), (t2.trade_id, -5.0)}


def test_get_points_for_date_empty_trade_id_list_returns_empty(db, trade):
    assert trace_repository.get_points_for_date(db, [], date(2026, 1, 5)) == []


def test_upsert_points_noop_for_empty_list(db, trade):
    trace_repository.upsert_points(db, trade.trade_id, [])
    assert trace_repository.get_points(db, trade.trade_id, date(2020, 1, 1), date(2030, 1, 1)) == []


def test_fk_restrict_blocks_deleting_trade_with_trace_history(db, trade):
    """blueprint B.2: no hard delete of a trade with any valuation history --
    enforced at the DB level via ON DELETE RESTRICT, not just by convention
    in trade_repository (which only ever soft-deletes anyway). Uses a raw
    Core DELETE rather than db.delete(trade) -- the ORM's own default
    relationship cascade tries to null out the child's FK first (and fails
    its own way, since trade_id is part of NpvPnlTrace's composite PK),
    which would mask whether the *database* constraint itself is correct."""
    trace_repository.upsert_points(db, trade.trade_id, _points((date(2026, 1, 5), 0.0, 0.0)))
    with pytest.raises(IntegrityError):
        db.execute(delete(models.TradeSpecification).where(models.TradeSpecification.trade_id == trade.trade_id))
        db.commit()


def test_npv_pnl_trace_ddl_has_composite_pk_and_restrict_fk():
    from sqlalchemy.schema import CreateTable

    ddl = str(CreateTable(models.NpvPnlTrace.__table__).compile(dialect=mysql.dialect()))
    assert "PRIMARY KEY (trade_id, valuation_date)" in ddl
    assert "ON DELETE RESTRICT ON UPDATE RESTRICT" in ddl
