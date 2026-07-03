"""
Portfolio service: prices N booked swaps against one shared curve and aggregates
Net / Payer / Receiver NPV plus a consolidated, position-tagged cash-flow schedule.

Each position is revalued with engine.mtm_valuation.value_booked_trade() (not
pricing.price_swap()) because a portfolio's remaining cash-flow schedule requires
the trade_date-anchored, period-by-period walk that only value_booked_trade()
produces -- see mtm_service.py for the single-position analog this mirrors.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from ..core.market_data import MarketSnapshot
from ..engine.curve import build_curve
from ..engine.instruments import VanillaSwap
from ..engine.mtm_valuation import CashFlowDetail, fair_rate_for_schedule, value_booked_trade
from . import market_data_service


from ..core.conventions import to_ql_date
from ..engine.context import managed_quantlib_env


@dataclass
class PositionResult:
    position_id: str
    clean_npv: float
    dirty_npv: float
    accrued_interest: float
    pv_fixed_leg: float
    pv_floating_leg: float
    pay_fixed: bool


@dataclass
class PortfolioCashFlow:
    position_id: str
    detail: CashFlowDetail


@dataclass
class PortfolioResult:
    net_npv: float
    payer_npv: float
    receiver_npv: float
    position_results: list[PositionResult]
    cashflows: list[PortfolioCashFlow]


def price_portfolio(
    snapshot: MarketSnapshot,
    positions: list[tuple[str, VanillaSwap]],
    fixings: dict[date, float],
) -> PortfolioResult:
    """Build one shared curve, revalue every (position_id, swap) pair, aggregate.

    Net/Payer/Receiver NPV are summed on clean_npv (excludes accrued interest);
    each PositionResult still carries dirty_npv for callers that need it.
    """
    with managed_quantlib_env(to_ql_date(snapshot.valuation_date)):
        curve = build_curve(snapshot)

        position_results: list[PositionResult] = []
        cashflows: list[PortfolioCashFlow] = []
        payer_npv = 0.0
        receiver_npv = 0.0

        for position_id, swap in positions:
            result = value_booked_trade(swap, curve, fixings)
            position_results.append(
                PositionResult(
                    position_id=position_id,
                    clean_npv=result.clean_npv,
                    dirty_npv=result.dirty_npv,
                    accrued_interest=result.accrued_interest,
                    pv_fixed_leg=result.pv_fixed_leg,
                    pv_floating_leg=result.pv_floating_leg,
                    pay_fixed=swap.pay_fixed,
                )
            )
            if swap.pay_fixed:
                payer_npv += result.clean_npv
            else:
                receiver_npv += result.clean_npv
            cashflows.extend(PortfolioCashFlow(position_id, c) for c in result.cashflows)

        cashflows.sort(key=lambda pcf: pcf.detail.payment_date)

        return PortfolioResult(
            net_npv=payer_npv + receiver_npv,
            payer_npv=payer_npv,
            receiver_npv=receiver_npv,
            position_results=position_results,
            cashflows=cashflows,
        )


def position_fair_rate(
    snapshot: MarketSnapshot,
    start_date: date,
    maturity_date: date,
    notional: float,
    float_spread: float = 0.0,
    fixings: dict[date, float] | None = None,
) -> float:
    """The true par rate for a position with this exact start/maturity date
    under the current valuation curve -- see fair_rate_for_schedule() for why
    this differs from the curve's raw quoted tenor rates. This is what the
    frontend's "Par" fixed-rate hint should show (and should be used to
    populate the fixed-rate field), instead of interpolating across quoted
    tenors, which is not guaranteed to zero the position's NPV.
    """
    with managed_quantlib_env(to_ql_date(snapshot.valuation_date)):
        curve = build_curve(snapshot)
        return fair_rate_for_schedule(start_date, maturity_date, curve, notional, float_spread, fixings or {})


def historical_spot_rate(
    start_date: date,
    maturity_date: date,
    notional: float,
    float_spread: float = 0.0,
) -> float:
    """The historical spot par rate quoted ON start_date itself -- what this
    exact schedule would actually have traded at back then, using THAT day's
    own market snapshot and curve (valuation_date == start_date), never
    today's.

    Deliberately separate from position_fair_rate(), which always prices off
    the CURRENT valuation curve (a forward breakeven rate) -- these answer
    two different questions ("what rate zeros this trade's NPV today" vs.
    "what rate did this trade actually quote at historically") and must not
    be conflated into one endpoint. See engine/mtm_valuation.py:
    fair_rate_for_schedule for the shared math each one calls into.
    """
    historical_snapshot = market_data_service.load_snapshot(start_date)
    with managed_quantlib_env(to_ql_date(start_date)):
        curve = build_curve(historical_snapshot)
        return fair_rate_for_schedule(start_date, maturity_date, curve, notional, float_spread, {})
