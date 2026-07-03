"""
MTM service: orchestrates curve building, fixing history loading, and MTM valuation.
"""

from __future__ import annotations

from datetime import date

from dateutil.relativedelta import relativedelta

from ..core.market_data import MarketSnapshot
from ..engine.curve import build_curve
from ..engine.instruments import VanillaSwap
from ..engine.mtm_valuation import MTMResult, value_booked_trade
from . import portfolio_service


from ..core.conventions import to_ql_date
from ..engine.context import managed_quantlib_env


def trade_maturity_date(trade_date: date, tenor_years: int) -> date:
    """A booked trade's maturity from its trade_date and tenor -- the single
    source of truth for this computation, shared by the /api/mtm pricing
    endpoint and the /api/mtm/fair-rate hint endpoint so they can never
    independently drift onto two different maturity dates for what's meant
    to be the same schedule."""
    return trade_date + relativedelta(years=tenor_years)


def value_trade(
    snapshot: MarketSnapshot,
    swap: VanillaSwap,
    fixings: dict[date, float],
) -> MTMResult:
    """Build curve, revalue the booked swap using injected historical fixings."""
    with managed_quantlib_env(to_ql_date(snapshot.valuation_date)):
        curve = build_curve(snapshot)
        return value_booked_trade(swap, curve, fixings)


def fair_rate(
    snapshot: MarketSnapshot,
    trade_date: date,
    tenor_years: int,
    notional: float,
    float_spread: float = 0.0,
    fixings: dict[date, float] | None = None,
) -> tuple[float, date]:
    """The schedule-correct par rate for a booked trade's own effective date
    (trade_date, taken literally -- not settlement_date/T+1) and maturity
    (trade_maturity_date()). This is what should be shown/typed as the "par
    rate" hint for MTM re-evaluation: a curve's raw quoted tenor rate is the
    fair rate of a *different* swap (one effective on settlement_date), so
    plugging it in here would not zero NPV even when trade_date ==
    valuation_date and the curve hasn't moved. See engine/mtm_valuation.py:
    fair_rate_for_schedule for the underlying math.

    Returns (fair_rate, maturity_date) -- the caller needs maturity_date too
    since it isn't an input the frontend computes itself.
    """
    maturity_date = trade_maturity_date(trade_date, tenor_years)
    rate = portfolio_service.position_fair_rate(
        snapshot, trade_date, maturity_date, notional, float_spread, fixings,
    )
    return rate, maturity_date
