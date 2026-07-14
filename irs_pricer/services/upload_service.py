"""
Upload orchestration: validate the four mandatory market-data/portfolio
Excel files via their loaders, and only commit (overwrite the live market-
data files) if every one of them parses successfully -- never leaves the
data directory partially updated.

Positions parsed from the portfolio file are NOT booked to a database --
this deployment doesn't use one (see manual-positions-store.ts on the
frontend, which is the actual live, browser-only position store). They're
returned to the caller instead, for the frontend to load into that store.

Route handlers call this; no loader/path logic lives in api/ (same
convention as market_data_service).
"""

from __future__ import annotations

import logging
import os
import tempfile
from pathlib import Path

from ..loaders import base_rate
from ..loaders import credit_matrix as credit_matrix_loader
from ..loaders import portfolio as portfolio_loader
from ..loaders import true_data

logger = logging.getLogger(__name__)

_DATA_DIR = Path(__file__).resolve().parent.parent.parent  # irs_pricer/services/ → project root

SLOT_FILENAMES = {
    "irs_data": true_data.XLSX_NAME,
    "credit_matrix": credit_matrix_loader.XLSX_NAME,
    "bok_base_rate": base_rate.XLSX_NAME,
    "portfolio": portfolio_loader.XLSX_NAME,
}


def _validate_true_data(tmp_dir: Path) -> dict:
    dates = true_data.common_dates_xlsx(tmp_dir)
    return {"status": "ready", "rows": len(dates), "min_date": dates[0], "max_date": dates[-1]}


def _validate_credit_matrix(tmp_dir: Path) -> dict:
    s = credit_matrix_loader.summary(tmp_dir)
    return {"status": "ready", "rows": s["rows"], "min_date": s["min_date"], "max_date": s["max_date"]}


def _validate_base_rate(tmp_dir: Path) -> dict:
    rates = base_rate.all_rates(tmp_dir)
    if not rates:
        raise ValueError(f"{base_rate.XLSX_NAME}에서 날짜 데이터를 찾을 수 없습니다.")
    dates = sorted(rates)
    return {"status": "ready", "rows": len(dates), "min_date": dates[0], "max_date": dates[-1]}


_MARKET_DATA_VALIDATORS = {
    "irs_data": _validate_true_data,
    "credit_matrix": _validate_credit_matrix,
    "bok_base_rate": _validate_base_rate,
}


def _commit(file_bytes: dict[str, bytes]) -> None:
    """Atomically overwrite each live data file: write to a same-directory
    temp file, then os.replace() (same pattern as loaders/cache.py's disk
    cache write) -- a crash mid-write can never leave a corrupt/partial file
    at the live path."""
    for key, data in file_bytes.items():
        dest = _DATA_DIR / SLOT_FILENAMES[key]
        fd, tmp_name = tempfile.mkstemp(dir=_DATA_DIR, suffix=".tmp")
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(data)
            os.replace(tmp_name, dest)
        except Exception:
            try:
                os.unlink(tmp_name)
            except OSError:
                pass
            raise


def process_upload(file_bytes: dict[str, bytes]) -> tuple[bool, dict[str, dict], list[dict]]:
    """file_bytes: {"irs_data": ..., "credit_matrix": ..., "bok_base_rate": ..., "portfolio": ...}
    (raw uploaded bytes, keyed the same as SLOT_FILENAMES).

    Returns (success, {slot: {status, message?, rows?, min_date?, max_date?}}, positions).
    `positions` is the parsed PortfolioPositionIn-shaped list, non-empty only
    on success -- the caller (frontend) owns loading these into its own
    client-side position store, there's no server-side persistence here.
    Commits nothing to disk unless every slot validates."""
    with tempfile.TemporaryDirectory(prefix="irs_upload_") as tmp:
        tmp_dir = Path(tmp)
        for key, data in file_bytes.items():
            (tmp_dir / SLOT_FILENAMES[key]).write_bytes(data)

        results: dict[str, dict] = {}
        for key, validator in _MARKET_DATA_VALIDATORS.items():
            try:
                results[key] = validator(tmp_dir)
            except Exception as exc:
                logger.warning("upload validation failed for %s: %s", key, exc)
                results[key] = {"status": "error", "message": str(exc)}

        parsed_positions: list[dict] = []
        try:
            parsed_positions = portfolio_loader.parse(tmp_dir)
            p_summary = portfolio_loader.summary(tmp_dir)
            results["portfolio"] = {
                "status": "ready",
                "rows": p_summary["positions"],
                "min_date": p_summary["min_maturity"],
                "max_date": p_summary["max_maturity"],
            }
        except Exception as exc:
            logger.warning("upload validation failed for portfolio: %s", exc)
            results["portfolio"] = {"status": "error", "message": str(exc)}

    if not all(r["status"] == "ready" for r in results.values()):
        return False, results, []

    _commit(file_bytes)
    return True, results, parsed_positions
