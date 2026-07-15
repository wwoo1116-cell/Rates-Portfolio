from __future__ import annotations

from datetime import date
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..models import (
    AllocationHistoryRequest,
    DecimalRate,
    ParsedPositionOut,
    RateQuoteIn,
    _to_snapshot,
)
from ...core.market_data import MarketSnapshot, RateQuote
from ...services import allocation_history_service, portfolio_analytics_service, market_data_service
from ...services.allocation_history_service import BondSnapshotInput
from ...services.portfolio_analytics_service import PositionData

router = APIRouter(prefix="/api/portfolio")


def _to_position_data(p: ParsedPositionOut) -> PositionData:
    return PositionData(
        instrument_type=p.instrument_type,
        position_id=p.position_id,
        sector=p.sector,
        book=p.book,
        start_date=p.start_date,
        maturity_date=p.maturity_date,
        notional=p.notional,
        fixed_rate=p.fixed_rate,
        pay_fixed=p.pay_fixed,
        float_spread=p.float_spread,
        evaluation_amount=p.evaluation_amount,
        remaining_days=p.remaining_days,
        tenor_bucket=p.tenor_bucket,
        entry_yield=p.entry_yield,
        mtm_yield=p.mtm_yield,
        duration=p.duration,
        pvbp=p.pvbp,
        issue_date=p.issue_date,
        coupon_rate=p.coupon_rate,
        payment_frequency=p.payment_frequency,
        rating=p.rating,
    )


class PortfolioAnalyticsRequest(BaseModel):
    valuation_date: date
    cd_rate: DecimalRate
    on_rate: DecimalRate | None = None
    swap_quotes: list[RateQuoteIn]
    positions: list[ParsedPositionOut]
    # Funding rate 가정 = BOK 기준금리 + funding_spread_bp. 기본 +10bp; 대시보드
    # Settings에서 조정한 값이 book-daily-pnl 요청에 실려 온다. 기본값이 있으므로
    # 이 필드를 보내지 않는 기존 호출과도 하위호환.
    # bp 단위이므로 DecimalRate(소수 금리) 제약 대상이 아니다.
    funding_spread_bp: float = 10.0


class PriorSnapshotRequest(PortfolioAnalyticsRequest):
    prior_valuation_date: date
    prior_cd_rate: DecimalRate
    prior_on_rate: DecimalRate | None = None
    prior_swap_quotes: list[RateQuoteIn]


class BookSummaryRequest(PortfolioAnalyticsRequest):
    # Optional and unused. build_book_summary never read it, but the field is
    # kept (rather than deleted outright) so a client still sending it gets a
    # 200 instead of a 422 during rollout. Remove once no client sends it.
    daily_pnl_by_book: list[dict] = []


# NOTE ON `def` vs `async def` -- these three were the only `async def` handlers
# in the API, and the only ones doing heavy synchronous CPU work. That
# combination is the worst case: FastAPI runs an `async def` handler directly
# on the event loop, so ~18s of numpy/pricing per dashboard load blocked the
# loop outright -- no other request could be served while a panel computed, and
# the three panels couldn't even overlap each other. Declaring them `def` hands
# them to the threadpool, which is what the other 14 routers already do and why
# only these panels hung. Do not "modernise" these back to `async def` unless
# the body actually awaits something.
@router.post("/pvbp-sensitivity")
def get_pvbp_sensitivity(request: PortfolioAnalyticsRequest) -> list[dict]:
    snapshot = _to_snapshot(request)
    positions = [_to_position_data(p) for p in request.positions]
    # Same ValueError -> 400 contract the other routers use (see
    # historical_pnl.py, bond_cashflows.py): an unknown sector/rating or a
    # missing data row is bad input, not a server fault. Without this it
    # escapes every handler in app.py as a CORS-less 500, which the browser
    # then misreports as a CORS failure.
    try:
        fixings = market_data_service.load_fixings()
        return portfolio_analytics_service.build_pvbp_sensitivity(positions, snapshot, fixings)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/book-daily-pnl")
def get_book_daily_pnl(request: PriorSnapshotRequest) -> list[dict]:
    snapshot = _to_snapshot(request)
    prior_snapshot = MarketSnapshot(
        valuation_date=request.prior_valuation_date,
        cd_rate=request.prior_cd_rate,
        on_rate=request.prior_on_rate,
        swap_quotes=[RateQuote(q.tenor_years, q.rate, q.tenor_months) for q in request.prior_swap_quotes],
    )
    positions = [_to_position_data(p) for p in request.positions]
    try:
        fixings = market_data_service.load_fixings()
        return portfolio_analytics_service.build_book_daily_pnl(
            positions, snapshot, prior_snapshot, fixings, request.funding_spread_bp
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/book-summary")
def get_book_summary(request: BookSummaryRequest) -> list[dict]:
    snapshot = _to_snapshot(request)
    positions = [_to_position_data(p) for p in request.positions]
    try:
        fixings = market_data_service.load_fixings()
        return portfolio_analytics_service.build_book_summary(positions, snapshot, fixings)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


# Bond-only and snapshot-free: it loads each date's market data itself via
# market_data_service, so unlike the three handlers above it takes no curve in
# the request body. `def` for the same threadpool reason -- it prices the book
# five times over.
@router.post("/allocation-history")
def get_allocation_history(request: AllocationHistoryRequest) -> dict:
    positions = [
        BondSnapshotInput(
            position_id=p.position_id,
            book=p.book,
            sector=p.sector,
            rating=p.rating,
            issue_date=p.issue_date,
            maturity_date=p.maturity_date,
            coupon_rate=p.coupon_rate,
            payment_frequency=p.payment_frequency,
            notional=p.notional,
        )
        for p in request.positions
    ]
    try:
        return allocation_history_service.build_allocation_history(
            positions, book=request.book, as_of_date=request.as_of_date
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
