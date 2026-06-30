"""Valuation: prices a VanillaSwap against a bootstrapped CurveBundle."""

from __future__ import annotations

from .curve import CurveBundle
from .instruments import VanillaSwap


def price_swap(swap: VanillaSwap, curve: CurveBundle) -> dict:
    ql_swap = swap.to_ql_swap(curve)
    return {
        "npv": ql_swap.NPV(),
        "fixed_leg_pv": ql_swap.fixedLegNPV(),
        "float_leg_pv": ql_swap.floatingLegNPV(),
        "par_rate": ql_swap.fairRate(),
    }
