"""Allocation history: RP Fund's sector-risk and maturity profile across five
calendar-anchored snapshots (last year-end → last month-end → last week-end →
yesterday → current).

WHAT THIS IS NOT: real position history. This deployment has no positions DB --
the uploaded workbook in the browser IS the ledger (see
stores/manual-positions-store.ts) -- so there is no record of what was actually
held on a past date. Every column here revalues TODAY's holdings against the
market data of that date. It answers "what would today's book have looked like
then", not "what did we hold then". The UI must label it as such.

Two deliberate metric choices:
  - Sector chart plots PVBP (risk) share, not 평가금액 share. Allocation shares
    only move when you trade or when *relative* prices move, so over a constant
    book a year of KRW credit moves shifts value weights ~±1% -- five identical
    bars. Risk share moves materially via roll-down and spread changes.
  - Maturity chart plots 평가금액 share, which moves on its own: remaining
    maturity is recomputed at each date, so bonds roll between buckets
    (a 3.2Y bond a year ago is 2.2Y today -- 장기 → 중기).

Bonds only. build_book_summary derives sector/maturity from bonds exclusively
(IRS contributes only to hedged duration), so this never touches the IRS curve
bootstrap -- which is what keeps it sub-second.
"""

from __future__ import annotations

import logging
from bisect import bisect_right
from dataclasses import dataclass
from datetime import date, timedelta

from ..engine import bond_valuation
from . import credit_curve_service, market_data_service

logger = logging.getLogger(__name__)

# Coarse 3-bucket maturity scheme. Shared with portfolio_analytics_service's
# build_book_summary so the two can't drift -- note this is deliberately NOT
# loaders/portfolio.py's 16-tenor _bucket_for_years(), which is a different,
# finer scheme serving the PVBP grid.
BUCKET_SHORT = "단기(1년 미만)"
BUCKET_MID = "중기(1~3년)"
BUCKET_LONG = "장기(3년 이상)"
MATURITY_BUCKETS: list[str] = [BUCKET_SHORT, BUCKET_MID, BUCKET_LONG]


def maturity_bucket(remaining_years: float) -> str:
    if remaining_years < 1:
        return BUCKET_SHORT
    if remaining_years < 3:
        return BUCKET_MID
    return BUCKET_LONG


# x-axis order, oldest → newest.
ANCHORS: list[tuple[str, str]] = [
    ("lastYearEnd", "Last Year-End"),
    ("lastMonthEnd", "Last Month-End"),
    ("lastWeekEnd", "Last Week-End"),
    ("prevDay", "Yesterday"),
    ("current", "Current"),
]

_ONE_BP = 0.0001


@dataclass(frozen=True)
class BondSnapshotInput:
    position_id: str
    book: str
    sector: str
    rating: str | None
    issue_date: date
    maturity_date: date
    coupon_rate: float      # percent, e.g. 3.125
    payment_frequency: int  # coupons per year (2 govt / 4 credit)
    notional: float


def _raw_anchor_dates(as_of: date) -> dict[str, date]:
    """The calendar target for each anchor, before snapping to a date the
    market data actually has."""
    return {
        # Dec 31 of last year; snapping walks back to the last trading day.
        "lastYearEnd": date(as_of.year - 1, 12, 31),
        # Last day of the previous month.
        "lastMonthEnd": as_of.replace(day=1) - timedelta(days=1),
        # The Sunday before this week's Monday; snapping lands on last Friday.
        "lastWeekEnd": as_of - timedelta(days=as_of.weekday() + 1),
        # Snapping to "<= as_of - 1" is exactly "latest available < as_of".
        "prevDay": as_of - timedelta(days=1),
        "current": as_of,
    }


def _snap(anchor: date, available: list[date]) -> date | None:
    """Latest available date at or before `anchor`; None if the anchor predates
    all market data. `available` must be sorted ascending."""
    i = bisect_right(available, anchor)
    return available[i - 1] if i else None


def resolve_anchors(as_of: date, available: list[date]) -> list[tuple[str, str, date | None]]:
    """(key, label, resolved_date) for all five anchors, oldest → newest.

    Anchors are allowed to COLLIDE and both are kept: on a Monday `prevDay` and
    `lastWeekEnd` both resolve to last Friday; in early January `lastMonthEnd`
    and `lastYearEnd` are the same date. Emitting all five regardless keeps the
    x-axis at a stable five columns whose labels always mean the same thing --
    deduping would make the chart's width and label set shift day to day.

    An anchor older than all available data resolves to None; the caller emits
    an empty column rather than dropping it, for the same stability reason.
    """
    raw = _raw_anchor_dates(as_of)
    return [(key, label, _snap(raw[key], available)) for key, label in ANCHORS]


class NotHeldOn(Exception):
    """The bond was outside its own life at this date -- not yet issued, or
    already matured. An expected, per-date condition, not a data problem. Kept
    distinct from an unpriceable bond so the two aren't conflated in the
    response: an RP book turns over fast, so a chunk of today's holdings
    legitimately post-date the last-year-end column."""


