"""Portfolio pricing endpoint: prices N booked swaps against one shared curve."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, HTTPException, Query

from ...core.errors import NonBusinessDayError
from ...engine.instruments import VanillaSwap
from ...services import portfolio_service
from ..models import (
    HistoricalQuoteResponse,
    PortfolioCashFlowOut,
    PortfolioPriceRequest,
    PortfolioPriceResponse,
    PositionFairRateRequest,
    PositionFairRateResponse,
    PositionResultOut,
    _to_snapshot,
)

router = APIRouter(prefix="/api/portfolio")


@router.post("/fair-rate", response_model=PositionFairRateResponse)
def position_fair_rate_endpoint(request: PositionFairRateRequest) -> PositionFairRateResponse:
    """The forward par rate for one position's exact start/maturity schedule,
    priced off TODAY's valuation curve (request.valuation_date/cd_rate/
    swap_quotes -- the same snapshot /api/portfolio/price uses) -- i.e. the
    rate at which this position could be dealt right now, however far
    forward start_date is. NOT the curve's raw quoted tenor rate (see
    engine/mtm_valuation.py:fair_rate_for_schedule for why).

    Must load the same real historical fixings /price uses: if the position's
    first floating reset date already has a known CD91D fixing, that period
    is priced off the actual historical print, not a forward estimate --
    computing the "par" rate without it does not zero the NPV that /price
    will actually return.
    """
    from ...services.market_data_service import load_fixings
    fixings = load_fixings()
    fair_rate = portfolio_service.position_fair_rate(
        _to_snapshot(request),
        request.start_date,
        request.maturity_date,
        request.notional,
        request.float_spread,
        fixings,
    )
    return PositionFairRateResponse(fair_rate=fair_rate)


@router.get("/historical-quote", response_model=HistoricalQuoteResponse)
def historical_quote_endpoint(
    start_date: date,
    maturity_date: date,
    notional: float = Query(gt=0),
    float_spread: float = 0.0,
) -> HistoricalQuoteResponse:
    """The historical spot par rate quoted ON start_date itself -- loads
    THAT day's own market snapshot and sets the QuantLib evaluation date to
    start_date, never today's. Answers "what did this schedule actually
    trade at back then", the opposite question from /fair-rate (which always
    prices off today's curve). See portfolio_service.historical_spot_rate.
    """
    try:
        rate = portfolio_service.historical_spot_rate(start_date, maturity_date, notional, float_spread)
    except NonBusinessDayError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return HistoricalQuoteResponse(historical_rate=rate)


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
    result = portfolio_service.price_portfolio(_to_snapshot(request), positions, fixings)
    return PortfolioPriceResponse(
        net_npv=result.net_npv,
        payer_npv=result.payer_npv,
        receiver_npv=result.receiver_npv,
        position_results=[PositionResultOut(**vars(p)) for p in result.position_results],
        cashflows=[
            PortfolioCashFlowOut(position_id=pcf.position_id, **vars(pcf.detail)) for pcf in result.cashflows
        ],
    )
