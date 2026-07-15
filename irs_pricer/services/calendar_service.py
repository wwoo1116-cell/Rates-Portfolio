"""
Calendar service: exposes business-day logic using quant_engine's internal calendar
(replacing QuantLib) to the frontend date picker, so the picker and the pricer can
never disagree on what counts as a valid trade date.
"""

from __future__ import annotations

from datetime import date, timedelta
from dateutil.relativedelta import relativedelta

from ..core.errors import NonBusinessDayError
from ..engine.quant_engine import _is_kr_business_day, _modfol_bd, next_kr_business_day

MAX_RANGE_DAYS = 3 * 366


def _check_business_day(d: date):
    # Raise the domain error (not a bare ValueError) so the calendar routers'
    # NonBusinessDayError handlers map it to a clean 400 -- /spot-date only
    # catches NonBusinessDayError, so a bare ValueError here escaped as a 500.
    # Authority stays quant_engine's calendar (_is_kr_business_day), keeping the
    # date picker and the pricer in agreement.
    if not _is_kr_business_day(d):
        raise NonBusinessDayError(d, "주말" if d.weekday() >= 5 else "공휴일")


def non_business_days(start: date, end: date) -> list[date]:
    """Every weekend or KRX holiday in [start, end], inclusive."""
    if end < start:
        raise ValueError("end는 start보다 앞설 수 없습니다.")
    if (end - start).days > MAX_RANGE_DAYS:
        raise ValueError(f"조회 범위는 최대 {MAX_RANGE_DAYS}일까지 가능합니다.")

    days = []
    d = start
    one_day = timedelta(days=1)
    while d <= end:
        if not _is_kr_business_day(d):
            days.append(d)
        d += one_day
    return days


def tenor_maturity_date(start_date: date, months: int) -> date:
    """start_date + tenor, adjusted with the same Modified Following
    convention that schedule generation (instruments.py) uses for period end dates.
    """
    if months <= 0:
        raise ValueError("tenor는 0개월보다 커야 합니다.")
    _check_business_day(start_date)
    raw_date = start_date + relativedelta(months=months)
    return _modfol_bd(raw_date)


def spot_date(valuation_date: date) -> date:
    """valuation_date + SPOT_DAYS business days (T+1 lag)."""
    _check_business_day(valuation_date)
    return next_kr_business_day(valuation_date)
