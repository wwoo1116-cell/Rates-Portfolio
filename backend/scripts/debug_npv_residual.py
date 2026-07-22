"""Standalone diagnostic: root-cause an NPV residual on a par-rate swap.

Run directly (no FastAPI, no pytest needed):

    PYTHONPATH=. python scripts/debug_npv_residual.py

Reported symptom: pricing a forward-starting 1Y swap at its displayed "Par
Rate" should give NPV ~ 0, but doesn't.

This script isolates which of four candidate causes explains it:
  0) Known fixings -- does the "par" hint account for a real historical
     CD91D fixing that /api/portfolio/price actually uses for the first
     floating period? (Omitting this was, in practice, THE dominant cause
     here -- see the printed numbers below; it is not one of the three
     causes originally suspected, but a standalone repro will silently hide
     it unless you load real fixings, so it is checked first.)
  1) Rate precision -- the UI only shows/accepts 4 decimal places.
  2) Cashflow date mismatch -- fixed/floating leg schedules disagree on an
     accrual or payment date (holiday/Modified-Following handling).
  3) Curve interpolation -- discounting and forward-projection use different
     curves or interpolation methods.

Each check prints its own evidence; read the printed numbers, don't just
trust the final verdict line.
"""
from __future__ import annotations

from datetime import date

import QuantLib as ql

from irs_pricer.core.conventions import (
    BUSINESS_CONVENTION,
    CALENDAR,
    DAY_COUNT,
    FLOAT_LEG_TENOR,
    SPOT_DAYS,
    from_ql_date,
    to_ql_date,
)
from irs_pricer.core.market_data import MarketSnapshot, RateQuote
from irs_pricer.engine.context import managed_quantlib_env
from irs_pricer.engine.curve import build_curve
from irs_pricer.engine.instruments import VanillaSwap
from irs_pricer.engine.mtm_valuation import _build_periods, value_booked_trade
from irs_pricer.services.market_data_service import load_fixings

# ─── Test context (edit these to match whatever scenario you're chasing) ───
VALUATION_DATE = date(2026, 7, 2)
START_DATE = date(2026, 7, 2)       # forward-starting: START_DATE >= VALUATION_DATE
MATURITY_DATE = date(2027, 7, 2)    # 1Y from START_DATE, already business-day-adjusted
                                     # (confirm via GET /api/calendar/tenor-date?start_date=...&months=12)

# NOTE: the reported notional was inconsistent between "2,618,900,000,000"
# (given explicitly) and "2.9조" (~2,900,000,000,000, implied by an earlier
# 0.53bp / 153M KRW residual: 153e6 / 0.53bp = ~2.89e12). Using the explicit
# figure below -- swap in 2_900_000_000_000 if that's the real one; the
# diagnosis below doesn't depend on which (the residual sources are the same
# either way, only the absolute KRW figures scale).
NOTIONAL = 2_618_900_000_000
UI_ROUNDED_FIXED_RATE = 0.036966  # 3.6966% -- the 4-decimal value actually typed into 고정금리
                                   # (the corrected hint, after fixing the fixings-omission bug)

CD_RATE = 0.0317
SWAP_QUOTES = [
    (1, 0.037000000000000005), (2, 0.038849999999999996), (3, 0.0393),
    (4, 0.039599999999999996), (5, 0.03975), (6, 0.03995), (7, 0.0401),
    (8, 0.04019999999999999), (9, 0.04025), (10, 0.0403),
]  # real quotes as-of 2026-07-02 (GET /api/market-data/2026-07-02)


def build_snapshot() -> MarketSnapshot:
    return MarketSnapshot(
        valuation_date=VALUATION_DATE,
        cd_rate=CD_RATE,
        swap_quotes=[RateQuote(t, r) for t, r in SWAP_QUOTES],
    )


# The real /api/portfolio/price endpoint calls market_data_service.load_fixings()
# and passes real historical CD91D fixings into value_booked_trade() -- NOT an
# empty dict. Any standalone repro that skips this will get a different NPV
# than production for any position whose first reset date already has a
# historical print (i.e. almost any position with start_date at/near today).
FIXINGS = load_fixings()


