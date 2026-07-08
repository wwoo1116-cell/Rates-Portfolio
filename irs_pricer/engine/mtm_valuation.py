"""
Mark-to-market valuation of a historically booked VanillaSwap (trade_date < valuation_date).

Unlike pricing.price_swap() -- which hands the whole instrument to QuantLib's
DiscountingSwapEngine and reads back NPV()/fixedLegNPV()/floatingLegNPV() as
opaque totals -- this module walks the original cash-flow schedule explicitly,
period by period, so that clean/dirty NPV, accrued interest, and the
telescoping-vs-forward-estimation choice are all visible as separate, inspectable
outputs.

Single-curve assumption: this market (KRW CD91D-vs-CD91D) has one bootstrapped
curve used for both discounting and floating-rate projection (see curve.py).
`discount_curve` and `projection_curve` are therefore the same CurveBundle --
both names are accepted by value_booked_trade() as a single `curve` argument
so the call site reads the same as a true multi-curve setup would, without
implying a discount/projection split that doesn't exist in this codebase yet.
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass
from datetime import date

import QuantLib as ql

from ..core.conventions import (
    BUSINESS_CONVENTION,
    CALENDAR,
    DAY_COUNT,
    FLOAT_LEG_TENOR,
    SPOT_DAYS,
    from_ql_date,
    to_ql_date,
)
from .curve import CurveBundle
from .instruments import VanillaSwap


@dataclass
class CashFlowDetail:
    accrual_start: date
    accrual_end: date
    payment_date: date
    leg: str  # "fixed" | "floating"
    rate: float | None  # known fixing or forward estimate; None for a telescoped block
    is_known: bool  # True = already fixed (Case A); False = estimated/telescoped
    cashflow: float | None  # None for a telescoped block (no single period cashflow)
    pv: float


@dataclass
class MTMResult:
    clean_npv: float
    dirty_npv: float
    accrued_interest: float
    pv_fixed_leg: float
    pv_floating_leg: float
    telescoping_used: bool
    telescoping_diverged: bool
    cashflows: list[CashFlowDetail]


@dataclass
class _Period:
    accrual_start_ql: ql.Date
    accrual_end_ql: ql.Date
    payment_date_ql: ql.Date
    accrual_start: date
    accrual_end: date
    payment_date: date


def _build_periods(trade_date_ql: ql.Date, maturity_date_ql: ql.Date) -> list[_Period]:
    """Original (contractual) accrual/payment schedule, anchored at trade_date.

    trade_date is treated as the schedule's effective date directly -- if your
    booking convention adds a separate settlement lag between trade_date and
    the swap's actual effective date, pass that effective date in as trade_date.
    """
    schedule = ql.Schedule(
        trade_date_ql,
        maturity_date_ql,
        FLOAT_LEG_TENOR,
        CALENDAR,
        BUSINESS_CONVENTION,
        BUSINESS_CONVENTION,
        ql.DateGeneration.Backward,
        False,
    )
    dates = list(schedule)
    periods = []
    for i in range(len(dates) - 1):
        a, b = dates[i], dates[i + 1]
        periods.append(_Period(a, b, b, from_ql_date(a), from_ql_date(b), from_ql_date(b)))
    return periods


def _reset_date(accrual_start_ql: ql.Date) -> date:
    """Fixing/reset date for a period, mirroring curve.py's fixing-lag convention."""
    return from_ql_date(CALENDAR.advance(accrual_start_ql, -SPOT_DAYS, ql.Days))


def _price_fixed_leg(remaining: list[_Period], curve: CurveBundle, notional: float, fixed_rate: float):
    df = curve.yield_curve_handle.discount
    pv = 0.0
    details: list[CashFlowDetail] = []
    for p in remaining:
        dcf = DAY_COUNT.yearFraction(p.accrual_start_ql, p.accrual_end_ql)
        cf = notional * fixed_rate * dcf
        cf_pv = cf * df(p.payment_date_ql)
        pv += cf_pv
        details.append(CashFlowDetail(p.accrual_start, p.accrual_end, p.payment_date, "fixed", fixed_rate, True, cf, cf_pv))
    return pv, details


