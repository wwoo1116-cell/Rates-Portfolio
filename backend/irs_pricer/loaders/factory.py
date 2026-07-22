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
from .total_data import common_dates_xl, load_fixing_history_xl, load_market_snapshot_xl
from .true_data import common_dates_xlsx, load_fixing_history_xlsx, load_market_snapshot_xlsx

logger = logging.getLogger(__name__)

TRUE_DATA_FILE = "True Data.xlsx"
TOTAL_DATA_FILE = "Total Data.xlsx"
CSV_FIXINGS_FILE = "CD_AAA_91D.csv"


def _detect_source_type(source: Path) -> str:
    """
    Detects active data format by checking cache first, then files.
    This ensures we hit the disk cache layer before falling back to spinning up disk I/O.

    Raises FileNotFoundError if `source` doesn't exist at all. Without this, a
    nonexistent directory isn't a dir and isn't a known filename, so it falls
    through to "csv" and surfaces as a missing CD_AAA_91D.csv -- a file this
    deployment has never had, naming neither the real problem nor the path.
    FileNotFoundError specifically (not ValueError): market_data_service's
    date enumeration swallows ValueError.
    """
    if not source.exists():
        raise FileNotFoundError(f"시장 데이터 소스를 찾을 수 없습니다: {source}")

    if not source.is_dir():
        if source.suffix.lower() == ".csv":
            return "csv"
        if source.name == TRUE_DATA_FILE:
            return "true_data"
        if source.name == TOTAL_DATA_FILE:
            return "total_data"
        return "csv"
        
    try:
        from .cache import _disk_cache_path
        if _disk_cache_path(source / TRUE_DATA_FILE).exists():
            return "true_data"
        if _disk_cache_path(source / TOTAL_DATA_FILE).exists():
            return "total_data"
    except Exception as e:
        logger.debug(f"Cache path detection failed: {e}")
        pass
        
    if (source / TRUE_DATA_FILE).exists():
        return "true_data"
    if (source / TOTAL_DATA_FILE).exists():
        return "total_data"
        
    return "csv"


def load_market_snapshot(source: Path | str, valuation_date: date) -> MarketSnapshot:
    """Detects format (CSV, Total Data, True Data) and routes to correct parser."""
    source = Path(source)
    source_type = _detect_source_type(source)
    
    if source_type == "true_data":
        target = source if source.is_dir() else source.parent
        return load_market_snapshot_xlsx(target, valuation_date)
    elif source_type == "total_data":
        target = (source / TOTAL_DATA_FILE) if source.is_dir() else source
        return load_market_snapshot_xl(target, valuation_date)
    
    return load_market_snapshot_csv(source, valuation_date)


def load_fixing_history(source: Path | str) -> dict[date, float]:
    """Detects format (CSV, Total Data, True Data) and routes to the matching
    fixing-history loader, mirroring load_market_snapshot()'s routing."""
    source = Path(source)
    source_type = _detect_source_type(source)

    if source_type == "true_data":
        target = source if source.is_dir() else source.parent
        return load_fixing_history_xlsx(target)
    elif source_type == "total_data":
        target = (source / TOTAL_DATA_FILE) if source.is_dir() else source
        return load_fixing_history_xl(target)

    if source.is_dir():
        cd_fixings_path = source / CSV_FIXINGS_FILE
    elif source.suffix.lower() == ".csv":
        cd_fixings_path = source
    else:
        cd_fixings_path = source.parent / CSV_FIXINGS_FILE

    if not cd_fixings_path.exists():
        raise FileNotFoundError(
            f"필수 과거 금리 데이터 파일이 누락되었습니다. "
            f"경로를 확인하세요: {cd_fixings_path}"
        )

    try:
        return load_fixing_history_csv(cd_fixings_path)
    except Exception as e:
        raise OSError(f"과거 금리 데이터를 로드하는 중 오류가 발생했습니다: {e}") from e


def list_available_dates(source: Path | str) -> list[date]:
    """Aggregate available dates from a specific source."""
    source = Path(source)
    source_type = _detect_source_type(source)
    
    if source_type == "true_data":
        target = source if source.is_dir() else source.parent
        return common_dates_xlsx(target)
    elif source_type == "total_data":
        target = (source / TOTAL_DATA_FILE) if source.is_dir() else source
        return common_dates_xl(target)
    
    return common_dates_csv(source)


def latest_common_date(source: Path | str) -> date:
    """Return the most recent date present in the source."""
    dates = list_available_dates(source)
    if not dates:
        raise ValueError(f"{source}에서 사용 가능한 시장 데이터가 없습니다.")
    return dates[-1]
