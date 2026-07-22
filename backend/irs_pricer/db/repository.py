"""
Market data repository: the DB-backed replacement for loaders/factory.py at
request-serving time (blueprint D.0/D.1). Services depend on this exactly the
way they depended on loaders/ before -- same DI seam (README's "services
decoupled from disk I/O" principle) -- so engine/ and every service function
signature stay unchanged regardless of whether a MarketSnapshot came from an
Excel row or a MySQL row.

loaders/ is not deleted: it remains the ETL-time reader used by
scripts/migrate_excel_to_mysql.py to backfill market_data from the historical
xlsx/csv sources (see that script), and upsert_quote_row() below is the
write-side counterpart both that script and the live-feed endpoint use.
"""

from __future__ import annotations

import math
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.orm import Session

from ..core.market_data import MarketSnapshot, RateQuote
from .models import InstrumentType, MarketData, MarketDataSource, TenorUnit

# Sentinel tenor identities for the two non-swap instrument types this table
# also carries (matches the seeded tenor_pillar rows -- see the Alembic seed
# migration and blueprint C.1).
_CD_TENOR = (TenorUnit.D, 91)
_ON_TENOR = (TenorUnit.D, 1)


def _to_float(value: Decimal | float) -> float:
    return float(value)


def _to_decimal(value: float | None) -> Decimal | None:
    if value is None:
        return None
    # str() round-trip avoids binary-float noise leaking into the stored decimal.
    return Decimal(str(value))


def _tenor_years_nominal(tenor_unit: TenorUnit, tenor_count: int) -> int:
    """Reconstruct RateQuote's rounded-nominal tenor_years from (tenor_unit,
    tenor_count). Matches the historical IRS_TENORS convention: whole-year
    tenors divide evenly; sub-annual/fractional ones round UP
    (6M->1, 9M->1, 18M->2) -- verified against loaders/infomax_schema.py."""
    if tenor_unit == TenorUnit.D:
        return 0  # CD91D/O-N/BOK have no year-scale meaning; never used as swap_quotes
    if tenor_count % 12 == 0:
        return tenor_count // 12
    return math.ceil(tenor_count / 12)


def get_snapshot(db: Session, valuation_date: date) -> MarketSnapshot | None:
    """None (not an exception) if no usable market_data rows exist for this
    date -- callers (market_data_service) translate that into their own
    ValueError/NonBusinessDayError semantics, matching the loader contract."""
    rows = (
        db.execute(select(MarketData).where(MarketData.valuation_date == valuation_date))
        .scalars()
        .all()
    )
    if not rows:
        return None

    cd_row = next((r for r in rows if r.instrument_type == InstrumentType.CD), None)
    if cd_row is None:
        return None  # cd_rate is non-optional on MarketSnapshot; no CD quote means no usable snapshot
    on_row = next((r for r in rows if r.instrument_type == InstrumentType.ON), None)

    swap_quotes = [
        RateQuote(
            tenor_years=_tenor_years_nominal(r.tenor_unit, r.tenor_count),
            rate=_to_float(r.mid_rate),
            tenor_months=(
                r.tenor_count if (r.tenor_unit == TenorUnit.M and r.tenor_count % 12 != 0) else None
            ),
        )
        for r in rows
        if r.instrument_type == InstrumentType.IRS
    ]

    return MarketSnapshot(
        valuation_date=valuation_date,
        cd_rate=_to_float(cd_row.mid_rate),
        swap_quotes=swap_quotes,
        on_rate=_to_float(on_row.mid_rate) if on_row is not None else None,
    )


def get_available_dates(db: Session) -> list[date]:
    rows = (
        db.execute(select(MarketData.valuation_date).distinct().order_by(MarketData.valuation_date))
        .scalars()
        .all()
    )
    return list(rows)


def get_cd_fixing_history(db: Session) -> dict[date, float]:
    """CD91D history keyed by date -- replaces loaders.factory.load_fixing_history()
    for MTM past-reset estimation (mtm_service via market_data_service.load_fixings())."""
    rows = db.execute(
        select(MarketData.valuation_date, MarketData.mid_rate).where(
            MarketData.instrument_type == InstrumentType.CD
        )
    ).all()
    return {d: _to_float(rate) for d, rate in rows}


def upsert_quote_row(
    db: Session,
    *,
    valuation_date: date,
    instrument_type: InstrumentType,
    tenor_unit: TenorUnit,
    tenor_count: int,
    mid_rate: float,
    source: MarketDataSource,
    bid_rate: float | None = None,
    ask_rate: float | None = None,
) -> None:
    """Single-row upsert keyed on uq_market_data (valuation_date,
    instrument_type, tenor_unit, tenor_count). Used directly by the ETL
    backfill script (which has real bid/ask from Excel); upsert_snapshot()
    below is the convenience wrapper for the live-feed/domain-object case,
    which only ever has a mid rate."""
    stmt = mysql_insert(MarketData).values(
        valuation_date=valuation_date,
        instrument_type=instrument_type,
        tenor_unit=tenor_unit,
        tenor_count=tenor_count,
        bid_rate=_to_decimal(bid_rate),
        ask_rate=_to_decimal(ask_rate),
        mid_rate=_to_decimal(mid_rate),
        source=source,
    )
    stmt = stmt.on_duplicate_key_update(
        bid_rate=stmt.inserted.bid_rate,
        ask_rate=stmt.inserted.ask_rate,
        mid_rate=stmt.inserted.mid_rate,
        source=stmt.inserted.source,
    )
    db.execute(stmt)


def upsert_snapshot(
    db: Session,
    snapshot: MarketSnapshot,
    source: MarketDataSource,
    on_rate_source: MarketDataSource | None = None,
) -> None:
    """Write every quote in `snapshot` (cd_rate, on_rate, swap_quotes) as one
    market_data row each. Used by the live-feed endpoint (source=LIVE_FEED,
    on_rate_source left None so on_rate shares that same source -- the live
    push genuinely is one feed for everything).

    on_rate_source lets ETL backfill (scripts/migrate_excel_to_mysql.py) mark
    on_rate as CALL_RATE even when `source` is TRUE_DATA/TOTAL_DATA/CSV --
    on_rate in this domain model always actually comes from
    loaders/call_rate.py (True Data.xlsx doesn't carry O/N at all; see
    core/market_data.py's on_rate docstring), so crediting it to whichever
    IRS source built the rest of the snapshot would misreport provenance for
    audit purposes (PRODUCT.md: "a quant can audit any number back to its
    inputs")."""
    upsert_quote_row(
        db,
        valuation_date=snapshot.valuation_date,
        instrument_type=InstrumentType.CD,
        tenor_unit=_CD_TENOR[0],
        tenor_count=_CD_TENOR[1],
        mid_rate=snapshot.cd_rate,
        source=source,
    )
    if snapshot.on_rate is not None:
        upsert_quote_row(
            db,
            valuation_date=snapshot.valuation_date,
            instrument_type=InstrumentType.ON,
            tenor_unit=_ON_TENOR[0],
            tenor_count=_ON_TENOR[1],
            mid_rate=snapshot.on_rate,
            source=on_rate_source if on_rate_source is not None else source,
        )
    for q in snapshot.swap_quotes:
        tenor_count = q.tenor_months if q.tenor_months is not None else q.tenor_years * 12
        upsert_quote_row(
            db,
            valuation_date=snapshot.valuation_date,
            instrument_type=InstrumentType.IRS,
            tenor_unit=TenorUnit.M,
            tenor_count=tenor_count,
            mid_rate=q.rate,
            source=source,
        )
    db.commit()