def forward_rate(curve: CurveBundle, d1: ql.Date, d2: ql.Date) -> float:
    """Implied forward rate from the curve over [d1, d2].

    If d1 is before the curve's reference date (e.g. an in-progress coupon whose
    reset date has already passed but no historical fixing is available), d1 is
    clamped to the reference date.  The approximation: treat the unobserved fixing
    as today's forward rate over the remaining sub-period [ref, d2].
    """
    ref = curve.valuation_date
    d1_eff = d1 if d1 >= ref else ref
    if d1_eff >= d2:
        return 0.0
    df = curve.yield_curve_handle.discount
    dcf = DAY_COUNT.yearFraction(d1_eff, d2)
    if dcf <= 0.0:
        return 0.0
    return (df(d1_eff) / df(d2) - 1.0) / dcf


def _price_floating_telescoped(rest: list[_Period], curve: CurveBundle, notional: float):
    """PV_floating_remaining = Notional x [DF(next_reset) - DF(maturity)].

    Exact under: flat notional, no float-leg spread, reset frequency == payment
    frequency (all true here -- VanillaSwap.notional is a single scalar with no
    amortization schedule, and one `_build_periods` schedule drives both legs).
    Mathematically this is the same sum as _price_floating_per_period would
    produce for the same periods (each per-period PV telescopes to
    notional*(DF(t_i) - DF(t_{i+1})), which collapses to notional*(DF(first) -
    DF(last)) when summed) -- see test_mtm_valuation.py for the equivalence check.
    """
    df = curve.yield_curve_handle.discount
    ref = curve.valuation_date
    next_reset_ql = rest[0].accrual_start_ql
    # In-progress period: accrual_start is before the reference date.
    # df(ref) == 1.0 by definition, so the formula becomes notional*(1 - df(maturity)).
    next_reset_eff = next_reset_ql if next_reset_ql >= ref else ref
    maturity_ql = rest[-1].accrual_end_ql
    pv = notional * (df(next_reset_eff) - df(maturity_ql))
    detail = CashFlowDetail(rest[0].accrual_start, rest[-1].accrual_end, rest[-1].payment_date, "floating", None, False, None, pv)
    return pv, [detail]


def _price_floating_per_period(rest: list[_Period], curve: CurveBundle, notional: float, float_spread: float):
    """Estimate each remaining period's forward rate individually (full per-period breakdown).

    This is always used for the displayed cashflow rows. _price_floating_telescoped
    is kept around only as an internal cross-check when its assumptions hold.
    """
    df = curve.yield_curve_handle.discount
    pv = 0.0
    details: list[CashFlowDetail] = []
    for p in rest:
        d1, d2 = p.accrual_start_ql, p.accrual_end_ql
        dcf = DAY_COUNT.yearFraction(d1, d2)
        fwd = forward_rate(curve, d1, d2)
        cf = notional * (fwd + float_spread) * dcf
        cf_pv = cf * df(p.payment_date_ql)
        pv += cf_pv
        details.append(CashFlowDetail(p.accrual_start, p.accrual_end, p.payment_date, "floating", fwd, False, cf, cf_pv))
    return pv, details


# Relative, not absolute: float64 summation-order noise on a ~KRW-billions PV
# scales with the PV itself (e.g. ~1e-6 KRW of noise is routine at ~1.8bn KRW
# notional-scale PV) -- a flat 1e-6 KRW absolute bound flagged that noise as a
# false-positive "divergence" on every realistic trade. The 1e-3 KRW floor
# covers near-zero PVs (e.g. an already-matured leg) where the relative term
# alone would be too tight.
_TELESCOPING_RELATIVE_TOLERANCE = 1e-9
_TELESCOPING_ABSOLUTE_FLOOR = 1e-3  # KRW


