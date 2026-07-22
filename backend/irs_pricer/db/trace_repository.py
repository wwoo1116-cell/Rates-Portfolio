"""
NPV/PnL trace repository: read-through cache storage for daily revaluation
results (blueprint A.4/D.1). Pure CRUD against npv_pnl_trace -- the
cache-aside orchestration (which dates are missing, recomputing them via the
engine, what counts as entry_npv) lives in services/npv_trace_service.py and
services/historical_pnl_service.py, the same way it always has; this module
only ever reads/writes rows.

entry_npv, payer_npv/receiver_npv/active_position_ids, and skipped_dates are
deliberately not columns (see models.py) -- get_entry_point() and the
portfolio-aggregation query below derive them instead of duplicating them.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import func, select
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.orm import Session

from .models import NpvPnlTrace, TraceMarketDataSource


def get_points(db: Session, trade_id: int, start_date: date, end_date: date) -> list[NpvPnlTrace]:
    """Persisted trace rows in [start_date, end_date], ordered by date."""
    return list(
        db.execute(
            select(NpvPnlTrace)
            .where(
                NpvPnlTrace.trade_id == trade_id,
                NpvPnlTrace.valuation_date >= start_date,
                NpvPnlTrace.valuation_date <= end_date,
            )
            .order_by(NpvPnlTrace.valuation_date)
        )
        .scalars()
        .all()
    )


def get_covered_dates(db: Session, trade_id: int, start_date: date, end_date: date) -> set[date]:
    """Dates already persisted for this trade in range -- the cache-aside
    layer diffs this against the full business-day window to find gaps that
    still need a live engine recompute."""
    rows = db.execute(
        select(NpvPnlTrace.valuation_date).where(
            NpvPnlTrace.trade_id == trade_id,
            NpvPnlTrace.valuation_date >= start_date,
            NpvPnlTrace.valuation_date <= end_date,
        )
    ).scalars().all()
    return set(rows)


def get_entry_point(db: Session, trade_id: int) -> NpvPnlTrace | None:
    """The row with MIN(valuation_date) for this trade -- its clean_npv is
    entry_npv, derived here rather than stored redundantly on every row."""
    return db.execute(
        select(NpvPnlTrace)
        .where(NpvPnlTrace.trade_id == trade_id)
        .order_by(NpvPnlTrace.valuation_date)
        .limit(1)
    ).scalar_one_or_none()


def get_latest_before(db: Session, trade_id: int, before_date: date) -> NpvPnlTrace | None:
    """Most recent persisted point strictly before `before_date` -- lets a
    partial cache-aside recompute continue daily_pnl/cumulative_pnl
    continuity without reloading the whole history."""
    return db.execute(
        select(NpvPnlTrace)
        .where(NpvPnlTrace.trade_id == trade_id, NpvPnlTrace.valuation_date < before_date)
        .order_by(NpvPnlTrace.valuation_date.desc())
        .limit(1)
    ).scalar_one_or_none()


def get_points_for_date(
    db: Session, trade_ids: list[int], valuation_date: date
) -> list[NpvPnlTrace]:
    """Every trace row for the given date across a set of trades -- the
    portfolio historical-pnl aggregation reads one of these per date and
    sums clean_npv (see historical_pnl_service)."""
    if not trade_ids:
        return []
    return list(
        db.execute(
            select(NpvPnlTrace).where(
                NpvPnlTrace.trade_id.in_(trade_ids),
                NpvPnlTrace.valuation_date == valuation_date,
            )
        )
        .scalars()
        .all()
    )


def upsert_points(
    db: Session,
    trade_id: int,
    points: list[dict],
    source: TraceMarketDataSource | None = None,
) -> None:
    """Bulk upsert keyed on (trade_id, valuation_date). Each dict has
    valuation_date/clean_npv/dirty_npv/daily_pnl/cumulative_pnl -- the shape
    services/npv_trace_service.py's NpvTracePoint already produces."""
    if not points:
        return
    rows = [
        {
            "trade_id": trade_id,
            "valuation_date": p["valuation_date"],
            "clean_npv": p["clean_npv"],
            "dirty_npv": p["dirty_npv"],
            "daily_pnl": p.get("daily_pnl"),
            "cumulative_pnl": p["cumulative_pnl"],
            "market_data_source": source,
        }
        for p in points
    ]
    stmt = mysql_insert(NpvPnlTrace).values(rows)
    stmt = stmt.on_duplicate_key_update(
        clean_npv=stmt.inserted.clean_npv,
        dirty_npv=stmt.inserted.dirty_npv,
        daily_pnl=stmt.inserted.daily_pnl,
        cumulative_pnl=stmt.inserted.cumulative_pnl,
        market_data_source=stmt.inserted.market_data_source,
    )
    db.execute(stmt)
    db.commit()
