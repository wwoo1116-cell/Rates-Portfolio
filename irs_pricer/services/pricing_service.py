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
from ..engine.risk import curve_bump_scenarios, dv01

from ..core.conventions import to_ql_date
from ..engine.context import managed_quantlib_env

_CURVE_STEP_YEARS = 0.25
_CURVE_MAX_YEARS = 10.0


def price(
    snapshot: MarketSnapshot,
    swap: VanillaSwap,
) -> dict:
    """Build curve, price swap, compute DV01.

    Returns a plain dict with keys: npv, fixed_leg_pv, float_leg_pv, par_rate, dv01.
    """
    with managed_quantlib_env(to_ql_date(snapshot.valuation_date)):
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
    total_delta: float  # sum of the bucket deltas -- see engine/risk.py's module docstring for why
    buckets: list[DeltaBucket]


def delta(
    snapshot: MarketSnapshot,
    swap: VanillaSwap,
) -> DeltaResult:
    """Bucketed + total key-rate delta for a hypothetical (new-trade) swap.

    For each curve pillar in turn, that pillar's own market quote is bumped
    and the whole curve is re-bootstrapped from scratch, then `swap` is
    repriced against that curve; see engine/risk.py's module docstring for
    why a market-quote bump + full rebootstrap (not a direct discount-factor
    perturbation) is the convention that matches the reference system here,
    and why total_delta is the sum of the buckets rather than a
    separately-priced parallel scenario.
    """
    with managed_quantlib_env(to_ql_date(snapshot.valuation_date)):
        base_curve = build_curve(snapshot)
        base_npv = price_swap(swap, base_curve)["npv"]

        buckets: list[DeltaBucket] = []
        for label, curve in curve_bump_scenarios(snapshot):
            bumped_npv = price_swap(swap, curve)["npv"]
            buckets.append(DeltaBucket(label, bumped_npv - base_npv))
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
    with managed_quantlib_env(to_ql_date(snapshot.valuation_date)):
        curve = build_curve(snapshot)
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
