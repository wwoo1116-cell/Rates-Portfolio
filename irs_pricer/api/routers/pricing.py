"""Pricing and curve-sampling endpoints."""

from __future__ import annotations

from fastapi import APIRouter

from ...engine.instruments import VanillaSwap
from ...services import pricing_service
from ..models import (
    CurvePointOut,
    CurveRequest,
    CurveResponse,
    PriceRequest,
    PriceResponse,
    _to_snapshot,
)

router = APIRouter(prefix="/api")


@router.post("/curve", response_model=CurveResponse)
def curve_endpoint(request: CurveRequest) -> CurveResponse:
    """Sample bootstrapped zero rates and discount factors on a 0.25Y tenor mesh."""
    points = pricing_service.sample_curve(_to_snapshot(request), request.interpolation_method)
    return CurveResponse(
        valuation_date=request.valuation_date,
        interpolation_method=request.interpolation_method,
        points=[
            CurvePointOut(
                tenor_years=p.tenor_years,
                zero_rate=p.zero_rate,
                discount_factor=p.discount_factor,
                is_knot=p.is_knot,
            )
            for p in points
        ],
    )


@router.post("/price", response_model=PriceResponse)
def price_endpoint(request: PriceRequest) -> PriceResponse:
    swap = VanillaSwap(
        tenor_years=request.swap.tenor_years,
        notional=request.swap.notional,
        fixed_rate=request.swap.fixed_rate,
        pay_fixed=request.swap.pay_fixed,
    )
    result = pricing_service.price(_to_snapshot(request), swap, request.interpolation_method)
    return PriceResponse(**result, interpolation_method=request.interpolation_method)
