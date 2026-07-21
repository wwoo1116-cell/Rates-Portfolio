"""DV01-FIX — the SINGLE bond-DV01 derivation point (owner ruling: option A +
FRN carve-out + as-of detection; Phase B routes simulate onto THIS module).

Background (DV01_DIAG_REPORT.md + DV01_DIAG_ADDENDUM.md): the blotter's
pvbp/듀레이션/잔존일수 columns are a frozen single-dated snapshot (2026-03-23
in the current export; 잔존일수 − (maturity − today) = +113d uniformly), so
workbook PVBP overstates live risk by ×1.456 aggregate. The system's risk
truth is bump-reval DV01 (S6 convention).

Rules implemented here, and ONLY here (consumers must not fork):
  - fixed-coupon bond, schedulable → central ±0.5bp bump-reval on the
    engine's dirty NPV at the credit-curve yield; FRESH remaining-maturity
    bucketing. source="reval".
  - FRN ("(변)" in the name) → the sheet figure is reset-linked duration —
    the RIGHT concept for a floater; bump-reval of the fixed-coupon model
    would OVERSTATE those (~6 rows, addendum finding 1). Sheet value kept.
    source="sheet_frn".
  - not schedulable (missing static params, or curve lookup fails) → sheet
    value kept, stale bucket kept. source="sheet_fallback".
The per-source counts ride the API additively so a mixed basis is explicit,
never silent.

Schedule anchoring: value_bond generates FORWARD from issue_date. The
portfolio-analytics path carries the true 발행일자. The simulate wire
(FrontendPosition) does NOT — for that path a synthetic issue is anchored
BACKWARD from maturity in whole coupon periods, far enough to precede the
valuation date; for regular bonds this reproduces the maturity-anchored
coupon grid. Marked by the same "reval" source (approximation noted in
DV01_FIX_REPORT.md).
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import date
from typing import Iterable, Literal

from dateutil.relativedelta import relativedelta

from ..engine import bond_valuation
from . import credit_curve_service

FRN_MARKER = "(변)"
BUMP = 0.00005  # ±0.5bp central — the S6 bump-reval convention

Dv01Source = Literal["reval", "sheet_frn", "sheet_fallback"]


@dataclass(frozen=True)
class BondDv01:
    dv01: float
    source: Dv01Source
    """FRESH remaining-maturity bucket for reval/FRN-with-maturity rows;
    the caller-provided stale bucket for fallback rows."""
    bucket: str | None


def is_frn(name: str | None) -> bool:
    return bool(name) and FRN_MARKER in str(name)


def payment_frequency_for(sector: str, payment_frequency: int | None) -> int:
    """The one place the 2/4 sector convention lives server-side (mirrors the
    FE upload hydration: 국고/통안 semiannual, credit quarterly)."""
    if payment_frequency and payment_frequency > 0:
        return payment_frequency
    return 2 if sector in ("국고채", "통안채") else 4


def _synthetic_issue(maturity: date, freq: int, val_date: date) -> date:
    """Maturity-anchored issue for wire positions without 발행일자: step whole
    coupon periods back until strictly before val_date (plus one spare
    period so the schedule's first accrual covers val_date)."""
    months = max(1, round(12 / freq))
    issue = maturity
    while issue >= val_date:
        issue -= relativedelta(months=months)
    return issue - relativedelta(months=months)


def bond_dv01(
    *,
    name: str,
    sector: str,
    rating: str | None,
    valuation_date: date,
    sheet_pvbp: float,
    stale_bucket: str | None,
    maturity_date: date | None,
    coupon_rate: float | None,
    payment_frequency: int | None,
    notional: float | None,
    issue_date: date | None,
    market_yield: float | None = None,
) -> BondDv01:
    """`market_yield` (decimal): explicit bump base overriding the credit-curve
    lookup — the simulate wire carries no rating but does carry the bond's own
    민평수익율, which is the better base there (Phase B)."""
    from ..loaders.portfolio import _bucket_for_years  # local: avoids cycle

    fresh_years = (
        (maturity_date - valuation_date).days / 365.0 if maturity_date else None
    )
    fresh_bucket = (
        _bucket_for_years(fresh_years) if fresh_years is not None and fresh_years > 0 else stale_bucket
    )

    # FRN carve-out: reset-linked sheet duration IS the floater's risk.
    if is_frn(name):
        return BondDv01(dv01=sheet_pvbp, source="sheet_frn", bucket=fresh_bucket)

    schedulable = (
        maturity_date is not None
        and fresh_years is not None
        and fresh_years > 0
        and coupon_rate is not None
        and (notional or 0) > 0
    )
    if not schedulable:
        return BondDv01(dv01=sheet_pvbp, source="sheet_fallback", bucket=stale_bucket)

    freq = payment_frequency_for(sector, payment_frequency)
    issue = issue_date or _synthetic_issue(maturity_date, freq, valuation_date)
    try:
        y = (
            market_yield
            if market_yield is not None
            else credit_curve_service.market_yield_for(sector, rating, fresh_years, valuation_date)
        )

        def npv(yy: float) -> float:
            return bond_valuation.value_bond(
                asset_id=name,
                issue_date=issue,
                maturity_date=maturity_date,
                coupon_rate=coupon_rate,
                payment_frequency=freq,
                notional=notional or 0.0,
                market_yield=yy,
                val_date=valuation_date,
            ).npv

        dv01 = npv(y - BUMP) - npv(y + BUMP)  # per 1bp (central ±0.5bp)
    except ValueError:
        return BondDv01(dv01=sheet_pvbp, source="sheet_fallback", bucket=stale_bucket)
    if dv01 <= 0:
        return BondDv01(dv01=sheet_pvbp, source="sheet_fallback", bucket=stale_bucket)
    return BondDv01(dv01=dv01, source="reval", bucket=fresh_bucket)


def detect_blotter_as_of(
    rows: Iterable[tuple[date | None, int | float | None]],
) -> date | None:
    """The blotter snapshot's own as-of, from the diagnosis fingerprint:
    per bond, 잔존일수 was correct on `maturity − remaining_days`; the modal
    such date across bonds IS the snapshot date. Degrades gracefully on a
    fresh export (modal date ≈ today — the caller decides whether a lag is
    worth a notice; this function only measures). None when nothing is
    measurable."""
    votes: Counter[date] = Counter()
    for maturity, remaining in rows:
        if maturity is None or not remaining or remaining <= 0:
            continue
        votes[maturity - relativedelta(days=int(remaining))] += 1
    if not votes:
        return None
    return votes.most_common(1)[0][0]
