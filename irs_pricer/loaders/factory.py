"""
Factory for loading market data across all supported sources (True Data, Total Data, CSV).
"""

from __future__ import annotations

import logging
from datetime import date
from pathlib import Path

from ..core.errors import NonBusinessDayError
from ..core.market_data import MarketSnapshot
from .csv_loader import common_dates as common_dates_csv, load_fixing_history_csv, load_market_snapshot_csv
from .total_data import common_dates_xl, load_market_snapshot_xl
from .true_data import common_dates_xlsx, load_market_snapshot_xlsx

logger = logging.getLogger(__name__)


def load_market_snapshot(source: Path | str, valuation_date: date) -> MarketSnapshot:
    """Detects format (CSV, Total Data, True Data) and routes to correct parser."""
    source = Path(source)
    if source.is_dir():
        return load_market_snapshot_csv(source, valuation_date)
    
    if source.suffix.lower() in (".xlsx", ".xls"):
        if source.name == "True Data.xlsx":
            return load_market_snapshot_xlsx(source.parent, valuation_date)
        return load_market_snapshot_xl(source, valuation_date)
    
    return load_market_snapshot_csv(source, valuation_date)


def load_fixing_history(source: Path | str) -> dict[date, float]:
    """Inspects `source` and returns historical CD91D fixings for MTM pricing."""
    source = Path(source)
    # The existing system expects CD_AAA_91D.csv to be in a directory, 
    # or the source could be the file itself.
    if source.is_dir():
        cd_fixings_path = source / "CD_AAA_91D.csv"
    elif source.suffix.lower() == ".csv":
        cd_fixings_path = source
    else:
        # Fallback if given an Excel file path, we look in its parent dir for CSV.
        cd_fixings_path = source.parent / "CD_AAA_91D.csv"

    if not cd_fixings_path.exists():
        return {}
    try:
        return load_fixing_history_csv(cd_fixings_path)
    except OSError:
        return {}


def list_available_dates(source: Path | str) -> list[date]:
    """Aggregate available dates from a specific source."""
    source = Path(source)
    if source.is_dir():
        # Might contain multiple formats, but let's just check CSV for backward compat
        return common_dates_csv(source)
    
    if source.suffix.lower() in (".xlsx", ".xls"):
        if source.name == "True Data.xlsx":
            return common_dates_xlsx(source.parent)
        return common_dates_xl(source)
    
    return common_dates_csv(source)


def latest_common_date(source: Path | str) -> date:
    """Return the most recent date present in the source."""
    dates = list_available_dates(source)
    if not dates:
        raise ValueError(f"{source}에서 사용 가능한 시장 데이터가 없습니다.")
    return dates[-1]
