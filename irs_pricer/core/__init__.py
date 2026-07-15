"""
Core domain contracts: pure Python data models, errors, and conventions.
"""

from .conventions import (
    SPOT_DAYS,
    from_ql_date,
    to_ql_date,
)
from .errors import CurveBootstrapError, NonBusinessDayError, _check_business_day
from .market_data import MarketSnapshot, RateQuote

__all__ = [
    # conventions
    "SPOT_DAYS",
    "from_ql_date",
    "to_ql_date",
    # errors
    "NonBusinessDayError",
    "CurveBootstrapError",
    "_check_business_day",
    # market data
    "MarketSnapshot",
    "RateQuote",
]
