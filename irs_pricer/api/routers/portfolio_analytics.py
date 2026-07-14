from __future__ import annotations

from datetime import date
from fastapi import APIRouter
from pydantic import BaseModel

from ..models import ParsedPositionOut, RateQuoteIn, _to_snapshot
from ...core.market_data import MarketSnapshot, RateQuote
from ...services import portfolio_analytics_service, market_data_service
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
    )


class PortfolioAnalyticsRequest(BaseModel):
    valuation_date: date
    cd_rate: float
    on_rate: float | None = None
    swap_quotes: list[RateQuoteIn]
    positions: list[ParsedPositionOut]


class PriorSnapshotRequest(PortfolioAnalyticsRequest):
    prior_valuation_date: date
    prior_cd_rate: float
    prior_on_rate: float | None = None
    prior_swap_quotes: list[RateQuoteIn]


class BookSummaryRequest(PortfolioAnalyticsRequest):
    daily_pnl_by_book: list[dict]


@router.post("/pvbp-sensitivity")
async def get_pvbp_sensitivity(request: PortfolioAnalyticsRequest) -> list[dict]:
    snapshot = _to_snapshot(request)
    fixings = market_data_service.load_fixings()
    positions = [_to_position_data(p) for p in request.positions]
    return portfolio_analytics_service.build_pvbp_sensitivity(positions, snapshot, fixings)


@router.post("/book-daily-pnl")
async def get_book_daily_pnl(request: PriorSnapshotRequest) -> list[dict]:
    snapshot = _to_snapshot(request)
    prior_snapshot = MarketSnapshot(
        valuation_date=request.prior_valuation_date,
        cd_rate=request.prior_cd_rate,
        on_rate=request.prior_on_rate,
        swap_quotes=[RateQuote(q.tenor_years, q.rate, q.tenor_months) for q in request.prior_swap_quotes],
    )
    fixings = market_data_service.load_fixings()
    positions = [_to_position_data(p) for p in request.positions]
    return portfolio_analytics_service.build_book_daily_pnl(positions, snapshot, prior_snapshot, fixings)


@router.post("/book-summary")
async def get_book_summary(request: BookSummaryRequest) -> list[dict]:
    snapshot = _to_snapshot(request)
    fixings = market_data_service.load_fixings()
    positions = [_to_position_data(p) for p in request.positions]
    return portfolio_analytics_service.build_book_summary(positions, request.daily_pnl_by_book, snapshot, fixings)
