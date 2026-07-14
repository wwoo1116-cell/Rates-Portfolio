"""
Credit-curve service: exposes the credit_matrix taxonomy as browsable
instruments and pulls per-(sector, rating, tenor) yield time series for the
Rates History / RV selector.

Only credit_matrix-backed sectors are served here (국고채 + the four rated
credit sectors). IRS is deliberately NOT handled here -- the frontend already
fetches the full IRS curve once via /api/rate-history (for its click-to-trace
interaction) and resolves IRS legs from that, so routing IRS through here too
would just duplicate that fetch. The taxonomy tree still lists IRS (for the
dropdowns); its series simply come from the other endpoint.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

from ..loaders import credit_matrix, credit_taxonomy

_DATA_DIR = Path(__file__).resolve().parent.parent.parent  # irs_pricer/services/ -> project root


def get_taxonomy() -> dict:
    """Static instrument tree for the selector dropdowns: every sector with its
    ordered rating list (empty for unrated 국고채 and IRS) and tenor list
    (16 credit tenors, or 20 IRS tenors). No file I/O -- derived from the
    curated credit_taxonomy tables."""
    return {
        "sectors": [
            {
                "sector": sector,
                "ratings": credit_taxonomy.ratings_for(sector),
                "tenors": credit_taxonomy.tenors_for(sector),
            }
            for sector in credit_taxonomy.SECTOR_ORDER
        ]
    }


def get_series(
    sector: str,
    rating: str | None,
    tenor: str,
    start_date: date | None = None,
    end_date: date | None = None,
) -> list[dict]:
    """Decimal-rate time series for one credit_matrix-backed leg, as
    [{valuation_date, value}] ascending by date.

    Raises ValueError for an IRS leg (served elsewhere) or an unknown
    sector/rating/tenor combination, so a bad request comes back as a clean
    400 rather than an empty-but-silent series."""
    if sector == credit_taxonomy.IRS_SECTOR:
        raise ValueError("IRS 시리즈는 /api/rate-history에서 제공됩니다.")

    category = credit_taxonomy.raw_category(sector, rating or credit_taxonomy.NO_RATING)
    if category is None:
        raise ValueError(f"알 수 없는 섹터/등급입니다: {sector} / {rating}")

    raw_tenor = credit_taxonomy.CREDIT_TENORS.get(tenor)
    if raw_tenor is None:
        raise ValueError(f"알 수 없는 테너입니다: {tenor}")

    series = credit_matrix.category_series(_DATA_DIR, category, raw_tenor, start_date, end_date)
    return [{"valuation_date": d, "value": v} for d, v in series]
