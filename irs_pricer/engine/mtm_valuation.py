"""
Mark-to-market valuation of a historically booked VanillaSwap.
Rewritten using quant_engine's IRS_Trade logic.

UNIT CONVENTION -- DECIMAL AT THIS BOUNDARY (enforced here, not just documented)
--------------------------------------------------------------------------------
Every rate that crosses into this module is an annualized DECIMAL fraction
(0.0251 == 2.51%): the loaders convert workbook percents to decimal exactly
once (loaders/true_data.py::load_fixing_history_xlsx et al.), the curve
consumes decimal par rates (quant_engine.bootstrap_zero_curve), and the
`fixings` mapping here is passed verbatim from
market_data_service.load_fixings() (date -> decimal CD91 print). Percent
exists only inside quant_engine's `*_pct` arguments, and
VanillaSwap.to_irs_trade() performs that single decimal->percent conversion
(fixed_rate * 100).

FIXING SELECTION is delegated to engine/fixings.py (reset-date semantics,
F(R) = R - 1 Seoul business day, immutable once fixed, no look-ahead) -- see
that module's docstring for the convention and its data-quality fallback.

Do NOT add a /100 or *100 to any rate in this module. The 2026-07 PnL-Trace
cliff (DIAG_PNL_TRACE.md) was exactly a second /100 applied here to an
already-decimal CD fixing, which crushed the floating stub ~100x and silently
corrupted every MtM/PnL surface downstream. tests/test_unit_guard.py pins the
contract from both sides (a double division AND a missing division each move
the settlement by ~100x and fail it).
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Mapping

from .curve import CurveBundle
from .fixings import FixingResolution, select_fixing
from .instruments import VanillaSwap
from .quant_engine import forward_rate_simple, df_linear_rate


@dataclass
class CashFlowDetail:
    accrual_start: date
    accrual_end: date
    payment_date: date
    leg: str  # "fixed" | "floating"
    rate: float | None  # known fixing or forward estimate
    is_known: bool
    cashflow: float | None
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
    # One entry per floating period whose F(R) had passed on the valuation
    # date (i.e. per fixing actually consumed). Entries with is_exact=False
    # are the data-quality events services must log/surface.
    fixing_resolutions: list[FixingResolution] = field(default_factory=list)


def value_booked_trade(
    swap: VanillaSwap,
    curve: CurveBundle,
    fixings: Mapping[date, float] | None = None,
) -> MTMResult:
    """Revalue `swap` on `curve` against the historical CD91 `fixings` store
    ({date: decimal rate}, passed verbatim from load_fixings()).

    Each floating period's rate is resolved by engine/fixings.py: the CD91
    print of F(R) = reset date - 1 Seoul business day, immutable once F(R)
    has passed, and never a fixing dated after the valuation date (no
    look-ahead on historical valuations). Periods whose F(R) is still in the
    future -- and any period the store cannot cover at all -- are priced off
    the curve's own forward.
    """
    irs_trade = swap.to_irs_trade(curve.valuation_date)
    val_date = curve.valuation_date
    zc = curve.yield_curve

    rem = [i for i, pd in enumerate(irs_trade.pay_dates) if pd > val_date]
    if not rem:
        return MTMResult(0.0, 0.0, 0.0, 0.0, 0.0, False, False, [])

    first_i = rem[0]

    # IRS_Trade carries the fixed rate in percent (quant_engine's *_pct
    # discipline); this is the one sanctioned percent->decimal conversion here.
    fixed_rate = irs_trade.fixed_rate_pct / 100.0

    cashflows: list[CashFlowDetail] = []
    fixing_resolutions: list[FixingResolution] = []

    fixed_pv = 0.0
    float_pv = 0.0

    accrued_interest_fixed = 0.0
    accrued_interest_float = 0.0
    
    for i in rem:
        a_start = irs_trade.pay_dates[i-1] if i > 0 else irs_trade.start_date
        a_end = irs_trade.pay_dates[i]
        t_pay = (a_end - val_date).days / 365.0
        df_pay = df_linear_rate(t_pay, zc)
        
        # Fixed Leg
        cf_fixed = irs_trade.notional * fixed_rate * irs_trade.accruals[i]
        cf_fixed_pv = cf_fixed * df_pay
        fixed_pv += cf_fixed_pv
        
        cashflows.append(CashFlowDetail(a_start, a_end, a_end, "fixed", fixed_rate, True, cf_fixed, cf_fixed_pv))
        
        if i == first_i and val_date > a_start:
            # Calculate accrued portion linearly
            days_accrued = (val_date - a_start).days
            total_days = (a_end - a_start).days
            if total_days > 0:
                accrued_interest_fixed += cf_fixed * (days_accrued / total_days)
    
    t_s = 0.0
    for idx, i in enumerate(rem):
        a_start = irs_trade.pay_dates[i-1] if i > 0 else irs_trade.start_date
        a_end = irs_trade.pay_dates[i]
        t_e = (a_end - val_date).days / 365.0
        df_pay = df_linear_rate(t_e, zc)

        # a_start IS the period's reset date; select_fixing applies the
        # F(R) = R - 1 Seoul-business-day convention and the no-look-ahead
        # guard. Not restricted to idx == 0: on the day before a reset the
        # next period's F(R) has already passed, and its print -- not the
        # forward -- is the period's immutable rate from that day on.
        resolution = select_fixing(fixings, a_start, val_date) if fixings else None
        if resolution is not None:
            fixing_resolutions.append(resolution)
        if resolution is not None and resolution.rate is not None:
            rate = resolution.rate
            is_known = True
        else:
            rate = forward_rate_simple(t_s, t_e, zc, df_fn=df_linear_rate)
            is_known = False

        cf_float = irs_trade.notional * rate * irs_trade.accruals[i]
        cf_float_pv = cf_float * df_pay
        float_pv += cf_float_pv
        
        cashflows.append(CashFlowDetail(a_start, a_end, a_end, "floating", rate, is_known, cf_float, cf_float_pv))
        
        if i == first_i and val_date > a_start:
            days_accrued = (val_date - a_start).days
            total_days = (a_end - a_start).days
            if total_days > 0:
                accrued_interest_float += cf_float * (days_accrued / total_days)
                
        t_s = t_e

    npv = irs_trade.direction * (fixed_pv - float_pv)
    net_accrued = irs_trade.direction * (accrued_interest_fixed - accrued_interest_float)
    clean_npv = npv - net_accrued
    
    return MTMResult(
        clean_npv=clean_npv,
        dirty_npv=npv,
        accrued_interest=net_accrued,
        pv_fixed_leg=-fixed_pv if swap.pay_fixed else fixed_pv,
        pv_floating_leg=float_pv if swap.pay_fixed else -float_pv,
        telescoping_used=False,
        telescoping_diverged=False,
        cashflows=cashflows,
        fixing_resolutions=fixing_resolutions,
    )
