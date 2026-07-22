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

# ── s15 T1: 조달금리 스펙 — 기준금리 + 10bp, 전 기간 고정 ─────────────────────
# 소유자 결정(2026-07-16): 조달금리는 "정책 기준금리(기준금리) + 10bp"의 단일
# 상수이고 시뮬레이션 전 기간에 걸쳐 고정이다 — 데이터 조회도, 금통위 이벤트
# 경로 스테핑도 없다(금통위 연동 조달 경로는 명시적으로 범위 밖). 이 상수 쌍이
# 조달 스트립(fundingCurve), 헤더 캐리 칩, Total Return 캐리 계산이 소비하는
# 유일한 원천이다.
#
# 값의 출처(s18 T1): **수기 관리 상수** — 2026-07-16 금통위 결정으로 기준금리
# 2.50% → 2.75% 인상(2023-01 이후 첫 인상, 14개월 동결 종료). 이 상수는 리포의
# BOK Base Rate 시계열(Data/BOK Base Rate.xlsx / loaders/base_rate.py)에서
# 파생하지 **않는다**: 그 시계열은 결정일보다 늦게 적재되므로(2026-07-16 현재
# 최신 행이 2026-07-08 == 2.50%) 이 상수의 원천으로 삼으면 안 된다. 정책금리
# 변경 시 여기 한 곳을 수기로 갱신한다. 유효일: 2026-07-16 (MPC 결정일).
#
# 금통위 스테핑 없음 — 전 기간 고정 상수가 스펙이다(스테핑은 별도 추후 결정).
#
# 하위 호환: 요청이 fundingRate를 명시하면(소스 골든 캡처 등 구형 페이로드)
# 원본 의미론 — 그 값 + fundingEvents 계단 스테핑 — 을 그대로 유지한다.
# 라이브 프론트 브리지는 s15부터 fundingRate를 싣지 않는다.
#
# R3B-PLUS T2a (owner ruling): moved here verbatim from
# services/simulation/constants.py, which now re-exports these names so every
# existing simulation-family import (`from .constants import ...`) stays
# byte-identical. This module is the single shared source for both families —
# it must never import FROM either (see module docstring); simulation/
# constants.py and portfolio_analytics_service.py both import FROM here.
POLICY_BASE_RATE_KRW = 0.0275    # BOK 기준금리 (소수, 2.75%; 2026-07-16 금통위)
FUNDING_SPREAD_BP = 10           # 기준금리 대비 조달 스프레드 (bp)
FUNDING_RATE_KRW = POLICY_BASE_RATE_KRW + FUNDING_SPREAD_BP / 10000.0  # 0.0285


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