def section(title: str) -> None:
    print("\n" + "=" * 78)
    print(title)
    print("=" * 78)


def reset_date_for(start_date: date) -> date:
    return from_ql_date(CALENDAR.advance(to_ql_date(start_date), -SPOT_DAYS, ql.Days))


def npv_at_fixed_rate(fixed_rate: float, fixings: dict[date, float]) -> float:
    """clean_npv via the actual portfolio-pricing code path (value_booked_trade)."""
    swap = VanillaSwap(
        tenor_years=0,  # unused: maturity_date overrides it, matches how portfolio positions are priced
        notional=NOTIONAL,
        fixed_rate=fixed_rate,
        pay_fixed=True,
        trade_date=START_DATE,
        maturity_date=MATURITY_DATE,
    )
    with managed_quantlib_env(to_ql_date(VALUATION_DATE)):
        curve = build_curve(build_snapshot())
        return value_booked_trade(swap, curve, fixings).clean_npv


def check_0_known_fixings() -> None:
    section("0) KNOWN FIXINGS -- does the 'par' hint see the same historical fixing /price uses?")

    reset_date = reset_date_for(START_DATE)
    real_fixing = FIXINGS.get(reset_date)
    print(f"  First floating period's reset date (start_date - {SPOT_DAYS}bd) = {reset_date}")
    print(f"  Real historical fixing on that date (load_fixings())            = {real_fixing}")

    if real_fixing is None:
        print("  No historical fixing for this date -- this cause does not apply to this scenario.")
        return

    npv_without_fixings = npv_at_fixed_rate(UI_ROUNDED_FIXED_RATE, fixings={})
    npv_with_fixings = npv_at_fixed_rate(UI_ROUNDED_FIXED_RATE, fixings=FIXINGS)
    print(f"\n  NPV @ {UI_ROUNDED_FIXED_RATE} computed WITHOUT fixings (wrong -- forward-estimates that period) : {npv_without_fixings:>18,.2f} KRW")
    print(f"  NPV @ {UI_ROUNDED_FIXED_RATE} computed WITH real fixings (matches /api/portfolio/price)         : {npv_with_fixings:>18,.2f} KRW")
    print(f"  Difference caused solely by the fixings omission                                              : {npv_without_fixings - npv_with_fixings:>18,.2f} KRW")
    print("\n  If you are computing a 'par rate' hint standalone (or in a new endpoint) and it does not")
    print("  pass real fixings through, it will NOT be the rate that zeros /api/portfolio/price's NPV.")


def check_1_rate_precision() -> None:
    section("1) RATE PRECISION -- does 4-decimal UI rounding explain the *remaining* residual?")

    reset_date = reset_date_for(START_DATE)
    real_fixing = FIXINGS.get(reset_date)

    with managed_quantlib_env(to_ql_date(VALUATION_DATE)):
        curve = build_curve(build_snapshot())
        if real_fixing is not None:
            # Seed the SAME real fixing value_booked_trade() will use (curve.py's
            # build_curve() only auto-seeds a synthetic fixing derived from
            # cd_rate, which is a different number -- see check_0 above).
            curve.float_index.addFixing(to_ql_date(reset_date), real_fixing, forceOverwrite=True)
        schedule = ql.Schedule(
            to_ql_date(START_DATE), to_ql_date(MATURITY_DATE), FLOAT_LEG_TENOR,
            CALENDAR, BUSINESS_CONVENTION, BUSINESS_CONVENTION, ql.DateGeneration.Backward, False,
        )
        ql_swap = ql.VanillaSwap(
            ql.Swap.Payer, NOTIONAL, schedule, 0.0, DAY_COUNT, schedule, curve.float_index, 0.0, DAY_COUNT,
        )
        ql_swap.setPricingEngine(ql.DiscountingSwapEngine(curve.yield_curve_handle))
        true_fair_rate = ql_swap.fairRate()

    print(f"  QuantLib swap.fairRate() (real fixing seeded) : {true_fair_rate:.10f}  ({true_fair_rate*100:.6f}%)")
    print(f"  UI-rounded rate actually typed in              : {UI_ROUNDED_FIXED_RATE:.10f}  ({UI_ROUNDED_FIXED_RATE*100:.6f}%)")
    print(f"  Rate difference                                : {(UI_ROUNDED_FIXED_RATE - true_fair_rate)*10000:.4f} bp")

    npv_rounded = npv_at_fixed_rate(UI_ROUNDED_FIXED_RATE, fixings=FIXINGS)
    npv_exact = npv_at_fixed_rate(true_fair_rate, fixings=FIXINGS)
    print(f"\n  NPV @ UI-rounded rate ({UI_ROUNDED_FIXED_RATE}) : {npv_rounded:>18,.2f} KRW")
    print(f"  NPV @ QuantLib fairRate()             : {npv_exact:>18,.2f} KRW  (should be ~0)")
    print(f"  Residual explained by rounding alone  : {npv_rounded - npv_exact:>18,.2f} KRW")
    print(f"  Residual as % of notional (rounded)   : {npv_rounded / NOTIONAL * 100:.5f}%")
    print(f"  Residual as % of notional (fairRate)  : {npv_exact / NOTIONAL * 100:.5f}%  (near-zero -> confirms rounding explains the rest)")


