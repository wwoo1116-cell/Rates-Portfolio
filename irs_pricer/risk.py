"""Sensitivity measures, built on top of instruments.VanillaSwap."""

from __future__ import annotations

from .curve import CurveBundle
from .instruments import VanillaSwap


def dv01(swap: VanillaSwap, curve: CurveBundle) -> float:
    """Fixed-leg PV change for a +1bp move in the swap's fixed rate."""
    return abs(swap.to_ql_swap(curve).fixedLegBPS())
