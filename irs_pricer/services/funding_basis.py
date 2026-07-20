"""SIM2-7 — historical funding basis (owner ruling, 2026-07-20).

The flat POLICY_BASE_RATE_KRW + FUNDING_SPREAD_BP constant is only valid for
FUTURE dates. For any date the repo's BOK base-rate series covers
(Data/BOK Base Rate.xlsx via loaders/base_rate.py), funding is the ACTUAL
historical base rate at that date + the spread, stepped at the series' real
change dates.

Timeline join: historical stairs while series data exists → from the last
series date forward, the policy constant (+ spread) → SIM2-5 user 금통위
events stack on top when fundingStepping is on (calc_dynamic_funding_rate
applies them to whatever base this module resolves). One continuous
staircase; no double-counting at the join.

Staleness rule (s18 provenance nuance — the constant exists BECAUSE the
series has lagged decisions before): if the series' latest value differs
from POLICY_BASE_RATE_KRW the series is STALE; the join stays at the last
series date and the constant governs beyond it — a stale series must never
rewrite funding after its own coverage. Adjudicated at runtime and exported
via provenance() for the response/report. (Measured at SIM2-7 execution:
coverage 2016-01-01 → 2026-07-16, latest 0.0275 == the constant → NOT stale;
the hike row 2026-07-16 is present, so the staircase is value-continuous at
the join.)

Pre-coverage dates (before 2016-01-01, e.g. deep PnL-Trace windows): the
ruling covers "dates the series covers"; extrapolating the CONSTANT backward
would be absurd (2.75% in 2010) — the earliest series value is flat-extended
backward instead, a documented approximation, provenance-flagged.
"""

from __future__ import annotations

from bisect import bisect_right
from datetime import date
from functools import lru_cache

from ..config import DATA_DIR
from ..loaders import base_rate
from .simulation.constants import FUNDING_SPREAD_BP, POLICY_BASE_RATE_KRW


@lru_cache(maxsize=1)
def _series() -> tuple[tuple[date, ...], dict[date, float]]:
    rates = base_rate.all_rates(DATA_DIR)
    return tuple(sorted(rates)), rates


def join_date() -> date | None:
    """Last series-covered date — the historical→constant join point."""
    ks, _ = _series()
    return ks[-1] if ks else None


def is_stale() -> bool:
    """True when the series' latest value disagrees with the policy constant
    (the series lagged an MPC decision)."""
    ks, m = _series()
    return bool(ks) and m[ks[-1]] != POLICY_BASE_RATE_KRW


def base_rate_at(d: date) -> float:
    """The funding BASE rate for date d: series step-function within coverage
    (last row ≤ d; earliest row flat-extended backward before coverage), the
    policy constant beyond the join."""
    ks, m = _series()
    if not ks or d > ks[-1]:
        return POLICY_BASE_RATE_KRW
    i = bisect_right(ks, d) - 1
    return m[ks[max(i, 0)]]


def funding_rate_at(d: date) -> float:
    """base_rate_at + the funding spread — the per-day fixed-mode funding rate
    BEFORE any SIM2-5 event stepping (calc_dynamic_funding_rate adds those)."""
    return base_rate_at(d) + FUNDING_SPREAD_BP / 10000.0


def provenance() -> dict:
    """Additive response/report payload: where funding came from."""
    ks, m = _series()
    return {
        "seriesStart": ks[0].isoformat() if ks else None,
        "joinDate": ks[-1].isoformat() if ks else None,
        "seriesLatestRate": m[ks[-1]] if ks else None,
        "policyRate": POLICY_BASE_RATE_KRW,
        "spreadBp": FUNDING_SPREAD_BP,
        "stale": is_stale(),
    }
