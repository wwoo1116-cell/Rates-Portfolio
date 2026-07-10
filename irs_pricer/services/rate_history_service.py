"""
Rate history service: daily time series of CD91D, O/N, BOK base rate, and IRS
tenor rates for the Overview/RV dashboard.

Unlike pricing_service/portfolio_service, nothing here touches QuantLib --
these are raw market-data reads across a date range, not valuations.

get_rate_history()'s response already carries every tenor for every date, so
a frontend that already has that payload can subtract any two tenors itself
with no extra round trip -- get_rate_spread() below exists anyway for
callers that only want one specific spread series (e.g. a dedicated
"/spread" request instead of fetching the full curve).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from pathlib import Path

from ..engine.curve import _quote_label
from ..loaders.base_rate import load_base_rate
from . import market_data_service

_DATA_DIR = Path(__file__).resolve().parent.parent.parent  # irs_pricer/services/ -> project root


@dataclass
class RateHistoryPoint:
    valuation_date: date
    cd_rate: float
    on_rate: float | None
    base_rate: float | None
    tenor_rates: dict[str, float]  # tenor label ("6M", "1Y", "1.5Y", ...) -> decimal rate


def get_rate_history(start_date: date, end_date: date) -> list[RateHistoryPoint]:
    """One RateHistoryPoint per business date with usable market data in
    [start_date, end_date] (inclusive). Dates the KRX calendar rejects as a
    non-business day, or that no data source covers, are silently skipped --
    a chart is fine with gaps; the frontend isn't expected to reconcile them.

    Iterates market_data_service.load_snapshot() per date -- its own DB-first/
    Excel-fallback logic short-circuits to Excel-only after the first DB
    failure (see market_data_service._db_market_data_unavailable), so a bulk
    multi-thousand-date request here doesn't pay a per-date DB round-trip."""
    dates = [d for d in market_data_service.list_available_dates() if start_date <= d <= end_date]

    points: list[RateHistoryPoint] = []
    for d in dates:
        try:
            snapshot = market_data_service.load_snapshot(d)
        except ValueError:
            # Covers NonBusinessDayError (a ValueError subclass) and the
            # loaders' plain ValueErrors for a date genuinely missing from
            # True Data.xlsx (e.g. before its real coverage begins, even
            # though market_data_service.list_available_dates() -- sourced
            # from a different, longer-history file -- includes it).
            continue
        points.append(
            RateHistoryPoint(
                valuation_date=d,
                cd_rate=snapshot.cd_rate,
                on_rate=snapshot.on_rate,
                base_rate=load_base_rate(_DATA_DIR, d),
                tenor_rates={_quote_label(q): q.rate for q in snapshot.swap_quotes},
            )
        )
    return points


@dataclass
class SpreadPoint:
    valuation_date: date
    spread_bp: float


def _tenor_rate(point: RateHistoryPoint, label: str) -> float | None:
    """'cd_rate'/'on_rate' read the point's own top-level field (matching
    RateHistoryPoint's shape); anything else is a tenor_rates label."""
    if label in ("cd_rate", "on_rate"):
        return getattr(point, label)
    return point.tenor_rates.get(label)


def get_rate_spread(start_date: date, end_date: date, short: str, long: str) -> list[SpreadPoint]:
    """(long - short) tenor spread, in bp, for every date in [start_date,
    end_date] where BOTH tenors have a rate. `short`/`long` are labels as
    they appear in RateHistoryPoint ("cd_rate", "6M", "1Y", "1.5Y", ...)."""
    points = get_rate_history(start_date, end_date)
    spread_points: list[SpreadPoint] = []
    for p in points:
        short_rate = _tenor_rate(p, short)
        long_rate = _tenor_rate(p, long)
        if short_rate is None or long_rate is None:
            continue
        spread_points.append(SpreadPoint(valuation_date=p.valuation_date, spread_bp=(long_rate - short_rate) * 10000))
    return spread_points
