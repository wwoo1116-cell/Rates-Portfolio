"""Valuation: prices a VanillaSwap against a bootstrapped CurveBundle."""

from __future__ import annotations

from .curve import CurveBundle
from .instruments import VanillaSwap
from .quant_engine import forward_rate_simple, df_linear_rate


def price_swap(swap: VanillaSwap, curve: CurveBundle) -> dict:
    irs_trade = swap.to_irs_trade(curve.valuation_date)
    
    rem = [i for i, pd in enumerate(irs_trade.pay_dates) if pd > curve.valuation_date]
    if not rem:
        return {"npv": 0.0, "fixed_leg_pv": 0.0, "float_leg_pv": 0.0, "par_rate": 0.0}

    first_i = rem[0]
    t_next = max((irs_trade.pay_dates[first_i] - curve.valuation_date).days / 365.0, 1.0 / 365.0)
    current_float = forward_rate_simple(0.0, t_next, curve.yield_curve) * 100.0
    
    fixed_pv = 0.0
    float_pv = 0.0
    fixed_rate = irs_trade.fixed_rate_pct / 100.0
    float_rate0 = current_float / 100.0
    
    cur_acc = irs_trade.accruals[first_i]

    # Accumulate the fixed-leg annuity (PV of 1.0 unit fixed rate) alongside the
    # fixed PV, so par_rate can be recovered as float_pv/annuity WITHOUT dividing
    # by this swap's own fixed_rate. That matters because the fair-rate probe
    # (portfolio_service.position_fair_rate) builds a swap with fixed_rate=0.0;
    # the old `pv01 = fixed_pv/fixed_rate` path returned 0/0 -> par_rate 0,
    # silently breaking /api/portfolio/fair-rate. For a normal (nonzero-fixed)
    # swap this is identical to fixed_pv/fixed_rate.
    annuity = 0.0
    for i in rem:
        t_pay = (irs_trade.pay_dates[i] - curve.valuation_date).days / 365.0
        disc = df_linear_rate(t_pay, curve.yield_curve)
        fixed_pv += irs_trade.notional * fixed_rate * irs_trade.accruals[i] * disc
        annuity += irs_trade.notional * irs_trade.accruals[i] * disc

    float_pv = irs_trade.notional * float_rate0 * cur_acc * df_linear_rate(t_next, curve.yield_curve)
    t_s = t_next
    for i in rem[1:]:
        t_e = (irs_trade.pay_dates[i] - curve.valuation_date).days / 365.0
        fwd = forward_rate_simple(t_s, t_e, curve.yield_curve, df_fn=df_linear_rate)
        float_pv += irs_trade.notional * fwd * irs_trade.accruals[i] * df_linear_rate(t_e, curve.yield_curve)
        t_s = t_e
        
    npv = irs_trade.direction * (fixed_pv - float_pv)

    # Par/fair rate = float leg PV / fixed-leg annuity (robust to fixed_rate==0).
    fair_rate = float_pv / annuity if annuity != 0 else 0.0

    return {
        "npv": npv,
        "fixed_leg_pv": -fixed_pv if swap.pay_fixed else fixed_pv,
        "float_leg_pv": float_pv if swap.pay_fixed else -float_pv,
        "par_rate": fair_rate,
    }
