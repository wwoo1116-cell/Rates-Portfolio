"""Reset-date fixing selection semantics (engine/fixings.py).

Pins the owner-confirmed KRW CD-IRS desk convention and its guard rails:

  - F(R) = R - CD_FIXING_LAG_SEOUL_BDAYS Seoul business days (lag pinned = 1,
    switchable), with BUSINESS-DAY arithmetic around weekends and holidays;
  - a period's rate is immutable once F(R) has passed (no daily re-fixing off
    the valuation-date CD -- the old npv_trace behavior);
  - a fixing dated after the valuation date is never selected (no look-ahead
    -- the old mtm/portfolio max(fixings.keys()) behavior);
  - ffill below F(R) is a data-availability fallback that must surface as a
    data-quality warning when F(R) is a business day, never silently.

Fixture swap (same as test_unit_guard): trade 2025-04-15 -> effective
2025-04-16, pays [2025-07-16, 2025-10-15]. So the first period's reset is
R1 = 2025-04-16 with F(R1) = 2025-04-15, and the second period's reset is
R2 = 2025-07-16 with F(R2) = 2025-07-15.
"""

from __future__ import annotations

import logging
from datetime import date

import pytest

from irs_pricer.core.market_data import MarketSnapshot, RateQuote
from irs_pricer.engine.curve import build_curve
from irs_pricer.engine.fixings import (
    CD_FIXING_LAG_SEOUL_BDAYS,
    dedupe_data_quality_events,
    fixing_date_for_reset,
    select_fixing,
)
from irs_pricer.engine.instruments import VanillaSwap
from irs_pricer.engine.mtm_valuation import value_booked_trade
from irs_pricer.engine.quant_engine import _KR_HOLIDAYS
from irs_pricer.services import mtm_service, portfolio_service


def _snapshot(valuation_date: date, rate: float = 0.025) -> MarketSnapshot:
    return MarketSnapshot(
        valuation_date=valuation_date,
        cd_rate=rate,
        swap_quotes=[RateQuote(t, rate) for t in (1, 2, 3, 5)],
    )


def _swap() -> VanillaSwap:
    return VanillaSwap(
        tenor_years=0.5,
        notional=10_000_000_000.0,
        fixed_rate=0.03,
        pay_fixed=True,
        trade_date=date(2025, 4, 15),
        maturity_date=date(2025, 10, 15),
    )


def _stub(result):
    stubs = [c for c in result.cashflows if c.leg == "floating"]
    return stubs[0]


# ── the lag constant and F(R) arithmetic ─────────────────────────────────────

def test_lag_constant_is_one_seoul_business_day():
    """Owner-confirmed desk convention. Changing it must be a deliberate edit
    of CD_FIXING_LAG_SEOUL_BDAYS, which this test makes loud."""
    assert CD_FIXING_LAG_SEOUL_BDAYS == 1


def test_normal_reset_maps_to_prior_business_day():
    # Wed 2025-07-16 -> Tue 2025-07-15
    assert fixing_date_for_reset(date(2025, 7, 16)) == date(2025, 7, 15)


def test_weekend_reset_maps_to_preceding_friday():
    # Mon 2025-07-14: the prior CALENDAR day is a Sunday; business-day
    # arithmetic must land on Friday 2025-07-11.
    assert fixing_date_for_reset(date(2025, 7, 14)) == date(2025, 7, 11)


@pytest.mark.skipif(
    date(2023, 5, 29) not in _KR_HOLIDAYS,
    reason="holidays.KR unavailable or 2023-05-29 not marked",
)
def test_holiday_reset_maps_to_preceding_business_day():
    # Tue 2023-05-30; Mon 2023-05-29 is a KR substitute holiday, so F(R) must
    # skip it AND the weekend and land on Fri 2023-05-26 -- business-day
    # arithmetic, not calendar subtraction.
    assert fixing_date_for_reset(date(2023, 5, 30)) == date(2023, 5, 26)
    assert fixing_date_for_reset(date(2023, 5, 30)) != date(2023, 5, 29)


def test_lag_is_switchable():
    assert fixing_date_for_reset(date(2025, 7, 16), lag=2) == date(2025, 7, 14)
    assert fixing_date_for_reset(date(2025, 7, 16), lag=0) == date(2025, 7, 16)


# ── no look-ahead ────────────────────────────────────────────────────────────

