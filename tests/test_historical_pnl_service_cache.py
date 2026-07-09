"""
Regression tests for historical_pnl_service.compute_historical_pnl_for_trades'
read-through/cache-aside behavior (blueprint D.1) -- shares npv_pnl_trace
with npv_trace_service's single-trade cache. price_portfolio() builds the
curve once and prices every active trade against it, so the cache decision
is per-date (all active trades cached -> skip the curve build entirely;
even one missing -> recompute everyone that date, since the curve build is
already paid for) rather than per-trade-per-date.
"""

from __future__ import annotations

from datetime import date

import pytest

from irs_pricer.core.market_data import MarketSnapshot, RateQuote
from irs_pricer.db import trade_repository
from irs_pricer.services import historical_pnl_service, market_data_service
from irs_pricer.services import portfolio_service

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
def price_portfolio_spy(monkeypatch):
    calls = []
    original = portfolio_service.price_portfolio

    def spy(snapshot, positions, fixings):
        calls.append(snapshot.valuation_date)
        return original(snapshot, positions, fixings)

    monkeypatch.setattr(historical_pnl_service, "price_portfolio", spy)
    return calls


@pytest.fixture
def two_trades(db):
    t1 = trade_repository.create(
        db, external_position_id="t1", trade_date=date(2024, 1, 2), start_date=date(2024, 1, 2),
        maturity_date=date(2024, 1, 8), notional=10_000_000_000, fixed_rate=0.0270, pay_fixed=True,
    )
    t2 = trade_repository.create(
        db, external_position_id="t2", trade_date=date(2024, 1, 2), start_date=date(2024, 1, 2),
        maturity_date=date(2024, 1, 4), notional=5_000_000_000, fixed_rate=0.0265, pay_fixed=False,
    )
    return t1, t2


def test_cache_miss_calls_price_portfolio_once_per_date(db, patch_market_data, two_trades, price_portfolio_spy):
    t1, t2 = two_trades
    historical_pnl_service.compute_historical_pnl_for_trades(
        db, [t1.trade_id, t2.trade_id], date(2024, 1, 2), date(2024, 1, 8)
    )
    assert sorted(price_portfolio_spy) == _WINDOW_DATES


def test_cache_hit_makes_zero_price_portfolio_calls(db, patch_market_data, two_trades, price_portfolio_spy):
    t1, t2 = two_trades
    historical_pnl_service.compute_historical_pnl_for_trades(
        db, [t1.trade_id, t2.trade_id], date(2024, 1, 2), date(2024, 1, 8)
    )
    price_portfolio_spy.clear()

    historical_pnl_service.compute_historical_pnl_for_trades(
        db, [t1.trade_id, t2.trade_id], date(2024, 1, 2), date(2024, 1, 8)
    )
    assert price_portfolio_spy == []


def test_cached_result_matches_ground_truth_inline_computation(db, patch_market_data, two_trades):
    from irs_pricer.engine.instruments import VanillaSwap

    t1, t2 = two_trades
    cached_first = historical_pnl_service.compute_historical_pnl_for_trades(
        db, [t1.trade_id, t2.trade_id], date(2024, 1, 2), date(2024, 1, 8)
    )
    cached_second = historical_pnl_service.compute_historical_pnl_for_trades(
        db, [t1.trade_id, t2.trade_id], date(2024, 1, 2), date(2024, 1, 8)
    )

    inline_positions = [
        ("t1", VanillaSwap(tenor_years=0, notional=10_000_000_000, fixed_rate=0.0270, pay_fixed=True,
                            trade_date=date(2024, 1, 2), maturity_date=date(2024, 1, 8))),
        ("t2", VanillaSwap(tenor_years=0, notional=5_000_000_000, fixed_rate=0.0265, pay_fixed=False,
                            trade_date=date(2024, 1, 2), maturity_date=date(2024, 1, 4))),
    ]
    ground_truth = historical_pnl_service.compute_historical_pnl(inline_positions, date(2024, 1, 2), date(2024, 1, 8))

    cached_npvs = [p.net_npv for p in cached_second.points]
    ground_truth_npvs = [p.net_npv for p in ground_truth.points]
    assert cached_npvs == pytest.approx(ground_truth_npvs, abs=0.01)
    assert cached_first.baseline_net_npv == pytest.approx(ground_truth.baseline_net_npv, abs=0.01)


def test_active_position_ids_correct_across_differing_maturities(db, patch_market_data, two_trades):
    t1, t2 = two_trades  # t2 matures 2024-01-04, before the window ends
    result = historical_pnl_service.compute_historical_pnl_for_trades(
        db, [t1.trade_id, t2.trade_id], date(2024, 1, 2), date(2024, 1, 8)
    )
    by_date = {p.valuation_date: set(p.active_position_ids) for p in result.points}
    assert by_date[date(2024, 1, 4)] == {"t1", "t2"}
    assert by_date[date(2024, 1, 5)] == {"t1"}  # t2 already matured


def test_nonexistent_trade_id_raises(db, patch_market_data, two_trades):
    t1, _ = two_trades
    with pytest.raises(ValueError):
        historical_pnl_service.compute_historical_pnl_for_trades(db, [t1.trade_id, 9999], date(2024, 1, 2), date(2024, 1, 8))
