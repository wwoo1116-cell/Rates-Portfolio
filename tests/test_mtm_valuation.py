from datetime import date

import QuantLib as ql
from dateutil.relativedelta import relativedelta

from irs_pricer.engine import mtm_valuation as mtm
from irs_pricer.core.conventions import (
    BUSINESS_CONVENTION,
    CALENDAR,
    DAY_COUNT,
    FLOAT_LEG_TENOR,
    SPOT_DAYS,
    from_ql_date,
    to_ql_date,
)
from irs_pricer.engine.curve import CurveBundle, build_curve
from irs_pricer.engine.instruments import VanillaSwap
from irs_pricer.core.market_data import MarketSnapshot, RateQuote

_QUOTES = [(1, 0.0280), (2, 0.0270), (3, 0.0265), (5, 0.0260), (7, 0.0258), (10, 0.0257)]


from irs_pricer.engine.context import managed_quantlib_env

def _curve(valuation_date: date) -> CurveBundle:
    snapshot = MarketSnapshot(
        valuation_date=valuation_date,
        cd_rate=0.0292,
        swap_quotes=[RateQuote(t, r) for t, r in _QUOTES],
    )
    return build_curve(snapshot)


def test_valuation_at_trade_date_matches_new_trade_pricing():
    """Requirement 1: valuation_date == trade_date should reproduce QuantLib's
    own engine NPV for an equivalent freshly-built swap (regression test)."""
    valuation_date = date(2026, 6, 29)
    trade_date = valuation_date
    maturity_date = trade_date + relativedelta(years=3)
    notional = 10_000_000
    fixed_rate = 0.0270

    with managed_quantlib_env(to_ql_date(valuation_date)):
        curve = _curve(valuation_date)
        swap = VanillaSwap(
            tenor_years=3,
            notional=notional,
            fixed_rate=fixed_rate,
            pay_fixed=True,
            trade_date=trade_date,
            maturity_date=maturity_date,
        )

        # build_curve() registers exactly one synthetic fixing on curve.float_index
        # (at valuation_date - SPOT_DAYS, value = snapshot.cd_rate) purely so
        # QuantLib's own machinery has a fixing to satisfy IborIndex's history
        # requirement -- not a real historical print. Since trade_date ==
        # valuation_date here, this swap's first reset date lands exactly on
        # that synthetic fixing, so the raw ql_swap built below will silently
        # use it for its first coupon. Pass the same value through `fixings` so
        # both sides price that coupon off the identical rate; otherwise this
        # test would be comparing two different (and both legitimate) floating
        # rate conventions -- forward-curve estimate vs. registered fixing --
        # rather than the schedule/day-count/discounting regression it's meant to check.
        reset_date = from_ql_date(CALENDAR.advance(to_ql_date(trade_date), -SPOT_DAYS, ql.Days))
        result = mtm.value_booked_trade(swap, curve, fixings={reset_date: 0.0292})

        schedule = ql.Schedule(
            to_ql_date(trade_date),
            to_ql_date(maturity_date),
            FLOAT_LEG_TENOR,
            CALENDAR,
            BUSINESS_CONVENTION,
            BUSINESS_CONVENTION,
            ql.DateGeneration.Backward,
            False,
        )
        ql_swap = ql.VanillaSwap(
            ql.Swap.Payer, notional, schedule, fixed_rate, DAY_COUNT, schedule, curve.float_index, 0.0, DAY_COUNT
        )
        ql_swap.setPricingEngine(ql.DiscountingSwapEngine(curve.yield_curve_handle))

        # value_booked_trade() references its PVs to curve.settlement_date (T+1,
        # market MTM convention), while ql_swap's own NPV()/fixedLegNPV()/
        # floatingLegNPV() are referenced to valuation_date (T, QuantLib's
        # evaluation date) -- divide by df(settlement_date) for an apples-to-
        # apples comparison.
        df_settlement = curve.yield_curve_handle.discount(curve.settlement_date)
        assert abs(result.pv_fixed_leg - (-ql_swap.fixedLegNPV() / df_settlement)) < 1.0
        assert abs(result.pv_floating_leg - (ql_swap.floatingLegNPV() / df_settlement)) < 1.0
        assert abs(result.clean_npv - (ql_swap.NPV() / df_settlement)) < 1.0
        # value_booked_trade() references accrued interest to curve.settlement_date
        # (T+1) too, matching standard bond-market practice: a trade struck today,
        # settling T+1, still accrues one day of interest by settlement. So even
        # trade_date == valuation_date shows a small nonzero net accrual -- one
        # day's difference between the float leg's known rate and the fixed rate.
        expected_one_day_accrual = notional * (0.0292 - fixed_rate) * DAY_COUNT.yearFraction(
            to_ql_date(trade_date), curve.settlement_date
        )
        assert abs(result.accrued_interest - expected_one_day_accrual) < 1e-6
        assert abs(result.dirty_npv - (result.clean_npv + result.accrued_interest)) < 1e-9


