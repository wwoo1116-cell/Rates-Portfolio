"""
Pricing service: curve building, NPV computation, DV01, and curve sampling.
"""

from __future__ import annotations

from dataclasses import dataclass

import QuantLib as ql

from ..core.market_data import MarketSnapshot
from ..engine.curve import build_curve
from ..engine.instruments import VanillaSwap
from ..engine.pricing import price_swap
from ..engine.risk import dv01

_CURVE_STEP_YEARS = 0.25
_CURVE_MAX_YEARS = 10.0


def price(
    snapshot: MarketSnapshot,
    swap: VanillaSwap,
    interpolation_method: str = "flat",
) -> dict:
    """Build curve, price swap, compute DV01.

    Returns a plain dict with keys: npv, fixed_leg_pv, float_leg_pv, par_rate, dv01.
    """
    curve = build_curve(snapshot, interpolation_method=interpolation_method)
    result = price_swap(swap, curve)
    result["dv01"] = dv01(swap, curve)
    return result


@dataclass
class CurvePoint:
    tenor_years: float
    zero_rate: float
    discount_factor: float
    is_knot: bool


def sample_curve(
    snapshot: MarketSnapshot,
    interpolation_method: str = "flat",
) -> list[CurvePoint]:
    """Sample zero rates and discount factors on a 0.25Y mesh up to 10Y.

    Tenors carrying a real market quote (the CD91 3M deposit plus each
    swap-quote tenor) are marked is_knot=True.
    """
    curve = build_curve(snapshot, interpolation_method=interpolation_method)
    knot_years = {0.25} | {float(q.tenor_years) for q in snapshot.swap_quotes}

    steps = round(_CURVE_MAX_YEARS / _CURVE_STEP_YEARS)
    points = []
    for i in range(1, steps + 1):
        t = round(i * _CURVE_STEP_YEARS, 2)
        points.append(
            CurvePoint(
                tenor_years=t,
                zero_rate=curve.yield_curve.zeroRate(t, ql.Continuous).rate(),
                discount_factor=curve.yield_curve.discount(t),
                is_knot=any(abs(t - k) < 1e-6 for k in knot_years),
            )
        )
    return points
