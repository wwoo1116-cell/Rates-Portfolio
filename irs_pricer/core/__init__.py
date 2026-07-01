"""
Core domain contracts: pure Python data models, errors, and QuantLib conventions.

No I/O, no HTTP. Every other layer may import from here; this layer imports
nothing from within the package.
"""

from .conventions import (
    BUSINESS_CONVENTION,
    CALENDAR,
    DAY_COUNT,
    FIXED_LEG_FREQUENCY,
    FLOAT_LEG_TENOR,
    SPOT_DAYS,
    from_ql_date,
    to_ql_date,
)
from .errors import NonBusinessDayError, _check_business_day
from .market_data import MarketSnapshot, RateQuote

__all__ = [
    # conventions
    "BUSINESS_CONVENTION",
    "CALENDAR",
    "DAY_COUNT",
    "FIXED_LEG_FREQUENCY",
    "FLOAT_LEG_TENOR",
    "SPOT_DAYS",
    "from_ql_date",
    "to_ql_date",
    # errors
    "NonBusinessDayError",
    "_check_business_day",
    # market data
    "MarketSnapshot",
    "RateQuote",
]
