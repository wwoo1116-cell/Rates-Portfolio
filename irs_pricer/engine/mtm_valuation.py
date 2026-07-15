"""
Mark-to-market valuation of a historically booked VanillaSwap.
Rewritten using quant_engine's IRS_Trade logic.
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass
from datetime import date, timedelta

from .curve import CurveBundle
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


def value_booked_trade(swap: VanillaSwap, curve: CurveBundle, current_float_rate: float | None = None) -> MTMResult:
    irs_trade = swap.to_irs_trade(curve.valuation_date)
    val_date = curve.valuation_date
    zc = curve.yield_curve

    rem = [i for i, pd in enumerate(irs_trade.pay_dates) if pd > val_date]
    if not rem:
        return MTMResult(0.0, 0.0, 0.0, 0.0, 0.0, False, False, [])

    first_i = rem[0]
    t_next = max((irs_trade.pay_dates[first_i] - val_date).days / 365.0, 1.0 / 365.0)
    
    if current_float_rate is None:
        current_float_rate = forward_rate_simple(0.0, t_next, zc) * 100.0
        
    fixed_rate = irs_trade.fixed_rate_pct / 100.0
    float_rate0 = current_float_rate / 100.0
    
    cashflows: list[CashFlowDetail] = []
    
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
    
    t_s = t_next
    for idx, i in enumerate(rem):
        a_start = irs_trade.pay_dates[i-1] if i > 0 else irs_trade.start_date
        a_end = irs_trade.pay_dates[i]
        t_e = (a_end - val_date).days / 365.0
        df_pay = df_linear_rate(t_e, zc)
        
        if idx == 0:
            rate = float_rate0
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
        cashflows=cashflows
    )