def _price_floating_leg(
    remaining: list[_Period],
    curve: CurveBundle,
    notional: float,
    float_spread: float,
    fixings: dict[date, float],
):
    if not remaining:
        return 0.0, False, False, []

    df = curve.yield_curve_handle.discount
    first = remaining[0]
    known_rate = fixings.get(_reset_date(first.accrual_start_ql))

    pv = 0.0
    details: list[CashFlowDetail] = []
    rest = remaining

    if known_rate is not None:
        # Case A: the next payment's rate has already been fixed -- known cashflow.
        dcf = DAY_COUNT.yearFraction(first.accrual_start_ql, first.accrual_end_ql)
        cf = notional * (known_rate + float_spread) * dcf
        cf_pv = cf * df(first.payment_date_ql)
        pv += cf_pv
        details.append(CashFlowDetail(first.accrual_start, first.accrual_end, first.payment_date, "floating", known_rate, True, cf, cf_pv))
        rest = remaining[1:]

    telescoping_used = False
    telescoping_diverged = False
    if rest:
        # Case B: all subsequent (not-yet-fixed) periods. Always expand into one
        # row per period for display; the telescoping shortcut is only used here
        # as an internal cross-check (it requires float_spread == 0.0).
        rest_pv, rest_details = _price_floating_per_period(rest, curve, notional, float_spread)
        if float_spread == 0.0:
            # Telescoping cross-check relies on exact cancellation of adjacent discount factors.
            # If the first period is in-progress (d1 < ref) and missing its historical fixing,
            # the forward rate fallback applies an annualized (ref, d2) rate to the full (d1, d2)
            # period, which intentionally breaks the telescoping identity.
            can_telescope = rest[0].accrual_start_ql >= curve.valuation_date
            if can_telescope:
                telescoping_used = True
                telescoped_pv, _ = _price_floating_telescoped(rest, curve, notional)
                tolerance = max(_TELESCOPING_ABSOLUTE_FLOOR, abs(telescoped_pv) * _TELESCOPING_RELATIVE_TOLERANCE)
                if abs(telescoped_pv - rest_pv) > tolerance:
                    telescoping_diverged = True
                    warnings.warn(
                        "Telescoping cross-check diverged from per-period floating leg PV: "
                        f"telescoped={telescoped_pv!r} per_period={rest_pv!r} "
                        f"diff={abs(telescoped_pv - rest_pv)!r}",
                        RuntimeWarning,
                        stacklevel=2,
                    )
        pv += rest_pv
        details.extend(rest_details)

    return pv, telescoping_used, telescoping_diverged, details


def _accrued_interest(
    remaining: list[_Period],
    curve: CurveBundle,
    valuation_date_ql: ql.Date,
    notional: float,
    fixed_rate: float,
    float_spread: float,
    fixings: dict[date, float],
):
    """Net accrued from the current period's accrual_start up to valuation_date."""
    if not remaining:
        return 0.0, 0.0

    first = remaining[0]
    accrual_start_ql = first.accrual_start_ql
    settlement_date_ql = curve.settlement_date
    if settlement_date_ql <= accrual_start_ql:
        return 0.0, 0.0  # settlement_date sits exactly at/before the period start

    dcf = DAY_COUNT.yearFraction(accrual_start_ql, settlement_date_ql)
    fixed_accrued = notional * fixed_rate * dcf

    known_rate = fixings.get(_reset_date(accrual_start_ql))
    if known_rate is None:
        # Not yet fixed (e.g. valuation_date == trade_date): best-effort estimate
        # via the full period's forward rate.
        known_rate = forward_rate(curve, accrual_start_ql, first.accrual_end_ql)
    float_accrued = notional * (known_rate + float_spread) * dcf

    return fixed_accrued, float_accrued


