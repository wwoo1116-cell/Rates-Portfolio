"""MTM (Mark-to-Market) revaluation endpoint."""

from __future__ import annotations

from fastapi import APIRouter

from ...engine.instruments import VanillaSwap
from ...services import mtm_service
from ..models import (
    CashFlowDetailOut,
    MtmFairRateRequest,
    MtmFairRateResponse,
    MtmRequest,
    MtmResponse,
    _to_snapshot,
)

router = APIRouter(prefix="/api")


@router.post("/mtm/fair-rate", response_model=MtmFairRateResponse)
def mtm_fair_rate_endpoint(request: MtmFairRateRequest) -> MtmFairRateResponse:
    """The schedule-correct par rate hint for MTM re-evaluation -- priced off
    the exact same trade_date-literal schedule /api/mtm will actually price,
    not a raw curve-quoted tenor rate (see mtm_service.fair_rate for why
    those are different swaps)."""
    from ...services.market_data_service import load_fixings
    fixings = load_fixings()
    rate, maturity_date = mtm_service.fair_rate(
        _to_snapshot(request),
        request.trade_date,
        request.tenor_years,
        request.notional,
        request.float_spread,
        fixings,
    )
    return MtmFairRateResponse(fair_rate=rate, maturity_date=maturity_date)


@router.post("/mtm", response_model=MtmResponse)
def mtm_endpoint(request: MtmRequest) -> MtmResponse:
    """Revalue a historically booked swap and return clean/dirty NPV plus cash-flow breakdown."""
    maturity_date = mtm_service.trade_maturity_date(request.swap.trade_date, request.swap.tenor_years)
    swap = VanillaSwap(
        tenor_years=request.swap.tenor_years,
        notional=request.swap.notional,
        fixed_rate=request.swap.fixed_rate,
        pay_fixed=request.swap.pay_fixed,
        float_spread=request.swap.float_spread,
        trade_date=request.swap.trade_date,
        maturity_date=maturity_date,
    )
    from ...services.market_data_service import load_fixings
    fixings = load_fixings()
    result = mtm_service.value_trade(_to_snapshot(request), swap, fixings)
    return MtmResponse(
        clean_npv=result.clean_npv,
        dirty_npv=result.dirty_npv,
        accrued_interest=result.accrued_interest,
        pv_fixed_leg=result.pv_fixed_leg,
        pv_floating_leg=result.pv_floating_leg,
        telescoping_used=result.telescoping_used,
        telescoping_diverged=result.telescoping_diverged,
        cashflows=[CashFlowDetailOut(**vars(c)) for c in result.cashflows],
    )