def test_future_dated_fixing_is_never_selected():
    """A fixing dated after the valuation date sits in the store (the whole
    history is always loaded) -- it must not leak into the valuation."""
    future_only = {date(2025, 7, 10): 0.04}
    res = select_fixing(future_only, reset_date=date(2025, 4, 16), valuation_date=date(2025, 7, 1))
    assert res is not None and res.rate is None  # F(R)=04-15 passed, store can't cover it

    curve = build_curve(_snapshot(date(2025, 7, 1)))
    result = value_booked_trade(_swap(), curve, future_only)
    stub = _stub(result)
    assert not stub.is_known
    assert stub.rate == pytest.approx(0.025, rel=0.05)  # curve forward, not 0.04


def test_unfixed_period_returns_none():
    # F(R2) = 2025-07-15 is after the 2025-07-01 valuation date.
    fixings = {date(2025, 4, 15): 0.02, date(2025, 7, 15): 0.04}
    assert select_fixing(fixings, date(2025, 7, 16), date(2025, 7, 1)) is None


def test_mtm_service_no_longer_looks_ahead():
    """mtm_service used max(fixings.keys()) -- today's print on historical
    dates. The reset-date selection must pick the F(R1) print instead."""
    fixings = {date(2025, 4, 15): 0.02, date(2025, 7, 15): 0.04}
    result = mtm_service.value_trade(_snapshot(date(2025, 7, 1)), _swap(), fixings)
    assert _stub(result).rate == pytest.approx(0.02, rel=1e-12)


# ── immutability across valuation dates ──────────────────────────────────────

def test_period_rate_is_immutable_as_valuation_advances():
    fixings = {
        date(2025, 4, 15): 0.02,   # F(R1): the period's true fixing
        date(2025, 5, 15): 0.03,   # newer prints the old ffill would have taken
        date(2025, 7, 15): 0.04,
    }
    for val in (date(2025, 5, 2), date(2025, 6, 2), date(2025, 7, 1)):
        result = value_booked_trade(_swap(), build_curve(_snapshot(val)), fixings)
        stub = _stub(result)
        assert stub.is_known
        assert stub.rate == pytest.approx(0.02, rel=1e-12), f"re-fixed on {val}"


def test_next_period_fixes_one_business_day_before_its_reset():
    """On 2025-07-15, F(R2) = 2025-07-15 has passed: the second period's rate
    is that day's print -- known and immutable -- not a curve forward."""
    fixings = {date(2025, 4, 15): 0.02, date(2025, 7, 15): 0.035}
    result = value_booked_trade(_swap(), build_curve(_snapshot(date(2025, 7, 15))), fixings)
    floats = [c for c in result.cashflows if c.leg == "floating"]
    assert [c.is_known for c in floats] == [True, True]
    assert floats[0].rate == pytest.approx(0.02, rel=1e-12)
    assert floats[1].rate == pytest.approx(0.035, rel=1e-12)


# ── data-quality fallback ────────────────────────────────────────────────────

def test_ffill_on_business_day_fixing_date_is_flagged():
    # F(R1) = 2025-04-15 (a Tuesday) is missing; the Monday print gets
    # substituted, but never silently.
    fixings = {date(2025, 4, 14): 0.02}
    res = select_fixing(fixings, date(2025, 4, 16), date(2025, 7, 1))
    assert res is not None
    assert res.rate == pytest.approx(0.02)
    assert not res.is_exact
    assert res.is_data_quality_event
    assert res.resolved_date == date(2025, 4, 14)


def test_ffill_warning_surfaces_in_portfolio_payload_and_log(caplog):
    fixings = {date(2025, 4, 14): 0.02}
    with caplog.at_level(logging.WARNING, logger="irs_pricer.services.portfolio_service"):
        result = portfolio_service.price_portfolio(
            _snapshot(date(2025, 7, 1)), [("p", _swap())], fixings
        )
    assert len(result.fixing_warnings) == 1
    w = result.fixing_warnings[0]
    assert (w.fixing_date, w.resolved_date) == (date(2025, 4, 15), date(2025, 4, 14))
    assert any("data-quality" in r.message for r in caplog.records)


def test_exact_hit_produces_no_warning():
    fixings = {date(2025, 4, 15): 0.02}
    result = portfolio_service.price_portfolio(
        _snapshot(date(2025, 7, 1)), [("p", _swap())], fixings
    )
    assert result.fixing_warnings == []


def test_dedupe_collapses_repeated_events():
    fixings = {date(2025, 4, 14): 0.02}
    res = select_fixing(fixings, date(2025, 4, 16), date(2025, 7, 1))
    assert dedupe_data_quality_events([res, res, res]) == [res]
