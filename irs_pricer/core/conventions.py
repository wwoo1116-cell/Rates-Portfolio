"""
QuantLib conventions shared by curve construction and pricing.
Calendar/holiday handling is fully delegated to QuantLib (SouthKorea calendar).
"""

from __future__ import annotations

from datetime import date

import QuantLib as ql

CALENDAR = ql.SouthKorea()
DAY_COUNT = ql.Actual365Fixed()
SPOT_DAYS = 1
FIXED_LEG_FREQUENCY = ql.Quarterly
FLOAT_LEG_TENOR = ql.Period(3, ql.Months)
BUSINESS_CONVENTION = ql.ModifiedFollowing


def to_ql_date(d: date) -> ql.Date:
    return ql.Date(d.day, d.month, d.year)


def from_ql_date(d: ql.Date) -> date:
    return date(d.year(), d.month(), d.dayOfMonth())
