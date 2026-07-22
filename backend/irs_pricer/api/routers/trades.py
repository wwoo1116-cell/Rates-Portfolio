"""
Trade booking endpoints: backend persistence for booked IRS positions
(trade_specification), replacing the browser-localStorage-only store.
"""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...db.database import get_db
from ...db.models import TradeSpecification
from ...services import trade_service
from ..models import LegacyPositionImportRequest, TradeByTenorIn, TradeIn, TradeOut

router = APIRouter(prefix="/api/trades")


def _to_trade_out(trade: TradeSpecification) -> TradeOut:
    return TradeOut(
        trade_id=trade.trade_id,
        external_position_id=trade.external_position_id,
        trade_date=trade.trade_date,
        start_date=trade.start_date,
        maturity_date=trade.maturity_date,
        tenor_months=trade.tenor_months,
        notional=float(trade.notional),
        fixed_rate=float(trade.fixed_rate),
        pay_fixed=trade.pay_fixed,
        float_spread=float(trade.float_spread),
        float_index=trade.float_index,
        status=trade.status.value,
        book=trade.book,
        ticker=trade.ticker,
    )


@router.get("", response_model=list[TradeOut])
def list_trades(as_of_date: date | None = None, db: Session = Depends(get_db)) -> list[TradeOut]:
    trades = trade_service.list_active_trades(db, as_of_date)
    return [_to_trade_out(t) for t in trades]


@router.post("", response_model=TradeOut)
def book_trade(request: TradeIn, db: Session = Depends(get_db)) -> TradeOut:
    try:
        trade = trade_service.book_trade_explicit(
            db,
            position_id=request.position_id,
            start_date=request.start_date,
            maturity_date=request.maturity_date,
            notional=request.notional,
            fixed_rate=request.fixed_rate,
            pay_fixed=request.pay_fixed,
            float_spread=request.float_spread,
            book=request.book,
            ticker=request.ticker,
        )
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e.orig)) from e
    return _to_trade_out(trade)


@router.post("/by-tenor", response_model=TradeOut)
def book_trade_by_tenor(request: TradeByTenorIn, db: Session = Depends(get_db)) -> TradeOut:
    try:
        trade = trade_service.book_trade_by_tenor(
            db,
            position_id=request.position_id,
            trade_date=request.trade_date,
            tenor_months=request.tenor_months,
            notional=request.notional,
            fixed_rate=request.fixed_rate,
            pay_fixed=request.pay_fixed,
            float_spread=request.float_spread,
            book=request.book,
            ticker=request.ticker,
        )
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e.orig)) from e
    return _to_trade_out(trade)


@router.delete("/{trade_id}", response_model=TradeOut)
def cancel_trade(trade_id: int, db: Session = Depends(get_db)) -> TradeOut:
    """Soft delete -- flips status to CANCELLED, never removes the row (its
    npv_pnl_trace history, if any, must stay auditable)."""
    trade = trade_service.cancel_trade(db, trade_id)
    if trade is None:
        raise HTTPException(status_code=404, detail=f"거래 ID {trade_id}를 찾을 수 없습니다.")
    return _to_trade_out(trade)


@router.post("/import-legacy", response_model=list[TradeOut])
def import_legacy(request: LegacyPositionImportRequest, db: Session = Depends(get_db)) -> list[TradeOut]:
    """One-time bulk import from browser localStorage (blueprint C.4).
    Idempotent -- already-imported position_ids are returned as-is."""
    positions = [p.model_dump() for p in request.positions]
    try:
        trades = trade_service.import_legacy_trades(db, positions)
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e.orig)) from e
    return [_to_trade_out(t) for t in trades]
