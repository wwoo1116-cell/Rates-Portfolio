from datetime import date

import pytest
import QuantLib as ql

from irs_pricer.core.conventions import BUSINESS_CONVENTION, CALENDAR, DAY_COUNT, FLOAT_LEG_TENOR, to_ql_date
from irs_pricer.engine.curve import build_curve
from irs_pricer.engine.context import managed_quantlib_env
from irs_pricer.core.market_data import MarketSnapshot, RateQuote


def _sample_snapshot(valuation_date: date) -> MarketSnapshot:
    return MarketSnapshot(
        valuation_date=valuation_date,
        cd_rate=0.0292,
        swap_quotes=[
            RateQuote(t, r) for t, r in [(1, 0.0280), (2, 0.0270), (3, 0.0265), (5, 0.0260), (10, 0.0257)]
        ],
    )


def test_discount_factor_at_valuation_date_is_one():
    snapshot = _sample_snapshot(date(2026, 6, 29))
    with managed_quantlib_env(to_ql_date(snapshot.valuation_date)):
        curve = build_curve(snapshot)
        assert curve.yield_curve.discount(0.0) == 1.0


def test_discount_factors_decrease_with_maturity():
    snapshot = _sample_snapshot(date(2026, 6, 29))
    with managed_quantlib_env(to_ql_date(snapshot.valuation_date)):
        curve = build_curve(snapshot)
        dfs = [curve.yield_curve.discount(t) for t in (1.0, 2.0, 3.0, 5.0, 10.0)]
        assert all(a >= b for a, b in zip(dfs, dfs[1:]))


def test_zero_rates_are_positive():
    snapshot = _sample_snapshot(date(2026, 6, 29))
    with managed_quantlib_env(to_ql_date(snapshot.valuation_date)):
        curve = build_curve(snapshot)
        for t in (1.0, 2.0, 5.0, 10.0):
            zero_rate = curve.yield_curve.zeroRate(t, ql.Continuous).rate()
            assert zero_rate > 0


def test_par_swap_reprices_to_par_rate_at_knot_tenor():
    """A swap struck at exactly the quoted par rate for a knot tenor must
    reprice to ~par (fair rate == quote) under the (sole, hardcoded) linear
    zero-rate bootstrap."""
    quoted_5y = 0.0260
    snapshot = _sample_snapshot(date(2026, 6, 29))
    with managed_quantlib_env(to_ql_date(snapshot.valuation_date)):
        curve = build_curve(snapshot)

        schedule = ql.Schedule(
            curve.settlement_date,
            CALENDAR.advance(curve.settlement_date, ql.Period(5, ql.Years)),
            FLOAT_LEG_TENOR,
            CALENDAR,
            BUSINESS_CONVENTION,
            BUSINESS_CONVENTION,
            ql.DateGeneration.Backward,
            False,
        )
        swap = ql.VanillaSwap(
            ql.Swap.Payer, 10_000_000, schedule, quoted_5y, DAY_COUNT, schedule, curve.float_index, 0.0, DAY_COUNT
        )
        swap.setPricingEngine(ql.DiscountingSwapEngine(curve.yield_curve_handle))

        assert swap.fairRate() == pytest.approx(quoted_5y, abs=1e-6)
