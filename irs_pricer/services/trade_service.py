"""
Trade booking service: orchestrates trade_repository + calendar_service so
routers never touch date-rolling or persistence directly.

Two booking conventions coexist in the wider app today (blueprint A.3) --
explicit start/maturity dates (the existing portfolio position flow,
web/src/pages/PortfolioPage.jsx) and trade_date+tenor (the single-swap
pricer/MTM/npv-trace flow). Both are supported here; either way,
maturity_date ends up as the one authoritative value every downstream
pricing/MTM call actually uses.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from ..db import trade_repository
from ..db.models import TradeSpecification
from . import calendar_service


def book_trade_explicit(
    db: Session,
    *,
    position_id: str,
    start_date: date,
    maturity_date: date,
    notional: float,
    fixed_rate: float,
    pay_fixed: bool,
    float_spread: float = 0.0,
) -> TradeSpecification:
    """Explicit-date booking -- mirrors PortfolioPositionIn exactly. tenor_months
    stays NULL: this trade wasn't booked from a tenor, so there's no
    provenance value to record."""
    return trade_repository.create(
        db,
        external_position_id=position_id,
        trade_date=start_date,
        start_date=start_date,
        maturity_date=maturity_date,
        notional=notional,
        fixed_rate=fixed_rate,
        pay_fixed=pay_fixed,
        float_spread=float_spread,
    )


def book_trade_by_tenor(
    db: Session,
    *,
    position_id: str,
    trade_date: date,
    tenor_months: int,
    notional: float,
    fixed_rate: float,
    pay_fixed: bool,
    float_spread: float = 0.0,
) -> TradeSpecification:
    """Tenor-based booking -- start_date is the spot date off trade_date
    (calendar_service.spot_date, same T+1 lag build_curve() uses), maturity_date
    is start_date rolled forward by tenor_months under the same
    ModifiedFollowing convention schedule generation uses
    (calendar_service.tenor_maturity_date) -- so a 6M/9M/18M trade booked this
    way lands on exactly the date the engine would itself compute."""
    start_date = calendar_service.spot_date(trade_date)
    maturity_date = calendar_service.tenor_maturity_date(start_date, tenor_months)
    return trade_repository.create(
        db,
        external_position_id=position_id,
        trade_date=trade_date,
        start_date=start_date,
        maturity_date=maturity_date,
        tenor_months=tenor_months,
        notional=notional,
        fixed_rate=fixed_rate,
        pay_fixed=pay_fixed,
        float_spread=float_spread,
    )


def list_active_trades(db: Session, as_of_date: date | None = None) -> list[TradeSpecification]:
    return trade_repository.list_active(db, as_of_date)


def get_trade(db: Session, trade_id: int) -> TradeSpecification | None:
    return trade_repository.get(db, trade_id)


def cancel_trade(db: Session, trade_id: int) -> TradeSpecification | None:
    return trade_repository.cancel(db, trade_id)


def import_legacy_trades(db: Session, positions: list[dict]) -> list[TradeSpecification]:
    return trade_repository.import_legacy(db, positions)
