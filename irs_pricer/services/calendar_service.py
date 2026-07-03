"""
Calendar service: exposes QuantLib's SouthKorea business-day calendar (the
same CALENDAR/BUSINESS_CONVENTION used by curve bootstrapping and schedule
generation) to the frontend date picker, so the picker and the pricer can
never disagree on what counts as a valid trade date.
"""

from __future__ import annotations

from datetime import date, timedelta

import QuantLib as ql

from ..core.conventions import BUSINESS_CONVENTION, CALENDAR, SPOT_DAYS, from_ql_date, to_ql_date
from ..core.errors import _check_business_day

# A date picker only ever needs holidays for the handful of months currently
# on screen; capping the range keeps one wide-open query from walking years
# of calendar days.
MAX_RANGE_DAYS = 3 * 366


def non_business_days(start: date, end: date) -> list[date]:
    """Every weekend or KRX holiday in [start, end], inclusive.

    Weekends are included alongside holidays (rather than left for the
    frontend to derive from day-of-week) so there is exactly one place --
    this calendar -- that decides what counts as a business day.
    """
    if end < start:
        raise ValueError("end는 start보다 앞설 수 없습니다.")
    if (end - start).days > MAX_RANGE_DAYS:
        raise ValueError(f"조회 범위는 최대 {MAX_RANGE_DAYS}일까지 가능합니다.")

    days = []
    d = start
    one_day = timedelta(days=1)
    while d <= end:
        if d.weekday() >= 5 or not CALENDAR.isBusinessDay(to_ql_date(d)):
            days.append(d)
        d += one_day
    return days


def tenor_maturity_date(start_date: date, months: int) -> date:
    """start_date + tenor, adjusted with the same Modified Following
    convention that schedule generation (instruments.py) uses for period end
    dates -- so a tenor button always lands on a date the picker itself
    would allow.
    """
    if months <= 0:
        raise ValueError("tenor는 0개월보다 커야 합니다.")
    _check_business_day(start_date)  # picker only allows business-day starts; reject anything else defensively
    adjusted = CALENDAR.advance(to_ql_date(start_date), ql.Period(months, ql.Months), BUSINESS_CONVENTION, False)
    return from_ql_date(adjusted)


def spot_date(valuation_date: date) -> date:
    """valuation_date + SPOT_DAYS business days -- the standard market
    convention start date for a brand-new spot-starting swap (same T+1 lag
    build_curve() uses for curve.settlement_date). Used to default a new
    position's 시작일, forward from TODAY -- not derived backward from an
    arbitrary start_date, which is a different (and invalid in general)
    calculation."""
    _check_business_day(valuation_date)
    return from_ql_date(CALENDAR.advance(to_ql_date(valuation_date), SPOT_DAYS, ql.Days))
