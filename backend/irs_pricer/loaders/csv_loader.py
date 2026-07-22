"""
Load market data from local CSV files exported from the bond/IRS data feed.

CSV format (rows 0-2 are headers, data starts at row 3):
  CD_AAA_91D.csv  : date, rate(%)
  IRS_*Y.csv      : date, bid(%), ask(%), mid(%)

Rates in CSV are percentage (e.g. 2.92 = 2.92%); divided by 100 for QuantLib.
The short-end anchor uses CD_AAA_91D because the float leg references CD91D.
"""

from __future__ import annotations

import csv
from datetime import date, datetime
from pathlib import Path

from ..core.errors import NonBusinessDayError, _check_business_day  # re-exported for backwards compat
from ..core.market_data import MarketSnapshot, RateQuote

_IRS_FILES: dict[str, int] = {
    "IRS_1Y.csv": 1,
    "IRS_2Y.csv": 2,
    "IRS_3Y.csv": 3,
    "IRS_5Y.csv": 5,
    "IRS_7Y.csv": 7,
    "IRS_10Y.csv": 10,
}

_HEADER_ROWS = 3


def _parse_date(s: str) -> date:
    return datetime.strptime(s.strip(), "%Y-%m-%d %H:%M:%S").date()


def _lookup_date(csv_path: Path, valuation_date: date, col: int) -> float | None:
    """Return the value in `col` for the first row whose date matches valuation_date."""
    with csv_path.open(encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        for _ in range(_HEADER_ROWS):
            next(reader, None)
        for row in reader:
            if len(row) <= col or not row[0].strip():
                continue
            try:
                row_date = _parse_date(row[0])
            except ValueError:
                continue
            if row_date == valuation_date:
                val = row[col].strip()
                return float(val) if val else None
    return None


def _available_dates(csv_path: Path) -> list[date]:
    """Return all dates present in a CSV file, in file order."""
    dates: list[date] = []
    with csv_path.open(encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        for _ in range(_HEADER_ROWS):
            next(reader, None)
        for row in reader:
            if not row or not row[0].strip():
                continue
            try:
                dates.append(_parse_date(row[0]))
            except ValueError:
                continue
    return dates


def load_fixing_history_csv(csv_path: Path | str) -> dict[date, float]:
    """Return {date: rate(decimal)} for every row of a CD91D rate CSV file
    (e.g. CD_AAA_91D.csv), usable as `historical_fixings` in mtm_valuation."""
    csv_path = Path(csv_path)
    history: dict[date, float] = {}
    with csv_path.open(encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        for _ in range(_HEADER_ROWS):
            next(reader, None)
        for row in reader:
            if len(row) <= 1 or not row[0].strip():
                continue
            try:
                d = _parse_date(row[0])
            except ValueError:
                continue
            val = row[1].strip()
            if val:
                history[d] = float(val) / 100.0
    return history


def common_dates(data_dir: Path | str) -> list[date]:
    """Return all dates present in EVERY data file, sorted ascending."""
    data_dir = Path(data_dir)
    sets = [set(_available_dates(data_dir / "CD_AAA_91D.csv"))]
    for fname in _IRS_FILES:
        p = data_dir / fname
        if p.exists():
            sets.append(set(_available_dates(p)))
    common = sets[0].intersection(*sets[1:])
    if not common:
        raise ValueError("모든 CSV 파일에 공통된 날짜가 없습니다.")
    return sorted(common)

def latest_common_date(source: Path | str) -> date:
    """Return the most recent date present in ALL data files."""
    return common_dates(source)[-1]


def load_market_snapshot_csv(data_dir: Path | str, valuation_date: date) -> MarketSnapshot:
    """
    Build a MarketSnapshot from the CSV files in data_dir for valuation_date.

    Raises NonBusinessDayError if the date is a weekend or public holiday.
    Raises ValueError if data is missing for a valid business day.
    """
    _check_business_day(valuation_date)

    data_dir = Path(data_dir)

    raw_cd = _lookup_date(data_dir / "CD_AAA_91D.csv", valuation_date, col=1)
    if raw_cd is None:
        raise ValueError(f"{valuation_date}의 CD91D 금리를 찾을 수 없습니다 (데이터가 아직 적재되지 않았을 수 있습니다).")
    cd_rate = raw_cd / 100.0

    swap_quotes: list[RateQuote] = []
    for fname, tenor in _IRS_FILES.items():
        p = data_dir / fname
        if not p.exists():
            continue
        raw_irs = _lookup_date(p, valuation_date, col=3)  # MID 종가
        if raw_irs is None:
            raise ValueError(f"{valuation_date}의 IRS {tenor}Y MID 금리를 찾을 수 없습니다 (데이터가 아직 적재되지 않았을 수 있습니다).")
        swap_quotes.append(RateQuote(tenor_years=tenor, rate=raw_irs / 100.0))

    return MarketSnapshot(
        valuation_date=valuation_date,
        cd_rate=cd_rate,
        swap_quotes=swap_quotes,
    )
