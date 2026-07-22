"""Calendar endpoints: KRX business-day lookup and tenor-date computation for the date picker."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, HTTPException, Query

from ...core.errors import NonBusinessDayError
from ...services import calendar_service
from ..models import NonBusinessDaysResponse, SpotDateResponse, TenorDateResponse

router = APIRouter(prefix="/api/calendar")


@router.get("/business-days", response_model=NonBusinessDaysResponse)
def non_business_days(start: date, end: date) -> NonBusinessDaysResponse:
    try:
        days = calendar_service.non_business_days(start, end)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return NonBusinessDaysResponse(non_business_days=days)


@router.get("/tenor-date", response_model=TenorDateResponse)
def tenor_date(
    start_date: date,
    months: int = Query(gt=0),
) -> TenorDateResponse:
    try:
        maturity = calendar_service.tenor_maturity_date(start_date, months)
    except NonBusinessDayError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return TenorDateResponse(maturity_date=maturity)


@router.get("/spot-date", response_model=SpotDateResponse)
def spot_date(valuation_date: date) -> SpotDateResponse:
    """valuation_date + settlement lag -- used to default a new position's
    시작일 to the standard spot-starting convention (see
    calendar_service.spot_date)."""
    try:
        result = calendar_service.spot_date(valuation_date)
    except NonBusinessDayError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return SpotDateResponse(spot_date=result)
