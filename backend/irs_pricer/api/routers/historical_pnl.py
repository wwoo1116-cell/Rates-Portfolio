"""Historical PnL endpoint: revalues a booked-swap portfolio across a past date window."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ...db.database import get_db
from ...engine.instruments import VanillaSwap
from ...services.historical_pnl_service import compute_historical_pnl, compute_historical_pnl_for_trades
from ..models import HistoricalPnlByTradesRequest, HistoricalPnlRequest, HistoricalPnlResponse, PnlPointOut

router = APIRouter(prefix="/api/portfolio")


@router.post("/historical-pnl", response_model=HistoricalPnlResponse)
def historical_pnl_endpoint(request: HistoricalPnlRequest) -> HistoricalPnlResponse:
    """Revalue every position across [start_date, end_date] business dates;
    return the daily NPV series plus cumulative PnL vs. a baseline date."""
    positions = [
        (
            p.position_id,
            VanillaSwap(
                tenor_years=0,  # unused: maturity_date is set, so value_booked_trade() ignores it
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
    try:
        result = compute_historical_pnl(positions, request.start_date, request.end_date, request.baseline_date)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    return HistoricalPnlResponse(
        baseline_date=result.baseline_date,
        baseline_net_npv=result.baseline_net_npv,
        points=[PnlPointOut(**vars(p)) for p in result.points],
        skipped_dates=result.skipped_dates,
    )


@router.post("/historical-pnl/by-trades", response_model=HistoricalPnlResponse)
def historical_pnl_by_trades_endpoint(
    request: HistoricalPnlByTradesRequest, db: Session = Depends(get_db)
) -> HistoricalPnlResponse:
    """Cached variant -- references booked trade_specification rows by ID
    instead of carrying full position specs inline (see
    compute_historical_pnl_for_trades)."""
    try:
        result = compute_historical_pnl_for_trades(
            db, request.trade_ids, request.start_date, request.end_date, request.baseline_date
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    return HistoricalPnlResponse(
        baseline_date=result.baseline_date,
        baseline_net_npv=result.baseline_net_npv,
        points=[PnlPointOut(**vars(p)) for p in result.points],
        skipped_dates=result.skipped_dates,
    )
