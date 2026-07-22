"""
Trade repository: persists booked IRS positions in trade_specification --
the backend replacement for the browser-localStorage-only position store
(web/src/pages/PortfolioPage.jsx's POSITIONS_STORAGE_KEY).

No hard deletes anywhere here (blueprint B.2): cancel() only flips `status`
to CANCELLED. A trade with any npv_pnl_trace history is structurally
protected from deletion by the FK's ON DELETE RESTRICT on the DB side too.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import TradeSpecification, TradeStatus


def create(
    db: Session,
    *,
    external_position_id: str,
    trade_date: date,
    start_date: date,
    maturity_date: date,
    notional: float,
    fixed_rate: float,
    pay_fixed: bool,
    float_spread: float = 0.0,
    tenor_months: int | None = None,
    float_index: str = "CD91D",
    book: str | None = None,
    ticker: str | None = None,
) -> TradeSpecification:
    trade = TradeSpecification(
        external_position_id=external_position_id,
        trade_date=trade_date,
        start_date=start_date,
        maturity_date=maturity_date,
        tenor_months=tenor_months,
        notional=notional,
        fixed_rate=fixed_rate,
        pay_fixed=pay_fixed,
        float_spread=float_spread,
        float_index=float_index,
        book=book,
        ticker=ticker,
    )
    db.add(trade)
    db.commit()
    db.refresh(trade)
    return trade


def get(db: Session, trade_id: int) -> TradeSpecification | None:
    return db.get(TradeSpecification, trade_id)


def get_by_external_id(db: Session, external_position_id: str) -> TradeSpecification | None:
    return db.execute(
        select(TradeSpecification).where(
            TradeSpecification.external_position_id == external_position_id
        )
    ).scalar_one_or_none()


def list_active(db: Session, as_of_date: date | None = None) -> list[TradeSpecification]:
    """ACTIVE trades, optionally narrowed to those still alive as of a given
    date (maturity_date >= as_of_date) -- e.g. for portfolio aggregation on a
    historical valuation_date."""
    stmt = select(TradeSpecification).where(TradeSpecification.status == TradeStatus.ACTIVE)
    if as_of_date is not None:
        stmt = stmt.where(TradeSpecification.maturity_date >= as_of_date)
    return list(db.execute(stmt.order_by(TradeSpecification.trade_date)).scalars().all())


def cancel(db: Session, trade_id: int) -> TradeSpecification | None:
    """Soft delete: status -> CANCELLED. Trace history is untouched and stays queryable."""
    trade = db.get(TradeSpecification, trade_id)
    if trade is None:
        return None
    trade.status = TradeStatus.CANCELLED
    db.commit()
    db.refresh(trade)
    return trade


def import_legacy(
    db: Session,
    positions: list[dict],
) -> list[TradeSpecification]:
    """One-time bulk import from browser localStorage (blueprint C.4). Each
    dict has the PortfolioPositionIn shape: position_id, start_date,
    maturity_date, notional, fixed_rate, pay_fixed, float_spread.
    tenor_months is left NULL -- these were booked via explicit dates, not a
    tenor. Idempotent: re-running with the same position_id list is safe,
    already-imported trades are returned as-is rather than duplicated."""
    imported: list[TradeSpecification] = []
    for pos in positions:
        existing = get_by_external_id(db, pos["position_id"])
        if existing is not None:
            imported.append(existing)
            continue
        trade = create(
            db,
            external_position_id=pos["position_id"],
            trade_date=pos["start_date"],
            start_date=pos["start_date"],
            maturity_date=pos["maturity_date"],
            notional=pos["notional"],
            fixed_rate=pos["fixed_rate"],
            pay_fixed=pos["pay_fixed"],
            float_spread=pos.get("float_spread", 0.0),
        )
        imported.append(trade)
    return imported
