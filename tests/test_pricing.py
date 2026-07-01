from datetime import date

from irs_pricer.engine.curve import CurveBundle, build_curve
from irs_pricer.engine.instruments import VanillaSwap
from irs_pricer.core.market_data import MarketSnapshot, RateQuote
from irs_pricer.engine.pricing import price_swap
from irs_pricer.engine.risk import dv01


def _curve() -> CurveBundle:
    snapshot = MarketSnapshot(
        valuation_date=date(2026, 6, 29),
        cd_rate=0.0292,
        swap_quotes=[
            RateQuote(t, r) for t, r in [(1, 0.0280), (2, 0.0270), (3, 0.0265), (5, 0.0260), (10, 0.0257)]
        ],
    )
    return build_curve(snapshot)


def test_swap_at_par_rate_has_zero_npv():
    curve = _curve()
    swap = VanillaSwap(tenor_years=5, notional=10_000_000, fixed_rate=0.04)
    par_rate = price_swap(swap, curve)["par_rate"]

    swap_at_par = VanillaSwap(tenor_years=5, notional=10_000_000, fixed_rate=par_rate)
    assert abs(price_swap(swap_at_par, curve)["npv"]) < 1e-2


def test_paying_above_par_rate_gives_negative_npv_to_payer():
    curve = _curve()
    swap = VanillaSwap(tenor_years=5, notional=10_000_000, fixed_rate=0.04)
    par_rate = price_swap(swap, curve)["par_rate"]

    swap_above_par = VanillaSwap(tenor_years=5, notional=10_000_000, fixed_rate=par_rate + 0.01)
    assert price_swap(swap_above_par, curve)["npv"] < 0


def test_dv01_is_positive():
    curve = _curve()
    swap = VanillaSwap(tenor_years=5, notional=10_000_000, fixed_rate=0.04)
    assert dv01(swap, curve) > 0
