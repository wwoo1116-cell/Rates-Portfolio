"""s18 T5 measure-only profiler (R3a, moved from simulation_service.py).

Wrap targets after the split (SPLIT_PLAN H3): the qe module attributes as
before, plus the CHART module's calculate_daily_mtm / calculate_daily_carry —
the namespace build_chart_data actually resolves at call time (wrapping the
facade would measure nothing). Labels and restore semantics unchanged.
"""

from __future__ import annotations

import logging
import os
import time as _time
from contextlib import contextmanager

from ...engine import quant_engine as qe
from . import chart as _chart

logger = logging.getLogger(__name__)


# ── s18 T5: /api/simulate 프로파일러 — 측정 전용, 최적화 아님 ─────────────────
# IRS_PRICER_SIM_PROFILE=1 일 때만 활성. 모듈 어트리뷰트를 런타임에 감싸므로
# quant_engine.py 파일은 바이트 그대로다(내부 호출도 모듈 전역 이름으로 해석돼
# 래퍼를 통과한다 — 진짜 호출 수가 잡힌다). 비활성 시 비용 0(분기 하나).
# 주의: 래핑은 프로세스 전역이라 프로파일링은 단일 요청 측정 용도다 — 동시
# 요청이 섞이면 수치가 합산된다. 일반 운영에서는 절대 켜지 않는다.
SIM_PROFILE_ENV = "IRS_PRICER_SIM_PROFILE"


@contextmanager
def _sim_profiler():
    if not os.environ.get(SIM_PROFILE_ENV):
        yield None
        return

    stats: dict[str, dict] = {"_phases": {}}

    def _wrap(mod, name: str, label: str):
        orig = getattr(mod, name)
        rec = stats.setdefault(label, {"calls": 0, "secs": 0.0})

        def wrapper(*a, **k):
            t0 = _time.perf_counter()
            try:
                return orig(*a, **k)
            finally:
                rec["calls"] += 1
                rec["secs"] += _time.perf_counter() - t0

        setattr(mod, name, wrapper)
        return (mod, name, orig)

    saved = [
        # 커브 부트스트랩 — "일별 × 시나리오별 × 종목별 중 무엇인가"의 답은 이 카운트다.
        _wrap(qe, "bootstrap_zero_curve", "qe.bootstrap_zero_curve"),
        _wrap(qe, "build_bumped_curves", "qe.build_bumped_curves"),
        # 스왑 프라이싱 (FM 경로, 종목당 1회 × 런당)
        _wrap(qe, "simulate_irs_path_fm", "qe.simulate_irs_path_fm"),
        _wrap(qe, "compute_irs_krd_map", "qe.compute_irs_krd_map"),
        _wrap(qe, "portfolio_krd_day", "qe.portfolio_krd_day"),
        # 채권 프라이싱 (글루 루프)
        _wrap(_chart, "calculate_daily_mtm", "svc.calculate_daily_mtm"),
        _wrap(_chart, "calculate_daily_carry", "svc.calculate_daily_carry"),
    ]
    try:
        yield stats
    finally:
        for mod, name, orig in saved:
            setattr(mod, name, orig)


@contextmanager
def _phase(stats: dict | None, label: str):
    if stats is None:
        yield
        return
    t0 = _time.perf_counter()
    try:
        yield
    finally:
        stats["_phases"][label] = stats["_phases"].get(label, 0.0) + (_time.perf_counter() - t0)


def _log_profile(stats: dict, *, n_positions: int, n_swaps: int, sim_days: int, total_secs: float) -> None:
    lines = [
        f"[SIM PROFILE] total={total_secs:.1f}s positions={n_positions} (swaps={n_swaps}) simDays={sim_days} scenarios=5 (base + 4 percentile runs)",
        "[SIM PROFILE] phases (wall):",
    ]
    for label, secs in stats["_phases"].items():
        lines.append(f"[SIM PROFILE]   {label:<28} {secs:10.2f}s")
    lines.append("[SIM PROFILE] functions (calls / cumulative secs — nested, overlaps phases):")
    for label, rec in stats.items():
        if label == "_phases":
            continue
        lines.append(f"[SIM PROFILE]   {label:<28} {rec['calls']:>9} calls {rec['secs']:10.2f}s")
    for ln in lines:
        logger.info(ln)