def revalue_bond(bond: BondSnapshotInput, d: date) -> tuple[float, float] | None:
    """(npv, pvbp) for one bond at date `d`.

    Public because it is THE single revaluation path for "today's book at date
    d": the allocation charts and portfolio_analytics_service.build_period_pnl
    both go through here, so their figures can never disagree on pricing.

    pvbp is the KRW change in NPV per +1bp of market yield (negative for a long
    bond).

    Raises NotHeldOn if the bond wasn't alive at `d`. Returns None if it was but
    can't be priced (no credit curve for its sector/rating).
    """
    if bond.issue_date > d:
        # The bond did not exist yet. value_bond would happily discount its full
        # coupon schedule and return a confident price for a phantom holding.
        raise NotHeldOn
    remaining_years = (bond.maturity_date - d).days / 365.0
    if remaining_years <= 0:
        # Already matured at d. Not merely defensive: an uploaded blotter can be
        # older than the newest market data (its 기준일자 lags), so holdings that
        # have since matured are still in the file and must drop out of the
        # columns that post-date them.
        raise NotHeldOn

    try:
        market_yield = credit_curve_service.market_yield_for(
            bond.sector, bond.rating, remaining_years, val_date=d
        )
    except ValueError:
        # Unknown sector/rating -- e.g. loaders/portfolio.py maps anything it
        # doesn't recognise to the "기타" catch-all, which has no credit curve.
        # Skip it (and disclose the count) rather than 500 the whole panel.
        return None

    def npv_at(y: float) -> float:
        return bond_valuation.value_bond(
            asset_id=bond.position_id,
            issue_date=bond.issue_date,
            maturity_date=bond.maturity_date,
            coupon_rate=bond.coupon_rate,
            payment_frequency=bond.payment_frequency,
            notional=bond.notional,
            market_yield=y,
            val_date=d,
        ).npv

    npv = npv_at(market_yield)
    return npv, npv_at(market_yield + _ONE_BP) - npv


def _shares(totals: dict[str, float]) -> dict[str, float]:
    total = sum(totals.values())
    if total <= 0:
        return {}
    return {k: (v / total) * 100.0 for k, v in totals.items()}


def build_allocation_history(
    positions: list[BondSnapshotInput],
    book: str | None = None,
    as_of_date: date | None = None,
) -> dict:
    """Sector-PVBP-share and maturity-평가금액-share for each of the five
    anchors. See module docstring for what the past columns actually mean.

    Returns the flat row shape a stacked-bar renderer consumes directly:
        {"sector":   {"keys": [...], "rows": [{key, label, valuationDate, <series>: pct}]},
         "maturity": {...},
         "asOfDate": "...", "skippedPositions": N}
    """
    bonds = [p for p in positions if book is None or p.book == book]

    available = market_data_service.list_available_dates()
    if not available:
        raise ValueError("사용 가능한 시장 데이터가 없습니다.")
    as_of = as_of_date or available[-1]

    anchors = resolve_anchors(as_of, available)

    sector_by_anchor: dict[str, dict[str, float]] = {}
    maturity_by_anchor: dict[str, dict[str, float]] = {}
    held_by_anchor: dict[str, int] = {}
    unpriceable: set[str] = set()

    for key, _label, d in anchors:
        sector_totals: dict[str, float] = {}
        maturity_totals: dict[str, float] = {}
        held = 0
        if d is not None:
            for bond in bonds:
                try:
                    priced = revalue_bond(bond, d)
                except NotHeldOn:
                    continue
                if priced is None:
                    unpriceable.add(bond.position_id)
                    continue
                held += 1
                npv, pvbp = priced
                # Holdings are long-only, so every pvbp shares a sign and abs()
                # gives a well-defined share. A 100% stack over SIGNED values is
                # undefined -- revisit if short bond positions ever appear.
                sector_totals[bond.sector] = sector_totals.get(bond.sector, 0.0) + abs(pvbp)
                bucket = maturity_bucket((bond.maturity_date - d).days / 365.0)
                maturity_totals[bucket] = maturity_totals.get(bucket, 0.0) + npv
        held_by_anchor[key] = held
        sector_by_anchor[key] = _shares(sector_totals)
        maturity_by_anchor[key] = _shares(maturity_totals)

    if unpriceable:
        logger.warning(
            "allocation-history: %d position(s) have no credit curve for their "
            "sector/rating and are excluded from every column", len(unpriceable)
        )

    # Stable series order, keyed off the current column so stack order and
    # colours don't reshuffle between columns.
    current_sector = sector_by_anchor.get("current", {})
    sector_keys = sorted(
        {s for shares in sector_by_anchor.values() for s in shares},
        key=lambda s: (-current_sector.get(s, 0.0), s),
    )
    maturity_keys = [b for b in MATURITY_BUCKETS
                     if any(b in shares for shares in maturity_by_anchor.values())]

    def rows(by_anchor: dict[str, dict[str, float]], keys: list[str]) -> list[dict]:
        out = []
        for key, label, d in anchors:
            row: dict = {
                "key": key,
                "label": label,
                "valuationDate": d.isoformat() if d else None,
                # How many bonds this column is actually over. Older columns are
                # legitimately smaller -- holdings bought since then didn't exist
                # yet -- so the UI can disclose the denominator rather than imply
                # every column covers the same book.
                "positionCount": held_by_anchor[key],
            }
            shares = by_anchor[key]
            for k in keys:
                # Deliberately unrounded: these are segment heights of a 100%
                # stack, and rounding each to 4dp leaves the column summing to
                # 99.9999. Format at the point of display instead.
                row[k] = shares.get(k, 0.0)
            out.append(row)
        return out

    return {
        "asOfDate": as_of.isoformat(),
        "totalPositions": len(bonds),
        # Bonds excluded from EVERY column because their sector/rating has no
        # credit curve. Distinct from the per-column positionCount above, which
        # varies for the expected reason (not yet issued).
        "unpriceablePositions": len(unpriceable),
        "sector": {"keys": sector_keys, "rows": rows(sector_by_anchor, sector_keys)},
        "maturity": {"keys": maturity_keys, "rows": rows(maturity_by_anchor, maturity_keys)},
    }
