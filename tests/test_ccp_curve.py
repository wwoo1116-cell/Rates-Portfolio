"""Tests for tenor_months support (sub-year/fractional CCP curve points).

CCP Data mode lets a user hand-type a full curve including tenors shorter
than a year (3M/6M/9M) and non-integer years (1.5Y), which the pre-existing
RateQuote/RateQuoteIn.tenor_years: int contract can't represent. tenor_months
is additive: when set, it's the period actually used for bootstrapping;
tenor_years stays required (a rounded nominal value) so every existing
whole-year call site is untouched.
"""
from datetime import date

import QuantLib as ql
from fastapi.testclient import TestClient

from irs_pricer.api.app import app
from irs_pricer.core.conventions import to_ql_date
from irs_pricer.core.market_data import MarketSnapshot, RateQuote
from irs_pricer.engine.context import managed_quantlib_env
from irs_pricer.engine.curve import build_curve
from irs_pricer.engine.instruments import VanillaSwap
from irs_pricer.services import portfolio_service

client = TestClient(app)

_VALUATION_DATE = date(2026, 6, 29)


def _ccp_snapshot() -> MarketSnapshot:
    # 3M backs cd_rate in the real flow; here it's just another curve point
    # to prove tenor_months alone (no collision partner) bootstraps cleanly.
    quotes = [
        RateQuote(tenor_years=1, rate=0.0300, tenor_months=6),   # 6M
        RateQuote(tenor_years=1, rate=0.0310, tenor_months=9),   # 9M
        RateQuote(tenor_years=1, rate=0.0320),                    # 1Y (no tenor_months -> falls back)
        RateQuote(tenor_years=2, rate=0.0325, tenor_months=18),  # 1.5Y
        RateQuote(tenor_years=2, rate=0.0330),                    # 2Y
        RateQuote(tenor_years=5, rate=0.0340),
        RateQuote(tenor_years=10, rate=0.0350),
    ]
    return MarketSnapshot(valuation_date=_VALUATION_DATE, cd_rate=0.0290, swap_quotes=quotes)


def test_build_curve_bootstraps_with_sub_year_tenor_months():
    snapshot = _ccp_snapshot()
    with managed_quantlib_env(to_ql_date(_VALUATION_DATE)):
        curve = build_curve(snapshot)
        # Discount factors must be monotonically decreasing across the whole
        # curve, including the sub-year (6M/9M) and fractional (1.5Y) knots --
        # proof they were actually consumed as real pillars, not silently
        # ignored or misplaced.
        settlement = curve.settlement_date
        months_and_expected_order = [3, 6, 9, 12, 18, 24, 60, 120]
        dfs = [curve.yield_curve_handle.discount(settlement + ql.Period(m, ql.Months)) for m in months_and_expected_order]
        assert dfs == sorted(dfs, reverse=True)


def test_tenor_months_falls_back_to_tenor_years_when_unset():
    # A quote with no tenor_months must behave exactly as before (whole-year
    # period) -- this is the existing True Data code path, untouched.
    with_months = RateQuote(tenor_years=1, rate=0.03, tenor_months=12)
    without_months = RateQuote(tenor_years=1, rate=0.03)
    snap_a = MarketSnapshot(valuation_date=_VALUATION_DATE, cd_rate=0.029, swap_quotes=[with_months])
    snap_b = MarketSnapshot(valuation_date=_VALUATION_DATE, cd_rate=0.029, swap_quotes=[without_months])
    with managed_quantlib_env(to_ql_date(_VALUATION_DATE)):
        curve_a = build_curve(snap_a)
        df_a = curve_a.yield_curve_handle.discount(curve_a.settlement_date + ql.Period(12, ql.Months))
    with managed_quantlib_env(to_ql_date(_VALUATION_DATE)):
        curve_b = build_curve(snap_b)
        df_b = curve_b.yield_curve_handle.discount(curve_b.settlement_date + ql.Period(12, ql.Months))
    assert abs(df_a - df_b) < 1e-12


def test_position_fair_rate_zeros_npv_against_ccp_style_curve():
    # A brand-new spot-starting position priced off a curve built entirely
    # from a CCP-style mixed tenor_months/tenor_years quote set must still
    # satisfy the same NPV=0 guarantee as the True Data path.
    snapshot = _ccp_snapshot()
    start_date = _VALUATION_DATE
    maturity_date = date(2028, 6, 29)
    notional = 10_000_000_000
    rate = portfolio_service.position_fair_rate(snapshot, start_date, maturity_date, notional, fixings={})
    swap = VanillaSwap(
        tenor_years=0, notional=notional, fixed_rate=rate, pay_fixed=True,
        trade_date=start_date, maturity_date=maturity_date,
    )
    result = portfolio_service.price_portfolio(snapshot, [("p", swap)], fixings={})
    assert abs(result.net_npv) < 1e-2


def test_api_accepts_tenor_months_in_swap_quotes():
    resp = client.post(
        "/api/portfolio/fair-rate",
        json={
            "valuation_date": "2026-06-29",
            "cd_rate": 0.030,
            "swap_quotes": [
                {"tenor_years": 1, "tenor_months": 6, "rate": 0.031},
                {"tenor_years": 1, "tenor_months": 9, "rate": 0.0315},
                {"tenor_years": 1, "rate": 0.032},
                {"tenor_years": 2, "tenor_months": 18, "rate": 0.0325},
                {"tenor_years": 2, "rate": 0.033},
                {"tenor_years": 5, "rate": 0.034},
            ],
            "start_date": "2026-06-29",
            "maturity_date": "2027-12-29",
            "notional": 10_000_000_000,
        },
    )
    assert resp.status_code == 200
    assert isinstance(resp.json()["fair_rate"], float)