def fair_rate_for_schedule(
    trade_date: date,
    maturity_date: date,
    curve: CurveBundle,
    notional: float,
    float_spread: float,
    fixings: dict[date, float],
) -> float:
    """The fixed rate that zeros clean_npv for a swap effective on trade_date
    (which may be any date -- past, today, or forward-starting), ending on
    maturity_date, under `curve`.

    Solved analytically rather than via a QuantLib fairRate() search: since
    pv_fixed_leg = notional * fixed_rate * sum(dcf_i * df_i), fixed_rate is
    just pv_floating_leg divided by that (rate-independent) annuity factor.
    Built from the exact same _build_periods()/_price_floating_leg() this
    module's own value_booked_trade() uses, so a position priced at the
    returned rate is *guaranteed* (not just approximately) to clean_npv ~ 0
    here -- no separate schedule or day-count path to drift out of sync with.

    This is the correct par rate for an arbitrary start date. It is NOT the
    same number as a curve's raw quoted swap rate (e.g. "1Y = 3.7000%"),
    which is the fair rate of a *different* swap: one effective on the
    curve's settlement_date (valuation_date + spot lag), not on trade_date.
    """
    trade_date_ql = to_ql_date(trade_date)
    maturity_date_ql = to_ql_date(maturity_date)

    # Apply Fix 1: KRX convention uses T+1 (Spot) as the effective date for the schedule
    effective_date_ql = CALENDAR.advance(trade_date_ql, SPOT_DAYS, ql.Days)

    periods = _build_periods(effective_date_ql, maturity_date_ql)
    remaining = [p for p in periods if p.payment_date > from_ql_date(curve.valuation_date)]
    if not remaining:
        return 0.0

    df = curve.yield_curve_handle.discount
    fixed_annuity = sum(
        DAY_COUNT.yearFraction(p.accrual_start_ql, p.accrual_end_ql) * df(p.payment_date_ql) for p in remaining
    )
    if fixed_annuity <= 0.0:
        return 0.0

    pv_floating, *_ = _price_floating_leg(remaining, curve, notional, float_spread, fixings)
    return pv_floating / (notional * fixed_annuity)


def value_booked_trade(swap: VanillaSwap, curve: CurveBundle, fixings: dict[date, float]) -> MTMResult:
    """Revalue the remaining cash flows of a historically booked swap as of curve's valuation date.

    `swap.trade_date` / `swap.maturity_date` define the immutable contractual
    schedule; `curve` and `fixings` supply everything that depends on
    valuation_date (discounting/projection and historical resets).
    """
    if swap.trade_date is None or swap.maturity_date is None:
        raise ValueError("재평가하려면 거래일과 만기일이 모두 필요합니다.")

    valuation_date_ql = curve.valuation_date
    valuation_date = from_ql_date(valuation_date_ql)
    trade_date_ql = to_ql_date(swap.trade_date)
    maturity_date_ql = to_ql_date(swap.maturity_date)

    # Apply Fix 1: KRX convention uses T+1 (Spot) as the effective date for the schedule
    effective_date_ql = CALENDAR.advance(trade_date_ql, SPOT_DAYS, ql.Days)
    
    periods = _build_periods(effective_date_ql, maturity_date_ql)
    remaining = [p for p in periods if p.payment_date > valuation_date]

    pv_fixed, fixed_details = _price_fixed_leg(remaining, curve, swap.notional, swap.fixed_rate)
    pv_floating, telescoping_used, telescoping_diverged, float_details = _price_floating_leg(
        remaining, curve, swap.notional, swap.float_spread, fixings
    )
    fixed_accrued, float_accrued = _accrued_interest(
        remaining, curve, valuation_date_ql, swap.notional, swap.fixed_rate, swap.float_spread, fixings
    )

    df_settlement = curve.yield_curve_handle.discount(curve.settlement_date)
    pv_fixed /= df_settlement
    pv_floating /= df_settlement
    for c in fixed_details:
        c.pv /= df_settlement
    for c in float_details:
        c.pv /= df_settlement

    if swap.pay_fixed:
        clean_npv = pv_floating - pv_fixed
        net_accrued = float_accrued - fixed_accrued
    else:
        clean_npv = pv_fixed - pv_floating
        net_accrued = fixed_accrued - float_accrued

    dirty_npv = clean_npv + net_accrued

    return MTMResult(
        clean_npv=clean_npv,
        dirty_npv=dirty_npv,
        accrued_interest=net_accrued,
        pv_fixed_leg=pv_fixed,
        pv_floating_leg=pv_floating,
        telescoping_used=telescoping_used,
        telescoping_diverged=telescoping_diverged,
        cashflows=sorted(fixed_details + float_details, key=lambda c: c.payment_date),
    )
