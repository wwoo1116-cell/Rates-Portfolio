"""
Real-time market data poller.

Connects to the open Infomax workbook (live RTD cells, same layout as
"True Data.xlsx") and pushes the latest row to the running API's
POST /api/market-data/live endpoint at a fixed interval.

Run alongside the pricer while the workbook is open in Excel:
    python scripts/data_updater.py
    python scripts/data_updater.py --workbook "True Data.xlsx" --interval 5
"""

from __future__ import annotations

import argparse
import time
from datetime import date, datetime

import requests
import xlwings as xw

from irs_pricer.loaders.infomax_schema import (
    COL_CD_91D as _COL_CD_91D,
    COL_VAL_DATE as _COL_VAL_DATE,
    IRS_TENORS as _IRS_TENORS,
)

API_URL = "http://localhost:8000/api/market-data/live"

_LAST_COL = max(_COL_CD_91D, max(col for _, _, col in _IRS_TENORS))


def _to_date(val) -> date | None:
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val
    return None


def read_latest_row(workbook_name: str) -> list:
    """Read row 4 (most recent data row) from the open workbook."""
    wb = xw.Book(workbook_name)
    ws = wb.sheets[0]
    return ws.range((4, 1), (4, _LAST_COL + 1)).value


def push_row(row: list) -> None:
    val_date = _to_date(row[_COL_VAL_DATE])
    if val_date is None:
        print("  skip: no valuation date in row")
        return

    cd_rate = row[_COL_CD_91D]
    if cd_rate is None:
        print("  skip: CD91D cell is empty")
        return

    swap_quotes = [
        {"tenor_years": ty, "tenor_months": tm, "rate": row[col] / 100.0}
        for ty, tm, col in _IRS_TENORS
        if row[col] is not None
    ]
    if not swap_quotes:
        print("  skip: no IRS quotes in row")
        return

    payload = {
        "valuation_date": val_date.isoformat(),
        "cd_rate": cd_rate / 100.0,
        "swap_quotes": swap_quotes,
    }

    resp = requests.post(API_URL, json=payload, timeout=5)
    resp.raise_for_status()
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] pushed {val_date}  CD91D={cd_rate:.4f}%  quotes={len(swap_quotes)}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workbook", default="True Data.xlsx", help="Open workbook name or full path")
    parser.add_argument("--interval", type=int, default=5, help="Polling interval in seconds")
    args = parser.parse_args()

    print(f"Polling '{args.workbook}' every {args.interval}s -> {API_URL}")
    print("Press Ctrl+C to stop.")

    while True:
        try:
            row = read_latest_row(args.workbook)
            push_row(row)
        except Exception as e:
            print(f"  error: {e}")
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
