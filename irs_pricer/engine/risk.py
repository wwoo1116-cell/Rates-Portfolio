"""
Sensitivity measures (PVBP/KRD), built on top of quant_engine.py.

Both KRD (bucketed_dv01) and the independent parallel PVBP (parallel_pvbp)
are computed from the SAME actual ISDA schedule the NPV path uses -- the
`pay_dates`/`accruals`/`sim_date` of the real IRS_Trade are threaded into
quant_engine so the KRD base NPV and the reported NPV (engine.pricing /
engine.mtm_valuation) are one and the same number, and the per-tenor buckets
use the true calendar schedule rather than the nominal-quarter fallback.
"""

from __future__ import annotations

from .curve import CurveBundle
from .instruments import VanillaSwap
from .quant_engine import compute_irs_krd_map, compute_irs_pvbp, forward_rate_simple


def _krd_args(swap: VanillaSwap, curve: CurveBundle) -> dict | None:
    """Common quant_engine kwargs for a swap's risk, built from its actual
    IRS_Trade schedule. None if the swap has no remaining cashflows.

    Threading sim_date + pay_dates + accruals makes quant_engine skip its
    nominal-schedule reconstruction and price off the exact ISDA schedule --
    the same one engine.pricing.price_swap / engine.mtm_valuation use -- so
    the KRD/PVBP base NPV matches the reported NPV (removes the prior
    reported-NPV vs KRD-base-NPV divergence).
    """
    irs_trade = swap.to_irs_trade(curve.valuation_date)
    rem = [i for i, pd in enumerate(irs_trade.pay_dates) if pd > curve.valuation_date]
    if not rem:
        return None
    first_i = rem[0]
    t_next = max((irs_trade.pay_dates[first_i] - curve.valuation_date).days / 365.0, 1.0 / 365.0)
    current_float_rate_pct = forward_rate_simple(0.0, t_next, curve.yield_curve) * 100.0
    t_maturity = max((irs_trade.maturity_date - curve.valuation_date).days / 365.0, 1.0 / 365.0)
    return dict(
        par_rates=curve.par_rates,
        notional=irs_trade.notional,
        fixed_rate_pct=irs_trade.fixed_rate_pct,
        direction=irs_trade.direction,
        t_maturity=t_maturity,
        t_next_payment=t_next,
        current_float_rate_pct=current_float_rate_pct,
        sector=irs_trade.sector,
        fixed_freq=irs_trade.fixed_freq,
        float_freq=irs_trade.float_freq,
        sim_date=curve.valuation_date,
        prev_pay_date=irs_trade.start_date,
        pay_dates=irs_trade.pay_dates,
        accruals=irs_trade.accruals,
    )


def bucketed_dv01(swap: VanillaSwap, curve: CurveBundle) -> dict[str, float]:
    """Bucketed DV01 map (KRD): each par-rate node bumped +1bp, curve
    re-bootstrapped, swap repriced -- over the swap's actual ISDA schedule."""
    args = _krd_args(swap, curve)
    if args is None:
        return {}
    return compute_irs_krd_map(**args)


def parallel_pvbp(swap: VanillaSwap, curve: CurveBundle) -> float:
    """Independent parallel +1bp PVBP (compute_irs_pvbp: bump ALL nodes at
    once, reprice). This is the reconciliation target for sum(bucketed_dv01):
    the two agree to first order and differ only by the (small) cross-gamma
    of the one-at-a-time-vs-all-at-once bumps under the nonlinear
    re-bootstrap. Exposed so callers can check `sum(KRD) - parallel_pvbp`
    as a risk-quality signal rather than assuming the identity holds."""
    args = _krd_args(swap, curve)
    if args is None:
        return 0.0
    return compute_irs_pvbp(**args)


def dv01(swap: VanillaSwap, curve: CurveBundle) -> float:
    """Total DV01 as the sum of the KRD buckets (definitional). For the
    independent parallel-shift figure, use parallel_pvbp()."""
    return sum(bucketed_dv01(swap, curve).values())
