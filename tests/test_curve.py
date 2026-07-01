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


def test_default_interpolation_method_is_flat():
    """Regression check for the interpolation_method refactor: build_curve()
    with no explicit method must behave identically to build_curve(..., "flat"),
    which is the pre-refactor (hardcoded PiecewiseLogLinearDiscount) behavior."""
    snapshot = _sample_snapshot(date(2026, 6, 29))
    with managed_quantlib_env(to_ql_date(snapshot.valuation_date)):
        default_curve = build_curve(snapshot)
        flat_curve = build_curve(snapshot, interpolation_method="flat")
        for t in (0.5, 1.0, 2.0, 3.0, 4.0, 5.0, 7.0, 10.0):
            assert default_curve.yield_curve.discount(t) == flat_curve.yield_curve.discount(t)
            assert default_curve.yield_curve.zeroRate(t, ql.Continuous).rate() == pytest.approx(
                flat_curve.yield_curve.zeroRate(t, ql.Continuous).rate()
            )


@pytest.mark.parametrize("method", ["flat", "linear", "cubic"])
def test_all_interpolation_methods_reprice_quoted_par_rate(method):
    """All three modes bootstrap from the same knot points, so a swap struck
    at exactly the quoted par rate for a knot tenor must reprice to ~par
    (fair rate == quote) regardless of interpolation method."""
    quoted_5y = 0.0260
    snapshot = _sample_snapshot(date(2026, 6, 29))
    with managed_quantlib_env(to_ql_date(snapshot.valuation_date)):
        curve = build_curve(snapshot, interpolation_method=method)

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


def test_interpolation_methods_diverge_between_knots():
    """At an off-knot tenor (between the 3Y and 5Y quotes), flat/linear/cubic
    must not all agree -- otherwise the interpolation_method parameter isn't
    actually doing anything."""
    snapshot = _sample_snapshot(date(2026, 6, 29))
    with managed_quantlib_env(to_ql_date(snapshot.valuation_date)):
        zero_rates = {
            method: build_curve(snapshot, interpolation_method=method).yield_curve.zeroRate(4.0, ql.Continuous).rate()
            for method in ("flat", "linear", "cubic")
        }
    assert len({round(r, 8) for r in zero_rates.values()}) > 1


def test_invalid_interpolation_method_raises():
    with pytest.raises(ValueError):
        snapshot = _sample_snapshot(date(2026, 6, 29))
        with managed_quantlib_env(to_ql_date(snapshot.valuation_date)):
            build_curve(snapshot, interpolation_method="bogus")
