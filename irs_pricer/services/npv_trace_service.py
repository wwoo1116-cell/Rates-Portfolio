"""
NPV/PnL trace service: revalues a single ad-hoc (not necessarily booked)
VanillaSwap across every historical business date in [start_date, end_date],
producing a day-by-day clean/dirty NPV series plus cumulative PnL vs the
swap's own entry-date NPV.

Sibling to historical_pnl_service.compute_historical_pnl() -- same per-date
snapshot-then-revalue loop -- but for one spec-only swap coming from a UI
form (e.g. the backtest trade-detail panel) rather than a list of booked
portfolio positions tracked by position_id.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from sqlalchemy.orm import Session

from ..core.errors import NonBusinessDayError
from ..db import trace_repository, trade_repository
# QuantLib dependencies removed
from ..engine.curve import build_curve
from ..engine.instruments import VanillaSwap
from ..engine.mtm_valuation import value_booked_trade
from . import market_data_service, mtm_service


@dataclass
class NpvTracePoint:
    valuation_date: date
    clean_npv: float
    dirty_npv: float
    daily_pnl: float
    cumulative_pnl: float  # clean_npv - entry_npv, filled in a second pass
    delta: float = 0.0


@dataclass
class NpvTraceResult:
    trade_date: date
    maturity_date: date
    entry_npv: float
    points: list[NpvTracePoint] = field(default_factory=list)
    skipped_dates: list[date] = field(default_factory=list)


def compute_npv_trace(swap: VanillaSwap, start_date: date, end_date: date) -> NpvTraceResult:
    """Revalue `swap` on every business date in [start_date, end_date] that
    also falls within [trade_date, maturity_date] -- a date outside the
    swap's own life has no meaningful NPV and is silently excluded rather
    than zero-filled (unlike historical_pnl_service's empty-portfolio case,
    there's no "correct" NPV for a swap that doesn't exist yet on that date).

    entry_npv is the swap's own clean_npv on the first valued date, used as
    the PnL baseline -- NOT assumed to be zero, since a real booked trade or
    a form-entered fixed_rate off the fair rate has a genuine nonzero entry
    mark.
    """
    if swap.trade_date is None or swap.maturity_date is None:
        raise ValueError("NPV trace를 계산하려면 거래일과 만기일이 모두 필요합니다.")

    fixings = market_data_service.load_fixings()
    window_dates = [
        d
        for d in market_data_service.list_available_dates()
        if start_date <= d <= end_date and swap.trade_date <= d <= swap.maturity_date
    ]

    points: list[NpvTracePoint] = []
    skipped_dates: list[date] = []
    prev_result = None
    prev_dirty_npv: float | None = None
    cumulative_cashflows = 0.0

    for valuation_date in window_dates:
        try:
            snapshot = market_data_service.load_snapshot(valuation_date)
        except NonBusinessDayError:
            skipped_dates.append(valuation_date)
            continue

        curve = build_curve(snapshot)
        
        current_float_rate = None
        if fixings:
            # We can use the fixing before or on valuation_date
            past_fixings = {k: v for k, v in fixings.items() if k <= valuation_date}
            if past_fixings:
                current_float_rate = past_fixings[max(past_fixings.keys())]
                
        result = value_booked_trade(swap, curve, current_float_rate)
        # DV01 (Fixed Leg BPS): computed directly from the already-evaluated
        # fixed leg PV to avoid QuantLib 2nd-leg missing fixing errors (which
        # occur when .fixedLegBPS() forces a full swap calculation). At
        # fixed_rate == 0, pv_fixed_leg is also 0 (fixed leg PV scales
        # linearly with the rate), so this is a 0/0 rather than a genuine
        # zero-sensitivity swap -- reported as 0.0 since the annuity-based
        # BPS isn't cheaply available here.
        delta_val = result.pv_fixed_leg / (swap.fixed_rate * 10000.0) if swap.fixed_rate != 0 else 0.0

        if prev_result is not None:
            # Add any cashflows that paid out between prev_date and valuation_date
            for cf in prev_result.cashflows:
                if cf.payment_date <= valuation_date:
                    amt = cf.cashflow or 0.0
                    if cf.leg == "fixed":
                        sign = -1.0 if swap.pay_fixed else 1.0
                    else:
                        sign = 1.0 if swap.pay_fixed else -1.0
                    cumulative_cashflows += sign * amt

        total_value = result.dirty_npv + cumulative_cashflows
        prev_total = prev_dirty_npv if prev_dirty_npv is not None else result.dirty_npv
        daily_pnl = total_value - prev_total

        points.append(
            NpvTracePoint(
                valuation_date=valuation_date,
                clean_npv=result.clean_npv,
                dirty_npv=result.dirty_npv,
                daily_pnl=daily_pnl,
                cumulative_pnl=0.0,
                delta=delta_val,
            )
        )
        prev_result = result
        prev_dirty_npv = total_value

    if not points:
        raise ValueError(f"조회 구간 [{start_date}, {end_date}]에 평가 가능한 날짜가 없습니다.")

    entry_npv = points[0].dirty_npv
    for p in points:
        # cumulative_pnl will be filled by tracking the sum of daily_pnl
        pass
    
    # Fill cumulative PnL
    cum_pnl = 0.0
    for p in points:
        cum_pnl += p.daily_pnl
        p.cumulative_pnl = cum_pnl

    return NpvTraceResult(
        trade_date=swap.trade_date,
        maturity_date=swap.maturity_date,
        entry_npv=entry_npv,
        points=points,
        skipped_dates=skipped_dates,
    )


def compute_npv_trace_for_trade(
    db: Session, trade_id: int, start_date: date, end_date: date
) -> NpvTraceResult:
    """Read-through/cache-aside version of compute_npv_trace() for a booked
    trade_specification row (blueprint D.1).

    Reuses persisted clean_npv/dirty_npv -- the expensive part, one
    QuantLib curve build + swap valuation per date -- for any date already in
    npv_pnl_trace, and only calls mtm_service.value_trade() for genuinely new
    dates (typically just "today" for a trade queried before, or the whole
    window for a brand-new one).

    daily_pnl/cumulative_pnl are cheap pure arithmetic, so they're always
    recomputed fresh over *this* query's window -- matching
    compute_npv_trace()'s existing semantics, where entry_npv is the first
    point in *this* window rather than a trade-wide constant -- and
    re-upserted every call. That means if two different start_dates are ever
    queried for the same trade, whichever query ran most recently "wins" for
    the derived daily_pnl/cumulative_pnl on any overlapping date; clean_npv/
    dirty_npv (what the cache actually exists to save) never change either way.
    """
    trade = trade_repository.get(db, trade_id)
    if trade is None:
        raise ValueError(f"거래 ID {trade_id}를 찾을 수 없습니다.")

    nominal_tenor_years = max(1, round((trade.maturity_date - trade.trade_date).days / 365))
    swap = VanillaSwap(
        tenor_years=nominal_tenor_years,  # unused for schedule generation once maturity_date is set below
        notional=float(trade.notional),
        fixed_rate=float(trade.fixed_rate),
        pay_fixed=trade.pay_fixed,
        float_spread=float(trade.float_spread),
        trade_date=trade.trade_date,
        maturity_date=trade.maturity_date,
    )

    fixings = market_data_service.load_fixings()
    window_dates = [
        d
        for d in market_data_service.list_available_dates()
        if start_date <= d <= end_date and swap.trade_date <= d <= swap.maturity_date
    ]

    cached = {
        p.valuation_date: p for p in trace_repository.get_points(db, trade_id, start_date, end_date)
    }

    points: list[NpvTracePoint] = []
    skipped_dates: list[date] = []
    prev_npv: float | None = None

    for valuation_date in window_dates:
        cached_point = cached.get(valuation_date)
        if cached_point is not None:
            clean_npv, dirty_npv = float(cached_point.clean_npv), float(cached_point.dirty_npv)
        else:
            try:
                snapshot = market_data_service.load_snapshot(valuation_date)
            except NonBusinessDayError:
                skipped_dates.append(valuation_date)
                continue
            result = mtm_service.value_trade(snapshot, swap, fixings)
            clean_npv, dirty_npv = result.clean_npv, result.dirty_npv

        daily_pnl = 0.0 if prev_npv is None else clean_npv - prev_npv
        points.append(
            NpvTracePoint(
                valuation_date=valuation_date,
                clean_npv=clean_npv,
                dirty_npv=dirty_npv,
                daily_pnl=daily_pnl,
                cumulative_pnl=0.0,
            )
        )
        prev_npv = clean_npv

    if not points:
        raise ValueError(f"조회 구간 [{start_date}, {end_date}]에 평가 가능한 날짜가 없습니다.")

    entry_npv = points[0].clean_npv
    upsert_rows = []
    for p in points:
        p.cumulative_pnl = p.clean_npv - entry_npv
        upsert_rows.append(
            {
                "valuation_date": p.valuation_date,
                "clean_npv": p.clean_npv,
                "dirty_npv": p.dirty_npv,
                "daily_pnl": p.daily_pnl,
                "cumulative_pnl": p.cumulative_pnl,
            }
        )
    trace_repository.upsert_points(db, trade_id, upsert_rows)

    return NpvTraceResult(
        trade_date=swap.trade_date,
        maturity_date=swap.maturity_date,
        entry_npv=entry_npv,
        points=points,
        skipped_dates=skipped_dates,
    )
