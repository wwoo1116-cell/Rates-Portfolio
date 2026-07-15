"""
Domain-level exceptions and calendar-based business-day validation.

Kept in `core/` because the rule (is this date a KRX business day?) is a
domain invariant enforced before any I/O or computation takes place.

QuantLib-free: business-day validation uses the same `holidays.KR` source
that quant_engine.py's internal calendar uses, so the input-validation
calendar and the pricing calendar never disagree. core/ deliberately does
NOT import engine/ (engine depends on core, not the reverse), so the holiday
set is constructed here independently rather than reaching into
engine.quant_engine.
"""

from __future__ import annotations

from datetime import date

try:  # mirror engine.quant_engine's _KR_HOLIDAYS construction
    import holidays as _holidays_lib

    _KR_HOLIDAYS = _holidays_lib.KR(years=range(2010, 2036))
except Exception:  # holidays unavailable -> weekend-only validation
    _KR_HOLIDAYS = set()


class NonBusinessDayError(ValueError):
    """Raised when the requested date is a weekend or public holiday."""

    def __init__(self, d: date, reason: str) -> None:
        self.date = d
        self.reason = reason
        super().__init__(f"{d}은(는) 영업일이 아닙니다 ({reason})")


class CurveBootstrapError(ValueError):
    """Raised when the zero-curve bootstrap can't solve for a pillar --
    typically an implausible/out-of-scale market rate (e.g. a CCP curve row
    typed as a raw percent without converting to decimal). Surfaced as a
    clean 400 (see api/app.py's exception handler) instead of a raw engine
    error bubbling up as an opaque 500."""

    def __init__(self, original: Exception) -> None:
        self.original = original
        super().__init__(
            f"금리 커브를 생성할 수 없습니다 — 입력된 금리 값을 확인하세요 (원본 오류: {original})"
        )


def _check_business_day(d: date) -> None:
    """Raise NonBusinessDayError if d is a weekend or KRX holiday."""
    if d.weekday() >= 5:
        day_name = "토요일" if d.weekday() == 5 else "일요일"
        raise NonBusinessDayError(d, day_name)
    if d in _KR_HOLIDAYS:
        raise NonBusinessDayError(d, "공휴일")
