"""
Portfolio service: prices N booked swaps against one shared curve and aggregates
Net / Payer / Receiver NPV plus a consolidated, position-tagged cash-flow schedule.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from ..core.market_data import MarketSnapshot
from ..engine.curve import build_curve
from ..engine.instruments import VanillaSwap
from ..engine.mtm_valuation import CashFlowDetail, value_booked_trade
from ..engine.risk import bucketed_dv01
from ..engine.pricing import price_swap
from . import market_data_service
from .pricing_service import DeltaBucket

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

@dataclass
class PositionDelta:
    position_id: str
    total_delta: float
    buckets: list[DeltaBucket]

@dataclass
class PortfolioDeltaResult:
    total_delta: float
    buckets: list[DeltaBucket]
    position_deltas: list[PositionDelta]

def _extract_float_rate(fixings: dict[date, float] | None) -> float | None:
    if fixings:
        latest_date = max(fixings.keys())
        return fixings[latest_date]
    return None

def price_portfolio_delta(
    snapshot: MarketSnapshot,
    positions: list[tuple[str, VanillaSwap]],
    fixings: dict[date, float],
) -> PortfolioDeltaResult:
    curve = build_curve(snapshot)
    
    position_deltas = []
    portfolio_buckets_map = {}
    
    for position_id, swap in positions:
        buckets_dict = bucketed_dv01(swap, curve)
        pos_buckets = []
        pos_total = 0.0
        for label, val in buckets_dict.items():
            if abs(val) > 1e-9:
                pos_buckets.append(DeltaBucket(label, val))
                pos_total += val
                portfolio_buckets_map[label] = portfolio_buckets_map.get(label, 0.0) + val
                
        position_deltas.append(PositionDelta(position_id, pos_total, pos_buckets))
        
    portfolio_buckets = [DeltaBucket(label, val) for label, val in portfolio_buckets_map.items()]
    
    return PortfolioDeltaResult(
        total_delta=sum(b.delta for b in portfolio_buckets),
        buckets=portfolio_buckets,
        position_deltas=position_deltas,
    )

def price_portfolio(
    snapshot: MarketSnapshot,
    positions: list[tuple[str, VanillaSwap]],
    fixings: dict[date, float],
) -> PortfolioResult:
    curve = build_curve(snapshot)
    current_float_rate = _extract_float_rate(fixings)

    position_results: list[PositionResult] = []
    cashflows: list[PortfolioCashFlow] = []
    payer_npv = 0.0
    receiver_npv = 0.0

    for position_id, swap in positions:
        result = value_booked_trade(swap, curve, current_float_rate)
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
    curve = build_curve(snapshot)
    swap = VanillaSwap(
        tenor_years=0,
        notional=notional,
        fixed_rate=0.0,
        pay_fixed=True,
        float_spread=float_spread,
        trade_date=start_date,
        maturity_date=maturity_date
    )
    return price_swap(swap, curve)["par_rate"]

def historical_spot_rate(
    start_date: date,
    maturity_date: date,
    notional: float,
    float_spread: float = 0.0,
) -> float:
    historical_snapshot = market_data_service.load_snapshot(start_date)
    curve = build_curve(historical_snapshot)
    swap = VanillaSwap(
        tenor_years=0,
        notional=notional,
        fixed_rate=0.0,
        pay_fixed=True,
        float_spread=float_spread,
        trade_date=start_date,
        maturity_date=maturity_date
    )
    return price_swap(swap, curve)["par_rate"]
