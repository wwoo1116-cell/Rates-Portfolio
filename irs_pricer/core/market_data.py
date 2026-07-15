"""
Market data contract for curve construction.

`MarketSnapshot` is the shape the rest of the package depends on. Actual
retrieval (Excel workbook, internal API, Bloomberg, etc.) is intentionally
left unimplemented here ??wire a loader to a real source in `loaders/`
without touching `engine/` or `api/`, as long as it returns this shape.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date


@dataclass(frozen=True)
class RateQuote:
    tenor_years: int
    rate: float  # decimal, e.g. 0.0410
    # Sub-year/fractional tenor (e.g. 3, 9, 18 for 3M/9M/1.5Y), in months. When
    # set, this is the period actually used for curve bootstrapping instead of
    # tenor_years -- tenor_years alone can't represent anything short of a
    # whole year. tenor_years is still required and populated (a rounded
    # nominal value) so every existing call site that only knows about whole
    # years keeps working unchanged.
    tenor_months: int | None = None


@dataclass(frozen=True)
class MarketSnapshot:
    valuation_date: date
    cd_rate: float  # short-end deposit/fixing rate, decimal
    swap_quotes: list[RateQuote] = field(default_factory=list)  # par IRS quotes
    # Overnight (O/N, call rate) deposit rate, decimal -- optional because
    # True Data.xlsx doesn't carry it yet (CCP mode's curve grid does). None
    # means "no O/N pillar in this curve" (curve.py's build_curve skips the
    # O/N deposit helper entirely), not "O/N rate is zero".
    on_rate: float | None = None
