"""
Market data contract for curve construction.

`MarketSnapshot` is the shape the rest of the package depends on. Actual
retrieval (Excel workbook, internal API, Bloomberg, etc.) is intentionally
left unimplemented here — wire a loader to a real source in `loaders/`
without touching `engine/` or `api/`, as long as it returns this shape.
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
