"""Rate history endpoint: daily CD91D/O-N/BOK-base/IRS-tenor series for the Overview/RV dashboard."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, HTTPException

from ...services.rate_history_service import get_rate_history, get_rate_spread
from ..models import RateHistoryPointOut, RateHistoryResponse, RateSpreadResponse, SpreadPointOut

router = APIRouter(prefix="/api/rate-history")


@router.get("", response_model=RateHistoryResponse)
def rate_history_endpoint(start: date, end: date) -> RateHistoryResponse:
    """Daily rate series in [start, end]. tenor_rates carries every tenor
    label present in True Data.xlsx that day (6M, 9M, 1Y, 1.5Y, 2Y..30Y) --
    the frontend picks which tenors/spreads to plot, nothing is filtered
    server-side."""
    if start > end:
        raise HTTPException(status_code=400, detail="start는 end보다 이후일 수 없습니다.")
    points = get_rate_history(start, end)
    return RateHistoryResponse(
        points=[
            RateHistoryPointOut(
                valuation_date=p.valuation_date,
                cd_rate=p.cd_rate,
                on_rate=p.on_rate,
                base_rate=p.base_rate,
                tenor_rates=p.tenor_rates,
            )
            for p in points
        ]
    )


@router.get("/spread", response_model=RateSpreadResponse)
def rate_spread_endpoint(start: date, end: date, short: str, long: str) -> RateSpreadResponse:
    """(long - short) spread in bp, e.g. short=1Y&long=3Y for "1s3s". Labels
    are anything get_rate_history's tenor_rates carries, plus 'cd_rate'/
    'on_rate' for the curve's short end."""
    if start > end:
        raise HTTPException(status_code=400, detail="start는 end보다 이후일 수 없습니다.")
    points = get_rate_spread(start, end, short, long)
    return RateSpreadResponse(
        short=short,
        long=long,
        points=[SpreadPointOut(valuation_date=p.valuation_date, spread_bp=p.spread_bp) for p in points],
    )
