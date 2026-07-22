"""
CD91 fixing selection for KRW CD-IRS floating legs -- the single shared
implementation. Every valuation path (npv_trace_service, mtm_service,
portfolio_service, and everything built on them) prices through
engine.mtm_valuation.value_booked_trade, which resolves each floating
period's rate here; there are deliberately no service-local reimplementations
(the 2026-07 diagnosis found three divergent ones: valuation-date ffill in
the trace, and max(fixings.keys()) look-ahead in mtm/portfolio).

CONVENTION (owner-confirmed desk convention for KRW CD-IRS)
-----------------------------------------------------------
The floating rate for a period with reset date R is the CD91 fixing
published on the fixing date

    F(R) = R minus CD_FIXING_LAG_SEOUL_BDAYS Seoul business days

computed with business-day arithmetic (a Monday reset fixes off Friday's
CD -- or earlier around holidays -- never "calendar minus one"). Once F(R)
has passed, the period's rate is immutable: it never re-fixes as the
valuation date advances, and a fixing dated after the valuation date is
never selected (no look-ahead into the future on historical valuations).

DATA-AVAILABILITY FALLBACK (not part of the convention)
-------------------------------------------------------
If the store has no fixing dated exactly F(R), the last available fixing
<= F(R) is used (ffill) so a data gap degrades gracefully instead of
silently flipping the period onto the curve forward. But F(R) is a Seoul
business day by construction, so on any such day a real CD91 print should
exist -- an ffill hit is therefore a DATA-QUALITY EVENT, surfaced via
FixingResolution.is_exact=False (callers log it and carry it into their
payloads next to the existing quote-freshness fields), never a silent
substitution.

All rates here are annualized DECIMALS (0.0251 == 2.51%), per the boundary
convention in engine/mtm_valuation.py.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Iterable, Mapping

# _is_kr_business_day is quant_engine-private by naming convention, but
# quant_engine must stay byte-identical to its authoritative source, so the
# calendar cannot be re-exported from there; importing it is the established
# glue-layer pattern (scripts/diag_pnl_trace.py does the same).
from .quant_engine import _is_kr_business_day

# Owner-confirmed desk convention for KRW CD-IRS: the CD91 fixing for a
# period is taken ONE Seoul business day before the reset date. Kept as a
# named constant (and threaded through as a default argument) so a desk that
# fixes same-day (0) or T-2 can switch it in one place.
CD_FIXING_LAG_SEOUL_BDAYS = 1


@dataclass(frozen=True)
class FixingResolution:
    """How one floating period's rate was resolved from the fixing store."""

    reset_date: date
    fixing_date: date          # F(R), always a Seoul business day
    resolved_date: date | None  # store key actually used; None = nothing <= F(R)
    rate: float | None          # decimal; None = period must fall back to the forward
    is_exact: bool              # resolved_date == fixing_date

    @property
    def is_data_quality_event(self) -> bool:
        """True when a period that should be fixed had no fixing dated F(R):
        either an ffill substitution or a total miss. F(R) is a business day
        by construction, so a real print should have existed."""
        return not self.is_exact and _is_kr_business_day(self.fixing_date)

    def to_payload(self) -> dict:
        return {
            "reset_date": self.reset_date.isoformat(),
            "fixing_date": self.fixing_date.isoformat(),
            "resolved_date": self.resolved_date.isoformat() if self.resolved_date else None,
            "rate": self.rate,
        }


def prev_seoul_business_day(d: date, n: int = 1) -> date:
    """`n` Seoul business days strictly before `d` (business-day arithmetic)."""
    out = d
    for _ in range(n):
        out -= timedelta(days=1)
        while not _is_kr_business_day(out):
            out -= timedelta(days=1)
    return out


def fixing_date_for_reset(reset_date: date, lag: int = CD_FIXING_LAG_SEOUL_BDAYS) -> date:
    """F(R): the date whose CD91 print fixes the period resetting on R."""
    if lag <= 0:
        return reset_date
    return prev_seoul_business_day(reset_date, lag)


def select_fixing(
    fixings: Mapping[date, float],
    reset_date: date,
    valuation_date: date,
    lag: int = CD_FIXING_LAG_SEOUL_BDAYS,
) -> FixingResolution | None:
    """Resolve the fixing for a period with reset date `reset_date`.

    Returns None when F(R) is after `valuation_date` -- the period is not yet
    fixed and must be priced off the curve forward. Otherwise returns a
    FixingResolution whose `rate` is the fixing (exact hit at F(R), or ffill
    to the last available print <= F(R)); `rate` is None only when the store
    has nothing on or before F(R) at all.
    """
    f_date = fixing_date_for_reset(reset_date, lag)
    if f_date > valuation_date:
        return None
    exact = fixings.get(f_date)
    if exact is not None:
        return FixingResolution(reset_date, f_date, f_date, exact, True)
    past = [k for k in fixings if k <= f_date]
    if past:
        k = max(past)
        return FixingResolution(reset_date, f_date, k, fixings[k], False)
    return FixingResolution(reset_date, f_date, None, None, False)


def dedupe_data_quality_events(
    resolutions: Iterable[FixingResolution],
) -> list[FixingResolution]:
    """The data-quality warnings in `resolutions`, deduplicated preserving
    order. Valuation loops resolve the same period once per date, so the raw
    stream repeats; consumers log/surface each distinct event once."""
    seen: set[tuple] = set()
    out: list[FixingResolution] = []
    for r in resolutions:
        if not r.is_data_quality_event:
            continue
        key = (r.reset_date, r.fixing_date, r.resolved_date)
        if key not in seen:
            seen.add(key)
            out.append(r)
    return out
