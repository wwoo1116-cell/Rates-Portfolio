"""NPV/PnL trace endpoint: daily mark of a single ad-hoc swap spec, for the
backtest trade-detail panel's "what would this trade have actually earned"
view."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ...db.database import get_db
from ...engine.instruments import VanillaSwap
from ...services import mtm_service
from ...services.npv_trace_service import compute_npv_trace, compute_npv_trace_for_trade
from ..models import NpvTracePointOut, NpvTraceRequest, NpvTraceResponse

router = APIRouter(prefix="/api/mtm")


@router.post("/npv-trace", response_model=NpvTraceResponse)
def npv_trace_endpoint(request: NpvTraceRequest) -> NpvTraceResponse:
    # Prefer the exact maturity_date supplied by the frontend (e.g. from the
    # trade's own maturity_date field); fall back to relativedelta rounding
    # only when it's absent (e.g. pure-tenor what-if from the spec form).
    maturity_date = request.swap.maturity_date or mtm_service.trade_maturity_date(
        request.swap.trade_date, int(round(request.swap.tenor_years))
    )
    swap = VanillaSwap(
        tenor_years=request.swap.tenor_years,
        notional=request.swap.notional,
        fixed_rate=request.swap.fixed_rate,
        pay_fixed=request.swap.pay_fixed,
        float_spread=request.swap.float_spread,
        trade_date=request.swap.trade_date,
        maturity_date=maturity_date,
    )
    try:
        result = compute_npv_trace(swap, request.start_date, request.end_date)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    return NpvTraceResponse(
        trade_date=result.trade_date,
        maturity_date=result.maturity_date,
        entry_npv=result.entry_npv,
        points=[NpvTracePointOut(**vars(p)) for p in result.points],
        skipped_dates=result.skipped_dates,
    )


@router.get("/npv-trace/{trade_id}", response_model=NpvTraceResponse)
def npv_trace_for_trade_endpoint(
    trade_id: int, start_date: date, end_date: date, db: Session = Depends(get_db)
) -> NpvTraceResponse:
    """Cached trace for a booked trade_specification row -- reads/writes
    npv_pnl_trace instead of always recomputing (see compute_npv_trace_for_trade)."""
    try:
        result = compute_npv_trace_for_trade(db, trade_id, start_date, end_date)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    return NpvTraceResponse(
        trade_date=result.trade_date,
        maturity_date=result.maturity_date,
        entry_npv=result.entry_npv,
        points=[NpvTracePointOut(**vars(p)) for p in result.points],
        skipped_dates=result.skipped_dates,
    )
