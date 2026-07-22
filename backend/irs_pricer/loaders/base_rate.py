"""
Load BOK (Bank of Korea) 기준금리 (base rate) history from "BOK Base Rate.xlsx".

Layout: rows 0-2 are headers (title row, then column labels "일자"/"종가"/
"수정일시"/"적용일자"), data starts at row 3, most recent date first -- same
shape as Call Rate Data.xlsx/True Data.xlsx's date-indexed block. The source
already carries one row per calendar day (repeating the same rate on every
day between BOK policy changes), so this is a plain date->rate lookup, not a
step-function/forward-fill computation.
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from pathlib import Path

import openpyxl

from .cache import get_cached

logger = logging.getLogger(__name__)

XLSX_NAME = "BOK Base Rate.xlsx"
_HEADER_ROWS = 3
_COL_DATE = 0
_COL_RATE = 1


def _row_date(row: tuple) -> date | None:
    val = row[_COL_DATE]
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val
    return None


def _parse_rows(path: Path) -> list[tuple]:
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


def _index_rows(rows: list[tuple]) -> dict[date, float]:
    return {d: row[_COL_RATE] / 100.0 for row in rows if (d := _row_date(row)) is not None and row[_COL_RATE] is not None}


def _load_indexed_rows(data_dir: Path | str) -> dict[date, float]:
    path = Path(data_dir) / XLSX_NAME
    return get_cached(path, lambda p: _index_rows(_parse_rows(p)), cache_key_suffix="by_date")


def load_base_rate(data_dir: Path | str, valuation_date: date) -> float | None:
    """BOK base rate for valuation_date, decimal (e.g. 0.025), or None if
    BOK Base Rate.xlsx is missing or has no row for that date."""
    path = Path(data_dir) / XLSX_NAME
    if not path.exists():
        return None
    return _load_indexed_rows(data_dir).get(valuation_date)


def all_rates(data_dir: Path | str) -> dict[date, float]:
    """Every {date: rate (decimal)} in BOK Base Rate.xlsx, or {} if the file
    is missing -- used by the ETL backfill script (scripts/migrate_excel_to_mysql.py)
    to migrate the whole policy-rate history, not just a single date."""
    path = Path(data_dir) / XLSX_NAME
    if not path.exists():
        return {}
    return dict(_load_indexed_rows(data_dir))
