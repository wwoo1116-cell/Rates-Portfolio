"""Bond cash-flow endpoint: generates a rigorous coupon + redemption schedule and
NPV for each uploaded bond. All schedule/day-count/NPV math happens server-side
(the frontend only parses + hydrates static params); discount yields come from
the Credit Matrix (시장유통수익률)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ...services import bond_cashflow_service
from ..models import (
    BondCashflowRequest,
    BondCashflowResponse,
    BondResultOut,
    PortfolioCashFlowOut,
)

router = APIRouter(prefix="/api/portfolio")


@router.post("/bond-cashflows", response_model=BondCashflowResponse)
def bond_cashflows_endpoint(request: BondCashflowRequest) -> BondCashflowResponse:
    try:
        result = bond_cashflow_service.price_bonds(request.bonds, request.valuation_date)
    except ValueError as e:
        # Unknown sector/rating, missing Credit Matrix data, or a bad schedule.
        raise HTTPException(status_code=400, detail=str(e)) from e
    return BondCashflowResponse(
        results=[BondResultOut(**vars(r)) for r in result.results],
        cashflows=[
            PortfolioCashFlowOut(position_id=bcf.asset_id, **vars(bcf.detail))
            for bcf in result.cashflows
        ],
    )
