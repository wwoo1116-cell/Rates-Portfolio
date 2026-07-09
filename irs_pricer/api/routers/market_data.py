"""Market data endpoints: date-range index, snapshot lookup, live intraday update."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, HTTPException

from ...core.errors import NonBusinessDayError
from ...services import market_data_service
from ..models import DateRangeResponse, MarketDataResponse, RateQuoteIn, _to_snapshot

router = APIRouter(prefix="/api/market-data")


@router.get("/range", response_model=DateRangeResponse)
def market_data_range() -> DateRangeResponse:
    try:
        dates = market_data_service.list_available_dates()
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return DateRangeResponse(min_date=dates[0], max_date=dates[-1], available_dates=dates)


@router.post("/live", response_model=MarketDataResponse)
def update_live_market_data(request: MarketDataResponse) -> MarketDataResponse:
    """Push intraday RTD rates from data_updater.py (xlwings poller)."""
    market_data_service.update_live(_to_snapshot(request))
    return request


@router.get("/{valuation_date}", response_model=MarketDataResponse)
def get_market_data(valuation_date: date) -> MarketDataResponse:
    try:
        snapshot = market_data_service.load_snapshot(valuation_date)
    except NonBusinessDayError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return MarketDataResponse(
        valuation_date=snapshot.valuation_date,
        cd_rate=snapshot.cd_rate,
        on_rate=snapshot.on_rate,
        swap_quotes=[
            RateQuoteIn(tenor_years=q.tenor_years, rate=q.rate, tenor_months=q.tenor_months)
            for q in snapshot.swap_quotes
        ],
    )
