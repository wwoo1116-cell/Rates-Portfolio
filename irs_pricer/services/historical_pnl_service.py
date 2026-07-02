"""
Historical PnL service: revalues a portfolio of booked swaps across every
historical business date in a window, producing a day-by-day NPV time series
plus cumulative PnL relative to a baseline date.

Unlike portfolio_service.price_portfolio() (which takes one MarketSnapshot for
a single valuation date), this module loads a *different* snapshot per date
internally via market_data_service, since each date in the window needs its
own market data.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from ..core.errors import NonBusinessDayError
from ..engine.instruments import VanillaSwap
from . import market_data_service
from .portfolio_service import price_portfolio


@dataclass
class PnlPoint:
    valuation_date: date
    net_npv: float
    payer_npv: float
    receiver_npv: float
    active_position_ids: list[str]
    cumulative_pnl: float  # net_npv - baseline_net_npv, filled in a second pass


@dataclass
class HistoricalPnlResult:
    baseline_date: date
    baseline_net_npv: float
    points: list[PnlPoint]
    skipped_dates: list[date] = field(default_factory=list)  # no active positions, or no usable market data


def _is_active(swap: VanillaSwap, valuation_date: date) -> bool:
    return swap.trade_date <= valuation_date <= swap.maturity_date


def compute_historical_pnl(
    positions: list[tuple[str, VanillaSwap]],
    start_date: date,
    end_date: date,
    baseline_date: date | None = None,
) -> HistoricalPnlResult:
    """Revalue `positions` on every business date in [start_date, end_date],
    filtering each date's active set to trade_date <= valuation_date <=
    maturity_date (a position not yet booked or already matured on a given
    date contributes nothing on that date -- this is correct portfolio
    behavior, not a limitation).

    A date with no active positions still gets a PnlPoint with net_npv=0.0
    -- that IS the correct NPV of an empty portfolio -- so the series stays
    date-complete over the window; such dates are also listed in
    skipped_dates.

    A date that list_available_dates() reports as available but that the KRX
    calendar rejects as a holiday (a rare raw-data anomaly, e.g. a stray
    year-end row) is handled differently: positions may genuinely be active
    that day, so net_npv=0.0 would be a *fabricated* value, not a correct
    one -- it previously produced a fake crash-to-zero-and-back in the
    series right around year boundaries. Such dates are OMITTED from
    `points` entirely (still recorded in skipped_dates) rather than
    zero-filled.
    """
    fixings = market_data_service.load_fixings()
    window_dates = [d for d in market_data_service.list_available_dates() if start_date <= d <= end_date]

    points: list[PnlPoint] = []
    skipped_dates: list[date] = []

    for valuation_date in window_dates:
        active = [(pid, swap) for pid, swap in positions if _is_active(swap, valuation_date)]

        if not active:
            points.append(PnlPoint(valuation_date, 0.0, 0.0, 0.0, [], cumulative_pnl=0.0))
            skipped_dates.append(valuation_date)
            continue

        try:
            snapshot = market_data_service.load_snapshot(valuation_date)
        except NonBusinessDayError:
            skipped_dates.append(valuation_date)
            continue

        result = price_portfolio(snapshot, active, fixings)
        points.append(
            PnlPoint(
                valuation_date=valuation_date,
                net_npv=result.net_npv,
                payer_npv=result.payer_npv,
                receiver_npv=result.receiver_npv,
                active_position_ids=[pid for pid, _ in active],
                cumulative_pnl=0.0,
            )
        )

    if not points:
        raise ValueError(f"조회 구간 [{start_date}, {end_date}]에 평가 가능한 날짜가 없습니다.")

    if baseline_date is None:
        baseline_date = points[0].valuation_date
        baseline_net_npv = points[0].net_npv
    else:
        try:
            baseline_net_npv = next(p.net_npv for p in points if p.valuation_date == baseline_date)
        except StopIteration:
            raise ValueError(f"기준일 {baseline_date}이(가) 조회 구간에 없거나 시장 데이터가 없습니다.") from None

    for p in points:
        p.cumulative_pnl = p.net_npv - baseline_net_npv

    return HistoricalPnlResult(
        baseline_date=baseline_date,
        baseline_net_npv=baseline_net_npv,
        points=points,
        skipped_dates=skipped_dates,
    )
