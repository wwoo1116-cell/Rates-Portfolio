"""
Regression tests for npv_trace_service.compute_npv_trace_for_trade's
read-through/cache-aside behavior (blueprint D.1) -- the point of caching is
skipping mtm_service.value_trade() (one QuantLib curve build + swap
valuation per date) on a repeat call, so every test here spies on that call
count rather than just checking the returned numbers.
"""

from __future__ import annotations

from datetime import date

import pytest

from irs_pricer.core.market_data import MarketSnapshot, RateQuote
from irs_pricer.db import trade_repository
from irs_pricer.services import market_data_service, mtm_service, npv_trace_service

_QUOTES = [(1, 0.0280), (2, 0.0270), (3, 0.0265), (5, 0.0260), (7, 0.0258), (10, 0.0257)]
_WINDOW_DATES = [date(2024, 1, 2), date(2024, 1, 3), date(2024, 1, 4), date(2024, 1, 5), date(2024, 1, 8)]


def _fake_snapshot(valuation_date: date) -> MarketSnapshot:
    return MarketSnapshot(valuation_date=valuation_date, cd_rate=0.0292, swap_quotes=[RateQuote(t, r) for t, r in _QUOTES])


@pytest.fixture
def patch_market_data(monkeypatch):
    monkeypatch.setattr(market_data_service, "list_available_dates", lambda: list(_WINDOW_DATES))
    monkeypatch.setattr(market_data_service, "load_fixings", lambda: {})
    monkeypatch.setattr(market_data_service, "load_snapshot", _fake_snapshot)


@pytest.fixture
def value_trade_spy(monkeypatch):
    calls = []
    original = mtm_service.value_trade

    def spy(snapshot, swap, fixings):
        calls.append(snapshot.valuation_date)
        return original(snapshot, swap, fixings)

    monkeypatch.setattr(mtm_service, "value_trade", spy)
    return calls


@pytest.fixture
def booked_trade(db):
    return trade_repository.create(
        db, external_position_id="t1", trade_date=date(2024, 1, 2), start_date=date(2024, 1, 2),
        maturity_date=date(2024, 1, 8), notional=10_000_000_000, fixed_rate=0.0270, pay_fixed=True,
    )


def test_cache_miss_computes_every_window_date(db, patch_market_data, booked_trade, value_trade_spy):
    result = npv_trace_service.compute_npv_trace_for_trade(db, booked_trade.trade_id, date(2024, 1, 2), date(2024, 1, 8))
    assert len(value_trade_spy) == len(_WINDOW_DATES) == len(result.points)


def test_cache_hit_makes_zero_value_trade_calls(db, patch_market_data, booked_trade, value_trade_spy):
    npv_trace_service.compute_npv_trace_for_trade(db, booked_trade.trade_id, date(2024, 1, 2), date(2024, 1, 8))
    value_trade_spy.clear()

    result = npv_trace_service.compute_npv_trace_for_trade(db, booked_trade.trade_id, date(2024, 1, 2), date(2024, 1, 8))
    assert value_trade_spy == []
    assert len(result.points) == len(_WINDOW_DATES)


def test_cached_values_match_freshly_computed_values(db, patch_market_data, booked_trade):
    first = npv_trace_service.compute_npv_trace_for_trade(db, booked_trade.trade_id, date(2024, 1, 2), date(2024, 1, 8))
    second = npv_trace_service.compute_npv_trace_for_trade(db, booked_trade.trade_id, date(2024, 1, 2), date(2024, 1, 8))
    assert [p.clean_npv for p in second.points] == pytest.approx([p.clean_npv for p in first.points])
    assert second.entry_npv == pytest.approx(first.entry_npv)


def test_partial_window_only_recomputes_missing_dates(db, patch_market_data, booked_trade, value_trade_spy):
    """Query a narrower window first (caches 2 of 5 dates), then the full
    window -- only the 3 uncached dates should trigger value_trade()."""
    npv_trace_service.compute_npv_trace_for_trade(db, booked_trade.trade_id, date(2024, 1, 2), date(2024, 1, 3))
    value_trade_spy.clear()

    npv_trace_service.compute_npv_trace_for_trade(db, booked_trade.trade_id, date(2024, 1, 2), date(2024, 1, 8))
    assert sorted(value_trade_spy) == [date(2024, 1, 4), date(2024, 1, 5), date(2024, 1, 8)]


def test_first_point_has_zero_daily_pnl_and_zero_cumulative_pnl(db, patch_market_data, booked_trade):
    result = npv_trace_service.compute_npv_trace_for_trade(db, booked_trade.trade_id, date(2024, 1, 2), date(2024, 1, 8))
    assert result.points[0].daily_pnl == 0.0
    assert result.points[0].cumulative_pnl == 0.0
    # s13: the entry mark is the first point's DIRTY npv, matching
    # compute_npv_trace(). (On this fixture clean == dirty at entry -- the
    # valuation date precedes the effective start, so nothing has accrued --
    # but the pinned convention is dirty.)
    assert result.entry_npv == pytest.approx(result.points[0].dirty_npv)


def test_nonexistent_trade_id_raises(db, patch_market_data):
    with pytest.raises(ValueError):
        npv_trace_service.compute_npv_trace_for_trade(db, 9999, date(2024, 1, 2), date(2024, 1, 8))
