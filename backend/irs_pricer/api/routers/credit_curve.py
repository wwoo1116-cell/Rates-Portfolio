"""Credit-curve endpoints: the instrument taxonomy tree for the RV selector
and a batch time-series fetch for credit_matrix-backed legs."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ...services import credit_curve_service
from ..models import (
    CreditSeriesPointOut,
    CreditSeriesRequest,
    CreditSeriesResponse,
    CreditSeriesResultOut,
    InstrumentTaxonomyOut,
    TaxonomySectorOut,
)

router = APIRouter(prefix="/api/credit-curve")


@router.get("/taxonomy", response_model=InstrumentTaxonomyOut)
def credit_taxonomy_endpoint() -> InstrumentTaxonomyOut:
    """Sector -> ratings -> tenors tree for the 3-tier instrument selector.
    Static (no file I/O). IRS/국고채 have empty ratings (frontend auto-fills
    N/A and skips the rating step)."""
    tree = credit_curve_service.get_taxonomy()
    return InstrumentTaxonomyOut(
        sectors=[TaxonomySectorOut(**s) for s in tree["sectors"]]
    )


@router.post("/series", response_model=CreditSeriesResponse)
def credit_series_endpoint(request: CreditSeriesRequest) -> CreditSeriesResponse:
    """Batch fetch of credit_matrix-backed (sector, rating, tenor) legs in one
    call -- one result per requested leg, in the same order. A leg that can't
    resolve (unknown sector/rating/tenor, or an IRS leg that belongs to
    /api/rate-history) comes back with empty points and an `error` string
    rather than failing the whole batch, so one bad leg never blanks a
    multi-series chart."""
    if request.start_date and request.end_date and request.start_date > request.end_date:
        raise HTTPException(status_code=400, detail="start_date는 end_date보다 이후일 수 없습니다.")

    results: list[CreditSeriesResultOut] = []
    for leg in request.legs:
        try:
            series = credit_curve_service.get_series(
                sector=leg.sector,
                rating=leg.rating,
                tenor=leg.tenor,
                start_date=request.start_date,
                end_date=request.end_date,
            )
            results.append(
                CreditSeriesResultOut(
                    sector=leg.sector,
                    rating=leg.rating,
                    tenor=leg.tenor,
                    points=[CreditSeriesPointOut(**p) for p in series],
                )
            )
        except ValueError as exc:
            results.append(
                CreditSeriesResultOut(
                    sector=leg.sector,
                    rating=leg.rating,
                    tenor=leg.tenor,
                    points=[],
                    error=str(exc),
                )
            )
    return CreditSeriesResponse(results=results)