def check_2_cashflow_dates() -> None:
    section("2) CASHFLOW DATES -- do fixed/floating leg schedules line up exactly?")

    periods = _build_periods(to_ql_date(START_DATE), to_ql_date(MATURITY_DATE))
    print("  (both legs are priced off this SAME period list -- see mtm_valuation._build_periods --")
    print("   so fixed/floating cannot independently drift; this is the schedule both legs share)\n")
    print(f"  {'#':<3}{'accrual_start':<14}{'accrual_end':<14}{'payment_date':<14}{'dcf(Act/365F)':<14}")
    for i, p in enumerate(periods):
        dcf = DAY_COUNT.yearFraction(p.accrual_start_ql, p.accrual_end_ql)
        print(f"  {i:<3}{p.accrual_start!s:<14}{p.accrual_end!s:<14}{p.payment_date!s:<14}{dcf:<14.6f}")

    violations = [p for p in periods if not CALENDAR.isBusinessDay(p.accrual_end_ql)]
    if violations:
        print("\n  !! Business-day convention violated on:")
        for p in violations:
            print(f"     {p.accrual_end}")
    else:
        print("\n  All accrual-end/payment dates are valid KRX business days -- no convention violation found.")


def check_3_discount_factors() -> None:
    section("3) DISCOUNT FACTORS -- same curve/interpolation for discounting and projection?")

    with managed_quantlib_env(to_ql_date(VALUATION_DATE)):
        curve = build_curve(build_snapshot())
        df_start = curve.yield_curve_handle.discount(to_ql_date(START_DATE))
        df_maturity = curve.yield_curve_handle.discount(to_ql_date(MATURITY_DATE))
        # curve.float_index is curve.py's float_index.clone(yield_curve_handle) --
        # confirm its forwarding handle actually resolves to the SAME numbers as
        # the discount handle (a real identity check, not just "should be equal").
        forwarding_handle = curve.float_index.forwardingTermStructure()
        sample_ql_date = to_ql_date(MATURITY_DATE)
        df_discount_side = curve.yield_curve_handle.discount(sample_ql_date)
        df_forward_side = forwarding_handle.discount(sample_ql_date)

    print(f"  DF(valuation_date -> start_date={START_DATE})    = {df_start:.10f}")
    print(f"  DF(valuation_date -> maturity_date={MATURITY_DATE}) = {df_maturity:.10f}")
    print(f"  Curve class (both discounting & projection)   : {type(curve.yield_curve).__name__}")
    print("  (engine/curve.py builds ql.PiecewiseLinearZero once and reuses the SAME handle for both)")
    print(f"\n  DF at maturity via discount curve                     : {df_discount_side:.12f}")
    print(f"  DF at maturity via float_index's own forwarding curve : {df_forward_side:.12f}")
    print(f"  Identical: {df_discount_side == df_forward_side}  (must be True -- single-curve market, no discount/forward split)")


if __name__ == "__main__":
    check_0_known_fixings()
    check_1_rate_precision()
    check_2_cashflow_dates()
    check_3_discount_factors()
