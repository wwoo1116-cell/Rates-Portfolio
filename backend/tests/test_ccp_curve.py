"""tenor_months support (sub-year / fractional CCP curve points), QuantLib-free.

CCP Data mode lets a user hand-type a full curve including tenors shorter than
a year (6M/9M) and non-integer years (1.5Y), which RateQuote.tenor_years:int
alone can't represent. tenor_months is additive: when set it's the period used
for bootstrapping (build_curve uses tenor_months/12 as the node's year
fraction); tenor_years stays a rounded nominal value so whole-year call sites
are untouched.
"""
from datetime import date

from fastapi.testclient import TestClient

from irs_pricer.api.app import app
from irs_pricer.core.market_data import MarketSnapshot, RateQuote
from irs_pricer.engine.curve import build_curve
from irs_pricer.engine.instruments import VanillaSwap
from irs_pricer.engine.quant_engine import df_linear_rate
from irs_pricer.services import portfolio_service

client = TestClient(app)

_VALUATION_DATE = date(2026, 6, 29)


def _ccp_snapshot() -> MarketSnapshot:
    quotes = [
        RateQuote(tenor_years=1, rate=0.0300, tenor_months=6),   # 6M
        RateQuote(tenor_years=1, rate=0.0310, tenor_months=9),   # 9M
        RateQuote(tenor_years=1, rate=0.0320),                    # 1Y (falls back to tenor_years)
        RateQuote(tenor_years=2, rate=0.0325, tenor_months=18),  # 1.5Y
        RateQuote(tenor_years=2, rate=0.0330),                    # 2Y
        RateQuote(tenor_years=5, rate=0.0340),
        RateQuote(tenor_years=10, rate=0.0350),
    ]
    return MarketSnapshot(valuation_date=_VALUATION_DATE, cd_rate=0.0290, swap_quotes=quotes)


def test_build_curve_bootstraps_with_sub_year_tenor_months():
    # DFs must be monotonically decreasing across the whole curve, including the
    # sub-year (6M/9M) and fractional (1.5Y) knots -- proof they were consumed
    # as real pillars, not silently ignored or misplaced.
    curve = build_curve(_ccp_snapshot())
    years = [3 / 12, 6 / 12, 9 / 12, 1.0, 1.5, 2.0, 5.0, 10.0]
    dfs = [df_linear_rate(t, curve.yield_curve) for t in years]
    assert dfs == sorted(dfs, reverse=True)
    assert all(0.0 < d <= 1.0 for d in dfs)


def test_tenor_months_falls_back_to_tenor_years_when_unset():
    # A quote with no tenor_months behaves exactly as tenor_months=12 (the
    # existing True Data whole-year code path).
    snap_a = MarketSnapshot(valuation_date=_VALUATION_DATE, cd_rate=0.029,
                            swap_quotes=[RateQuote(tenor_years=1, rate=0.03, tenor_months=12)])
    snap_b = MarketSnapshot(valuation_date=_VALUATION_DATE, cd_rate=0.029,
                            swap_quotes=[RateQuote(tenor_years=1, rate=0.03)])
    df_a = df_linear_rate(1.0, build_curve(snap_a).yield_curve)
    df_b = df_linear_rate(1.0, build_curve(snap_b).yield_curve)
    assert abs(df_a - df_b) < 1e-12


def test_position_fair_rate_zeros_npv_against_ccp_style_curve():
    # A brand-new spot-starting position priced off a CCP-style mixed
    # tenor_months/tenor_years curve satisfies the same NPV=0 guarantee.
    snapshot = _ccp_snapshot()
    notional = 10_000_000_000
    rate = portfolio_service.position_fair_rate(snapshot, _VALUATION_DATE, date(2028, 6, 29), notional)
    swap = VanillaSwap(tenor_years=0, notional=notional, fixed_rate=rate, pay_fixed=True,
                       trade_date=_VALUATION_DATE, maturity_date=date(2028, 6, 29))
    result = portfolio_service.price_portfolio(snapshot, [("p", swap)], fixings={})
    assert abs(result.net_npv) < notional * 1e-5


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
    fair = resp.json()["fair_rate"]
    assert isinstance(fair, float) and 0.0 < fair < 0.10  # a real par rate, not the old 0.0 bug