def test_telescoping_matches_forward_estimation():
    """Requirement 2: for a vanilla (no-spread) floating leg, the telescoping
    shortcut and the per-period forward-rate estimate must agree (the
    telescoping identity is exact, see mtm_valuation._price_floating_telescoped)."""
    trade_date = date(2024, 3, 27)
    maturity_date = trade_date + relativedelta(years=5)
    notional = 10_000_000

    valuation_date = date(2026, 6, 29)
    with managed_quantlib_env(to_ql_date(valuation_date)):
        curve = _curve(valuation_date)
        periods = mtm._build_periods(to_ql_date(trade_date), to_ql_date(maturity_date))
        remaining = [p for p in periods if p.payment_date > curve_valuation_date(curve)]
        rest = remaining[1:]  # exclude the (possibly) already-fixed current period
        assert len(rest) > 1  # need multiple periods for the comparison to be meaningful

        telescoped_pv, _ = mtm._price_floating_telescoped(rest, curve, notional)
        per_period_pv, _ = mtm._price_floating_per_period(rest, curve, notional, 0.0)

        assert abs(telescoped_pv - per_period_pv) < 1e-6


def curve_valuation_date(curve: CurveBundle) -> date:
    from irs_pricer.core.conventions import from_ql_date

    return from_ql_date(curve.valuation_date)


def test_only_case_a_no_remaining_resets():
    """Requirement 3: valuation_date sits at the start of the final accrual
    period and that period's rate is already fixed -- only Case A applies,
    there is no Case B remainder to telescope or estimate."""
    trade_date = date(2025, 6, 27)
    maturity_date = trade_date + relativedelta(years=1)
    periods = mtm._build_periods(to_ql_date(trade_date), to_ql_date(maturity_date))
    last = periods[-1]
    valuation_date = last.accrual_start
    reset_date = mtm._reset_date(last.accrual_start_ql)

    with managed_quantlib_env(to_ql_date(valuation_date)):
        curve = _curve(valuation_date)
        swap = VanillaSwap(
            tenor_years=1,
            notional=10_000_000,
            fixed_rate=0.0270,
            pay_fixed=True,
            trade_date=trade_date,
            maturity_date=maturity_date,
        )
        fixings = {reset_date: 0.0310}

        result = mtm.value_booked_trade(swap, curve, fixings)

        assert result.telescoping_used is False
        floating_details = [c for c in result.cashflows if c.leg == "floating"]
        fixed_details = [c for c in result.cashflows if c.leg == "fixed"]
        assert len(floating_details) == 1
        assert len(fixed_details) == 1
        assert floating_details[0].is_known is True


def test_floating_leg_expands_into_per_period_rows():
    """Part 1: the floating leg must be broken into the same period structure
    as the fixed leg (one row per period) instead of being telescoped into a
    single collapsed row, and the per-period total must still match the
    telescoped total within tolerance (no divergence)."""
    trade_date = date(2024, 3, 27)
    maturity_date = trade_date + relativedelta(years=3)
    notional = 10_000_000
    fixed_rate = 0.0270

    valuation_date = date(2026, 6, 29)
    with managed_quantlib_env(to_ql_date(valuation_date)):
        curve = _curve(valuation_date)
        swap = VanillaSwap(
            tenor_years=3,
            notional=notional,
            fixed_rate=fixed_rate,
            pay_fixed=True,
            trade_date=trade_date,
            maturity_date=maturity_date,
        )

        result = mtm.value_booked_trade(swap, curve, fixings={})

        fixed_details = [c for c in result.cashflows if c.leg == "fixed"]
        floating_details = [c for c in result.cashflows if c.leg == "floating"]

        assert len(floating_details) == len(fixed_details)
        assert len(floating_details) > 1  # would be 1 if still telescoped
        assert all(c.rate is not None for c in floating_details)
        assert result.telescoping_used is True
        assert result.telescoping_diverged is False


def test_single_remaining_cashflow_near_maturity():
    """Requirement 4: valuation_date just before maturity_date leaves a single
    remaining cash flow whose rate is NOT yet fixed -- it must still go through
    Case B (telescoping degenerates correctly to one period)."""
    trade_date = date(2025, 6, 27)
    maturity_date = trade_date + relativedelta(years=1)
    periods = mtm._build_periods(to_ql_date(trade_date), to_ql_date(maturity_date))
    last = periods[-1]
    valuation_date = last.accrual_start

    with managed_quantlib_env(to_ql_date(valuation_date)):
        curve = _curve(valuation_date)
        swap = VanillaSwap(
            tenor_years=1,
            notional=10_000_000,
            fixed_rate=0.0270,
            pay_fixed=True,
            trade_date=trade_date,
            maturity_date=maturity_date,
        )

        result = mtm.value_booked_trade(swap, curve, fixings={})

        assert result.telescoping_used is True
        floating_details = [c for c in result.cashflows if c.leg == "floating"]
        assert len(floating_details) == 1
        assert floating_details[0].is_known is False
