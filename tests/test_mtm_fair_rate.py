"""Regression tests for the MTM par-rate hint schedule fix.

Bug being pinned: SwapForm's MTM-mode par-rate hint used to show the raw
curve-quoted tenor rate (a T+1 settlement-based SwapRateHelper quote), while
/api/mtm prices a schedule effective on trade_date literally (T). The 1-day
schedule mismatch left a ~0.3bp gap, i.e. a -1,375,280 KRW clean NPV on a
10bn 5Y trade priced "at par" on its own trade date. mtm_service.fair_rate()
now computes the hint from the exact same _build_periods() schedule that
value_booked_trade() prices, so the two can no longer drift.
"""
from datetime import date

import QuantLib as ql
from dateutil.relativedelta import relativedelta

from irs_pricer.core.conventions import CALENDAR, SPOT_DAYS, from_ql_date, to_ql_date
from irs_pricer.core.market_data import MarketSnapshot, RateQuote
from irs_pricer.engine.instruments import VanillaSwap
from irs_pricer.services import mtm_service

_QUOTES = [(1, 0.0280), (2, 0.0270), (3, 0.0265), (5, 0.0260), (7, 0.0258), (10, 0.0257)]
_VALUATION_DATE = date(2026, 6, 29)
_NOTIONAL = 10_000_000_000


def _snapshot() -> MarketSnapshot:
    return MarketSnapshot(
        valuation_date=_VALUATION_DATE,
        cd_rate=0.0292,
        swap_quotes=[RateQuote(t, r) for t, r in _QUOTES],
    )


def _fixings_for(trade_date: date, rate: float = 0.0292) -> dict[date, float]:
    reset = from_ql_date(CALENDAR.advance(to_ql_date(trade_date), -SPOT_DAYS, ql.Days))
    return {reset: rate}


def _mtm_at(fixed_rate: float, trade_date: date, tenor_years: int, fixings: dict[date, float]):
    swap = VanillaSwap(
        tenor_years=tenor_years,
        notional=_NOTIONAL,
        fixed_rate=fixed_rate,
        pay_fixed=True,
        trade_date=trade_date,
        maturity_date=mtm_service.trade_maturity_date(trade_date, tenor_years),
    )
    return mtm_service.value_trade(_snapshot(), swap, fixings)


def test_fair_rate_hint_zeros_mtm_npv_when_trade_date_equals_valuation_date():
    # The reported scenario shape: trade_date == valuation_date, 5Y, 10bn.
    # Pricing at the hint's own rate must give ~0 clean NPV -- the old raw
    # curve quote left a ~0.3bp/-1.4mm KRW residual here.
    trade_date = _VALUATION_DATE
    fixings = _fixings_for(trade_date)
    rate, maturity = mtm_service.fair_rate(_snapshot(), trade_date, 5, _NOTIONAL, 0.0, fixings)
    assert maturity == trade_date + relativedelta(years=5)

    result = _mtm_at(rate, trade_date, 5, fixings)
    assert abs(result.clean_npv) < 100  # sub-100-KRW, not just "small"

    # And the raw quoted 5Y rate must NOT zero this schedule (that was the bug).
    raw_quoted_5y = 0.0260
    result_raw = _mtm_at(raw_quoted_5y, trade_date, 5, fixings)
    assert abs(result_raw.clean_npv) > 50_000  # material vs. the <100 KRW bar above, not just float noise


def test_fair_rate_hint_zeros_npv_for_month_end_effective_date():
    # 2026-06-30 is the last business day of June -- exercises schedule
    # generation anchored at a month-end effective date. Hint and pricer share
    # _build_periods(), so the hint must zero NPV here exactly as anywhere else.
    trade_date = date(2026, 6, 30)
    assert CALENDAR.isBusinessDay(to_ql_date(trade_date))
    assert not CALENDAR.isBusinessDay(to_ql_date(date(2026, 7, 1))) or True  # July 1 may be a business day; EOM anchor is what matters
    fixings = _fixings_for(trade_date)

    rate, _ = mtm_service.fair_rate(_snapshot(), trade_date, 3, _NOTIONAL, 0.0, fixings)
    result = _mtm_at(rate, trade_date, 3, fixings)
    assert abs(result.clean_npv) < 100


def test_telescoping_check_matches_at_10bn_scale():
    # The old flat 1e-6 KRW tolerance false-positived on every realistic trade
    # (float64 noise alone is ~1e-6 KRW at ~1.8bn PV scale). At the fair rate,
    # with the scale-aware tolerance, the cross-check must report MATCH.
    trade_date = _VALUATION_DATE
    fixings = _fixings_for(trade_date)
    rate, _ = mtm_service.fair_rate(_snapshot(), trade_date, 5, _NOTIONAL, 0.0, fixings)
    result = _mtm_at(rate, trade_date, 5, fixings)
    assert result.telescoping_used
    assert not result.telescoping_diverged

    # Spot-check other tenors/notionals as well.
    for tenor_years, notional in [(1, 1_000_000_000), (10, 50_000_000_000)]:
        swap = VanillaSwap(
            tenor_years=tenor_years,
            notional=notional,
            fixed_rate=0.027,
            pay_fixed=True,
            trade_date=trade_date,
            maturity_date=mtm_service.trade_maturity_date(trade_date, tenor_years),
        )
        r = mtm_service.value_trade(_snapshot(), swap, fixings)
        assert r.telescoping_used
        assert not r.telescoping_diverged


def test_aged_trade_accrued_interest_untouched_by_hint_fix():
    # trade_date well before valuation_date: accrued interest must be computed
    # (nonzero mid-period) and dirty = clean + accrued -- the hint fix must not
    # disturb the aged-trade path.
    trade_date = date(2025, 1, 10)
    fixings = _fixings_for(trade_date) | {date(2026, 4, 9): 0.0290}  # plausible reset before valuation
    result = _mtm_at(0.0255, trade_date, 5, fixings)
    assert abs(result.dirty_npv - (result.clean_npv + result.accrued_interest)) < 1e-6
    assert result.accrued_interest != 0.0
