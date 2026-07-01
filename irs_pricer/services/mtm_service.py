"""
MTM service: orchestrates curve building, fixing history loading, and MTM valuation.
"""

from __future__ import annotations

from datetime import date

from ..core.market_data import MarketSnapshot
from ..engine.curve import build_curve
from ..engine.instruments import VanillaSwap
from ..engine.mtm_valuation import MTMResult, value_booked_trade


from ..core.conventions import to_ql_date
from ..engine.context import managed_quantlib_env


def value_trade(
    snapshot: MarketSnapshot,
    swap: VanillaSwap,
    fixings: dict[date, float],
    interpolation_method: str = "flat",
) -> MTMResult:
    """Build curve, revalue the booked swap using injected historical fixings."""
    with managed_quantlib_env(to_ql_date(snapshot.valuation_date)):
        curve = build_curve(snapshot, interpolation_method=interpolation_method)
        return value_booked_trade(swap, curve, fixings)
