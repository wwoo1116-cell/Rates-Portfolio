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
from ..core.market_data import MarketSnapshot, RateQuote
from ..db import trace_repository, trade_repository
# QuantLib dependencies removed
from ..engine.curve import build_curve
from ..engine.fixings import FixingResolution, dedupe_data_quality_events
from ..engine.instruments import VanillaSwap
from ..engine.mtm_valuation import value_booked_trade
from . import market_data_service, mtm_service

import logging

logger = logging.getLogger(__name__)

# Single-sided +1bp parallel par bump -- the same definition risk.py /
# quant_engine.compute_irs_pvbp declare (SHIFT = 0.0001, forward difference).
_DV01_SHIFT_DECIMAL = 1e-4


def _parallel_bumped(snapshot: MarketSnapshot) -> MarketSnapshot:
    """Every par node (O/N, CD91, all IRS quotes) shifted +1bp."""
    s = _DV01_SHIFT_DECIMAL
    return MarketSnapshot(
        valuation_date=snapshot.valuation_date,
        cd_rate=snapshot.cd_rate + s,
        swap_quotes=[
            RateQuote(tenor_years=q.tenor_years, rate=q.rate + s, tenor_months=q.tenor_months)
            for q in snapshot.swap_quotes
        ],
        on_rate=(snapshot.on_rate + s) if snapshot.on_rate is not None else None,
    )


def _bump_reval_dv01(swap, snapshot, base_dirty_npv, fixings) -> float:
    """Swap DV01 by bump-and-revalue: rebuild the curve from the +1bp-bumped
    snapshot (full re-bootstrap; curve_cache absorbs repeats) and revalue.

        DV01 = -(NPV_up - NPV_base)   (receive-fixed +, pay-fixed -,
                                       matching compute_irs_pvbp/risk.py)

    Known fixings are held constant across the bump automatically: selection
    is date-based (engine/fixings.py) and independent of the curve, so only
    unfixed forwards and discounting move -- which is why this collapses to
    ~0 after the final fixing is set, where the old fixed-leg annuity proxy
    (pv_fixed_leg / (rate * 1e4)) kept reporting a full ~245k/bp and read
    ~2x the true DV01 before a payment (DIAG_PNL_TRACE.md section 6)."""
    bumped_curve = build_curve(_parallel_bumped(snapshot))
    res_up = value_booked_trade(swap, bumped_curve, fixings)
    return -(res_up.dirty_npv - base_dirty_npv)


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
    # Deduplicated CD-fixing data-quality events across the whole trace
    # (engine/fixings.py) -- surfaced to the API next to skipped_dates.
    fixing_warnings: list[FixingResolution] = field(default_factory=list)


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
    resolutions: list[FixingResolution] = []
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

        # Fixing selection is reset-date-based inside value_booked_trade
        # (engine/fixings.py). The previous per-date ffill here re-fixed the
        # current stub daily off the valuation-date CD -- and its decimal
        # value was then divided by 100 again in the engine, which is what
        # produced the reset-day PnL cliff (DIAG_PNL_TRACE.md).
        result = value_booked_trade(swap, curve, fixings)
        resolutions.extend(result.fixing_resolutions)
        delta_val = _bump_reval_dv01(swap, snapshot, result.dirty_npv, fixings)

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

    fixing_warnings = dedupe_data_quality_events(resolutions)
    if fixing_warnings:
        logger.warning(
            "NPV trace [%s..%s]: CD fixing data-quality fallback on %d period(s), e.g. %s",
            start_date, end_date, len(fixing_warnings),
            "; ".join(
                f"F({w.reset_date})={w.fixing_date} -> ffill {w.resolved_date}"
                for w in fixing_warnings[:3]
            ),
        )

    return NpvTraceResult(
        trade_date=swap.trade_date,
        maturity_date=swap.maturity_date,
        entry_npv=entry_npv,
        points=points,
        skipped_dates=skipped_dates,
        fixing_warnings=fixing_warnings,
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
