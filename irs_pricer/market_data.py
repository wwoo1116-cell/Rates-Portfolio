"""
Market data contract for curve construction.

`MarketSnapshot` is the shape the rest of the package depends on. Actual
retrieval (Excel workbook, internal API, Bloomberg, etc.) is intentionally
left unimplemented here -- wire `fetch_market_data` to a real source later
without touching curve/instruments/pricing, as long as it returns this shape.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date


@dataclass(frozen=True)
class RateQuote:
    tenor_years: int
    rate: float  # decimal, e.g. 0.0410


@dataclass(frozen=True)
class MarketSnapshot:
    valuation_date: date
    cd_rate: float  # short-end deposit/fixing rate, decimal
    swap_quotes: list[RateQuote] = field(default_factory=list)  # par IRS quotes


def fetch_market_data(valuation_date: date, data_dir: str | None = None) -> MarketSnapshot:
    """
    Load a MarketSnapshot from local CSV files.

    data_dir defaults to the directory containing this package (one level up).
    """
    from pathlib import Path
    from .csv_loader import load_market_snapshot

    if data_dir is None:
        data_dir = Path(__file__).resolve().parent.parent
    return load_market_snapshot(data_dir, valuation_date)
