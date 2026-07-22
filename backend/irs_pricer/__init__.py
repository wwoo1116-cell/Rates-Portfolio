"""
Public API of the irs_pricer package.

Imports are intentionally explicit so that `from irs_pricer import X` works
without callers needing to know the internal layer structure.
"""

from .core.market_data import MarketSnapshot, RateQuote
from .engine.curve import CurveBundle, build_curve
from .engine.instruments import VanillaSwap
from .engine.pricing import price_swap
from .engine.risk import dv01

__all__ = [
    "MarketSnapshot",
    "RateQuote",
    "CurveBundle",
    "build_curve",
    "VanillaSwap",
    "price_swap",
    "dv01",
]
