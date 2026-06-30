"""
Load market data from "True Data.xlsx" (single-sheet Infomax export).

Layout: rows 1-3 are headers, data starts at row 4, most recent date first.
Each row packs CD + IRS (6M..30Y) as repeating [date, bid, ask, mid] blocks,
except the CD block which is [date, 1M, 91D]. Column 0 (the CD date) is the
valuation date that keys the whole row; IRS date sub-columns are the T+1
settlement date and are not used as a lookup key.

Rates are percentage (e.g. 2.92 = 2.92%); divided by 100 for QuantLib.
"""

from __future__ import annotations

from datetime import date, datetime
from pathlib import Path

import openpyxl

from .csv_loader import NonBusinessDayError, _check_business_day
from .market_data import MarketSnapshot, RateQuote
from .rows_cache import get_cached

XLSX_NAME = "True Data.xlsx"
_HEADER_ROWS = 3

_COL_VAL_DATE = 0
_COL_CD_91D = 2

# tenor_years -> MID column index (0-based) within each data row
_IRS_MID_COLS: dict[int, int] = {
    1: 14,
    2: 22,
    3: 26,
    4: 30,
    5: 34,
    6: 38,
    7: 42,
    8: 46,
    9: 50,
    10: 54,
}


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
    rows_cache.py module docstring context / investigation) that the real
    813 data rows sit contiguously right after the header, followed by tens
    of thousands of empty padding rows -- without this early break,
    openpyxl's read-only row iterator still walks every one of those padding
    rows, which is the dominant cost of a cold parse (~5s for this file)."""
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
                    break  # contiguous data block ended -- skip the padding rows
                continue
            seen_data = True
            rows.append(row)
    finally:
        wb.close()
    return rows


def _load_rows(data_dir: Path | str) -> list[tuple]:
    path = Path(data_dir) / XLSX_NAME
    return get_cached(path, _parse_rows)


def common_dates_xlsx(data_dir: Path | str) -> list[date]:
    """Return all valuation dates present in the workbook, sorted ascending."""
    dates = {_row_date(row) for row in _load_rows(data_dir)}
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

    for row in _load_rows(data_dir):
        if _row_date(row) != valuation_date:
            continue

        cd_rate = row[_COL_CD_91D]
        if cd_rate is None:
            raise ValueError(f"{valuation_date}의 CD91D 금리를 찾을 수 없습니다.")

        swap_quotes = [
            RateQuote(tenor_years=tenor, rate=row[col] / 100.0)
            for tenor, col in _IRS_MID_COLS.items()
            if row[col] is not None
        ]
        if not swap_quotes:
            raise ValueError(f"{valuation_date}의 IRS 금리를 찾을 수 없습니다.")

        return MarketSnapshot(
            valuation_date=valuation_date,
            cd_rate=cd_rate / 100.0,
            swap_quotes=swap_quotes,
        )

    raise ValueError(f"{XLSX_NAME}에 {valuation_date}의 시장 데이터가 없습니다.")
