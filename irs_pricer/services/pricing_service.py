"""
Pricing service: curve building, NPV computation, DV01, and curve sampling.
QuantLib-free -- prices exclusively through engine/*, which wraps quant_engine.py.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from ..core.market_data import MarketSnapshot
from ..engine.curve import build_curve
from ..engine.instruments import VanillaSwap
from ..engine.pricing import price_swap
from ..engine.quant_engine import df_linear_rate
from ..engine.risk import bucketed_dv01, dv01

_CURVE_STEP_YEARS = 0.25
_CURVE_MAX_YEARS = 10.0


def price(
    snapshot: MarketSnapshot,
    swap: VanillaSwap,
) -> dict:
    """Build curve, price swap, compute DV01.

    Returns a plain dict with keys: npv, fixed_leg_pv, float_leg_pv, par_rate, dv01.
    """
    curve = build_curve(snapshot)
    result = price_swap(swap, curve)
    result["dv01"] = dv01(swap, curve)
    return result


@dataclass
class DeltaBucket:
    pillar: str
    delta: float


@dataclass
class DeltaResult:
    total_delta: float  # sum of the bucket deltas -- see engine/risk.py's module docstring
    buckets: list[DeltaBucket]


def delta(
    snapshot: MarketSnapshot,
    swap: VanillaSwap,
) -> DeltaResult:
    """Bucketed + total key-rate delta (KRD) for a hypothetical (new-trade) swap,
    computed by engine.risk.bucketed_dv01 (quant_engine's compute_irs_krd_map).
    total_delta is the sum of the buckets."""
    curve = build_curve(snapshot)
    buckets_dict = bucketed_dv01(swap, curve)

    buckets: list[DeltaBucket] = []
    for label, val in buckets_dict.items():
        if abs(val) > 1e-9:
            buckets.append(DeltaBucket(label, val))

    return DeltaResult(total_delta=sum(b.delta for b in buckets), buckets=buckets)


@dataclass
class CurvePoint:
    tenor_years: float
    zero_rate: float
    discount_factor: float
    is_knot: bool


def sample_curve(
    snapshot: MarketSnapshot,
) -> list[CurvePoint]:
    """Sample zero rates and discount factors on a 0.25Y mesh up to 10Y.

    Tenors carrying a real market quote (the CD91 3M deposit plus each
    swap-quote tenor) are marked is_knot=True.
    """
    curve = build_curve(snapshot)
    knot_years = {0.25} | {float(q.tenor_years) for q in snapshot.swap_quotes}

    steps = round(_CURVE_MAX_YEARS / _CURVE_STEP_YEARS)
    points = []
    for i in range(1, steps + 1):
        t = round(i * _CURVE_STEP_YEARS, 2)
        df = df_linear_rate(t, curve.yield_curve)
        zr = -math.log(df) / t if t > 0 else 0.0

        points.append(
            CurvePoint(
                tenor_years=t,
                zero_rate=zr,
                discount_factor=df,
                is_knot=any(abs(t - k) < 1e-6 for k in knot_years),
            )
        )
    return points
