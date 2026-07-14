"""
Load market data from "True Data.xlsx" (single-sheet Infomax export).

Layout: rows 1-3 are headers, data starts at row 4, most recent date first.
Each row packs IRS (6M..30Y) as repeating [date, bid, ask, mid] blocks,
followed by a single CD91D column (see infomax_schema.py for the exact
column indices -- confirmed directly against the workbook's own header
rows). Column 0 is the valuation date that keys the whole row; each IRS
block's own date sub-column is its T+1 settlement date and is not used as a
lookup key.

Rates are percentage (e.g. 2.92 = 2.92%); divided by 100 for QuantLib.
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from pathlib import Path

import openpyxl

from ..core.errors import NonBusinessDayError, _check_business_day
from ..core.market_data import MarketSnapshot, RateQuote
from .cache import get_cached
from .call_rate import load_on_rate
from .infomax_schema import (
    COL_CD_91D as _COL_CD_91D,
    COL_VAL_DATE as _COL_VAL_DATE,
    HEADER_ROWS as _HEADER_ROWS,
    IRS_TENORS as _IRS_TENORS,
)

logger = logging.getLogger(__name__)

XLSX_NAME = "True Data.xlsx"


def _row_date(row: tuple) -> date | None:
    val = row[_COL_VAL_DATE]
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val
    return None


def _parse_rows(path: Path) -> list[tuple]:
    """Parse the dated data block from the top of the sheet, stopping at the
    first blank-date row once real data has been seen. Confirmed (see
    cache.py module docstring context / investigation) that the real
    813 data rows sit contiguously right after the header, followed by tens
    of thousands of empty padding rows -- without this early break,
    openpyxl's read-only row iterator still walks every one of those padding
    rows, which is the dominant cost of a cold parse (~5s for this file)."""
    logger.info("opening %s for parsing…", path.name)
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        ws = wb.worksheets[0]
        rows = []
        seen_data = False
        for i, row in enumerate(ws.iter_rows(values_only=True)):
            if i < _HEADER_ROWS:
                continue
            if _row_date(row) is None:
                if seen_data:
                    logger.debug("early break at physical row %d — %d data rows collected", i + 1, len(rows))
                    break  # contiguous data block ended -- skip the padding rows
                continue
            seen_data = True
            rows.append(row)
    finally:
        wb.close()
    if not rows:
        logger.error("_parse_rows returned 0 rows from %s — check _HEADER_ROWS and column layout", path.name)
    else:
        logger.info("parsed %d rows from %s", len(rows), path.name)
    return rows


def _index_rows(rows: list[tuple]) -> dict[date, tuple]:
    """Build a {valuation_date: row} lookup once per parsed workbook."""
    return {d: row for row in rows if (d := _row_date(row)) is not None}


def _load_indexed_rows(data_dir: Path | str) -> dict[date, tuple]:
    """Cached, date-indexed view of the parsed workbook -- O(1) lookup by
    valuation_date instead of an O(N) linear scan per lookup."""
    path = Path(data_dir) / XLSX_NAME
    return get_cached(path, lambda p: _index_rows(_parse_rows(p)), cache_key_suffix="by_date")


def common_dates_xlsx(data_dir: Path | str) -> list[date]:
    """Return all valuation dates present in the workbook, sorted ascending."""
    dates = _load_indexed_rows(data_dir).keys()
    if not dates:
        raise ValueError(f"{XLSX_NAME}에서 날짜 데이터를 찾을 수 없습니다.")
    return sorted(dates)


def load_market_snapshot_xlsx(data_dir: Path | str, valuation_date: date) -> MarketSnapshot:
    """
    Build a MarketSnapshot from True Data.xlsx for valuation_date.

    Raises NonBusinessDayError if the date is a weekend or public holiday.
    Raises ValueError if no row matches valuation_date.
    """
    _check_business_day(valuation_date)

    row = _load_indexed_rows(data_dir).get(valuation_date)
    if row is None:
        raise ValueError(f"{XLSX_NAME}에 {valuation_date}의 시장 데이터가 없습니다.")

    cd_rate = row[_COL_CD_91D]
    if cd_rate is None:
        raise ValueError(f"{valuation_date}의 CD91D 금리를 찾을 수 없습니다.")

    swap_quotes = [
        RateQuote(tenor_years=ty, rate=row[col] / 100.0, tenor_months=tm)
        for ty, tm, col in _IRS_TENORS
        if row[col] is not None
    ]
    if not swap_quotes:
        raise ValueError(f"{valuation_date}의 IRS 금리를 찾을 수 없습니다.")

    return MarketSnapshot(
        valuation_date=valuation_date,
        cd_rate=cd_rate / 100.0,
        swap_quotes=swap_quotes,
        # Real O/N (Call Rate Data.xlsx), keyed by the same valuation_date --
        # None (no "1D" pillar) if that workbook doesn't have a row for this
        # date yet, rather than falling back to any assumed/hardcoded value.
        on_rate=load_on_rate(data_dir, valuation_date),
    )


def load_fixing_history_xlsx(data_dir: Path | str) -> dict[date, float]:
    """Return {date: CD91D rate (decimal)} for every dated row in True Data.xlsx,
    usable as `historical_fixings` in mtm_valuation."""
    history: dict[date, float] = {}
    for row_date, row in _load_indexed_rows(data_dir).items():
        cd_rate = row[_COL_CD_91D]
        if cd_rate is None:
            continue
        history[row_date] = cd_rate / 100.0
    if not history:
        raise ValueError(f"{XLSX_NAME}에서 CD91D 픽싱 이력을 찾을 수 없습니다.")
    return history


def daily_shift(data_dir: Path | str) -> dict[str, float]:
    """Return the day-over-day shift in basis points (latest row - previous row)
    for each IRS tenor, plus CD91D.
    Tenor keys match the standard bucket labels (e.g. '6M', '1Y', '3M' for CD91D)."""
    indexed = _load_indexed_rows(data_dir)
    if len(indexed) < 2:
        return {}

    dates = sorted(indexed.keys(), reverse=True)
    latest_row = indexed[dates[0]]
    prev_row = indexed[dates[1]]

    shift: dict[str, float] = {}

    # CD91D maps to 3M bucket
    cd_latest = latest_row[_COL_CD_91D]
    cd_prev = prev_row[_COL_CD_91D]
    if cd_latest is not None and cd_prev is not None:
        # Rates are in percentages (e.g. 2.92). Diff is %, so multiply by 100 for bps.
        shift["3M"] = (cd_latest - cd_prev) * 100.0

    for ty, tm, col in _IRS_TENORS:
        val_latest = latest_row[col]
        val_prev = prev_row[col]
        if val_latest is not None and val_prev is not None:
            if tm == 6:
                label = "6M"
            elif tm == 9:
                label = "9M"
            elif tm == 18:
                label = "1.5Y"
            else:
                label = f"{ty}Y"
            
            shift[label] = (val_latest - val_prev) * 100.0

    return shift
