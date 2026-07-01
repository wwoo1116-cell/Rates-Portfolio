"""Portfolio pricing endpoint: prices N booked swaps against one shared curve."""

from __future__ import annotations

from fastapi import APIRouter

from ...engine.instruments import VanillaSwap
from ...services import portfolio_service
from ..models import (
    PortfolioCashFlowOut,
    PortfolioPriceRequest,
    PortfolioPriceResponse,
    PositionResultOut,
    _to_snapshot,
)

router = APIRouter(prefix="/api/portfolio")


@router.post("/price", response_model=PortfolioPriceResponse)
def portfolio_price_endpoint(request: PortfolioPriceRequest) -> PortfolioPriceResponse:
    """Revalue every position against one shared curve; return aggregated NPV and cash flows."""
    positions = [
        (
            p.position_id,
            VanillaSwap(
                tenor_years=0,  # unused: maturity_date is set, so to_ql_swap()/value_booked_trade() ignore it
                notional=p.notional,
                fixed_rate=p.fixed_rate,
                pay_fixed=p.pay_fixed,
                float_spread=p.float_spread,
                trade_date=p.start_date,
                maturity_date=p.maturity_date,
            ),
        )
        for p in request.positions
    ]
    from ...services.market_data_service import load_fixings
    fixings = load_fixings()
    result = portfolio_service.price_portfolio(_to_snapshot(request), positions, fixings, request.interpolation_method)
    return PortfolioPriceResponse(
        net_npv=result.net_npv,
        payer_npv=result.payer_npv,
        receiver_npv=result.receiver_npv,
        position_results=[PositionResultOut(**vars(p)) for p in result.position_results],
        cashflows=[
            PortfolioCashFlowOut(position_id=pcf.position_id, **vars(pcf.detail)) for pcf in result.cashflows
        ],
        interpolation_method=request.interpolation_method,
    )
