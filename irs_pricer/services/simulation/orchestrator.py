"""run_simulation — the /api/simulate endpoint body (R3a, moved verbatim from
simulation_service.py). Order of operations is the original source's:
swap market-data resolve -> curve maturity fill -> explicit IRS shock curve ->
enrich -> base chart run -> pvbp/bookPnL assembly -> distribution fan.
"""

from __future__ import annotations

import logging
import time as _time
from datetime import date

from .aggregates import build_book_daily_pnl, build_frontend_pvbp_sensitivity
from .chart import build_chart_data
from .constants import FUNDING_RATE_KRW
from .distribution import _DIST_SIGMA_BP_DAILY, build_distribution_bands
from .enrichment import enrich_irs_pvbp
from .kr_calendar import resolve_curve_maturity_dates
from .models import FrontendPosition, FrontendShockCurves
from .profiling import _log_profile, _phase, _sim_profiler
from .swap_inputs import _resolve_swap_float_fields, _resolve_swap_inputs

logger = logging.getLogger(__name__)


# ── 엔드포인트 본문 (source main.py의 simulate()) ────────────────────────────

def run_simulation(
    positions: list[FrontendPosition],
    shock_curves: FrontendShockCurves | None,
    daily_shock_curves: FrontendShockCurves | None,
    funding_rate: float | None,
    funding_events: list[dict],
    sim_days: int,
    shock_type: str,
    shock_mode: str,
    base_shock_bp: float,
    base_date: str,
    irs_curves: list[dict],
    custom_path: list[dict],
    sigma_bp: float = _DIST_SIGMA_BP_DAILY,
) -> dict:
    """POST /api/simulate 한 건의 전체 계산. 원본 엔드포인트 본문의 순서 그대로:
    커브 만기일 보정 → IRS 쇼크커브 명시적 빌드 → IRS 프라이싱 주입(enrich) →
    chartData/summary/정산이벤트/일별대사 → pvbpSensitivity → bookDailyPnLs.

    s15: funding_rate=None(라이브 브리지)이면 조달금리는 기준금리+10bp 상수로
    전 기간 고정(모듈 상단 상수 블록); 명시 값이면 원본 의미론(값+이벤트 스테핑)
    유지. 스왑 포지션이 있고 irs_curves가 비면 스냅샷 저장소에서 당일 par
    호가를 해결하고, 없으면 스왑을 명시적으로 제외한다(exclusions)."""
    # ── s15 T1: 조달금리 결정 ────────────────────────────────────────────────
    funding_rate_fixed = funding_rate is None
    if funding_rate is None:
        funding_rate = FUNDING_RATE_KRW

    # s18 T5 — 측정 전용 프로파일러 (IRS_PRICER_SIM_PROFILE=1일 때만; 아니면 no-op)
    _prof_t0 = _time.perf_counter()
    _prof_ctx = _sim_profiler()
    _prof = _prof_ctx.__enter__()
    try:
        return _run_simulation_profiled(
            _prof, positions=positions, shock_curves=shock_curves,
            daily_shock_curves=daily_shock_curves, funding_rate=funding_rate,
            funding_rate_fixed=funding_rate_fixed, funding_events=funding_events,
            sim_days=sim_days, shock_type=shock_type, shock_mode=shock_mode,
            base_shock_bp=base_shock_bp, base_date=base_date,
            irs_curves=irs_curves, custom_path=custom_path, sigma_bp=sigma_bp,
            _prof_t0=_prof_t0,
        )
    finally:
        _prof_ctx.__exit__(None, None, None)


def _run_simulation_profiled(
    _prof: dict | None,
    *,
    positions: list[FrontendPosition],
    shock_curves: FrontendShockCurves | None,
    daily_shock_curves: FrontendShockCurves | None,
    funding_rate: float,
    funding_rate_fixed: bool,
    funding_events: list[dict],
    sim_days: int,
    shock_type: str,
    shock_mode: str,
    base_shock_bp: float,
    base_date: str,
    irs_curves: list[dict],
    custom_path: list[dict],
    sigma_bp: float,
    _prof_t0: float,
) -> dict:

    # ── s15 T2: 스왑 시장 데이터 결정 (par 커브 + 픽싱 필드) ────────────────
    with _phase(_prof, "swap-market-resolve"):
        positions, irs_curves, exclusions = _resolve_swap_inputs(positions, irs_curves, base_date)
        swaps_excluded = any(x["assetClass"] == "swap" for x in exclusions)
        positions = _resolve_swap_float_fields(positions, base_date)

    # maturityDate 없는 커브 항목(테너 라벨만 있는 경우)에 실제 만기일을 채워
    # 넣는다 — 이후 enrich_irs_pvbp/build_chart_data 양쪽에서 공통으로 사용.
    try:
        _sim_base_date = date.fromisoformat(str(base_date)[:10])
        irs_curves = resolve_curve_maturity_dates(irs_curves, _sim_base_date)
    except Exception as _e:
        logger.warning("resolve_curve_maturity_dates 실패, 원본 irsCurves 사용: %s", _e)

    # ── Shock Curve 명시적 빌드 (엔드포인트 레벨) ────────────────────────────
    _swap_raw = shock_curves.swapCurve if shock_curves else []
    if shock_mode == "matrix" and _swap_raw:
        _parsed = [
            (float(p.get("t", 0)), float(p.get("val", 0)))
            for p in _swap_raw
            if float(p.get("t", 0)) > 0
        ]
        irs_shock_curve = _parsed if _parsed else [(0.0, base_shock_bp), (30.0, base_shock_bp)]
    else:
        irs_shock_curve = [(0.0, base_shock_bp), (30.0, base_shock_bp)]

    # ── IRS 포지션에 백엔드 프라이싱 결과 주입 ────────────────────────────────
    try:
        with _phase(_prof, "swap-static-pricing (enrich)"):
            positions = enrich_irs_pvbp(positions, irs_curves, base_date)
    except Exception:
        logger.exception("[CRITICAL] enrich_irs_pvbp 실패")
        raise

    funding_events = funding_events or (shock_curves.fundingEvents if shock_curves else [])

    with _phase(_prof, "base-run (bond+swap pricing+recon)"):
        chart_data, summary, irs_settlement_events, irs_daily_recon, funding_curve, decomposition, base_rate_path = build_chart_data(
            positions=positions,
            shock_curves=shock_curves,
            funding_rate=funding_rate,
            funding_events=funding_events,
            sim_days=sim_days,
            shock_type=shock_type,
            shock_mode=shock_mode,
            base_shock_bp=base_shock_bp,
            base_date_str=base_date,
            irs_curves=irs_curves,
            irs_shock_curve_prebuilt=irs_shock_curve,
            custom_path=custom_path or None,
            funding_rate_fixed=funding_rate_fixed,
        )

    # HARDEN-1: 일별 분해 경로는 chart가 decomposition dict에 실어 보낸다
    # (build_chart_data 튜플 모양 보존) — 응답의 최상위 additive 필드로 분리.
    decomposition_daily = decomposition.pop("daily", [])

    # 스왑이 제외된 경우(당일 호가 없음): 스왑 성분은 0이 아니라 "미정의"다 —
    # FE는 이 null을 —(공란)으로 렌더링한다(blank-MtM 정책). 스왑이 아예 없는
    # 북(제외 아님)은 정직한 0 기여로 남는다. 일별 경로도 같은 정책으로 매일
    # null 처리한다(공란은 게으른 0이 아니라 미정의).
    if swaps_excluded:
        decomposition["swapMtm"] = None
        decomposition["swapCarry"] = None
        decomposition["total"] = (
            decomposition["bondMtm"] + decomposition["bondCarry"] + decomposition["fundingCost"]
        )
        for row in decomposition_daily:
            row["swapMtm"] = None
            row["swapCarry"] = None
            row["total"] = row["fundingCost"] + row["bondMtm"] + row["bondCarry"]
    with _phase(_prof, "assembly (pvbp+bookPnL)"):
        pvbp_sensitivity = build_frontend_pvbp_sensitivity(positions)
        # bookDailyPnL: 당일 실제 금리변동만 반영. dailyShockCurves 없으면 shockCurves로 fallback
        daily_curves = daily_shock_curves if daily_shock_curves is not None else shock_curves
        book_daily_pnls = build_book_daily_pnl(positions, daily_curves, funding_rate)

    # s11 T3 — 분포 밴드는 **추가** 필드다: 실패해도 기존 응답은 그대로 나간다.
    distribution = None
    try:
        with _phase(_prof, "scenario-expansion (4 runs)"):
            distribution = build_distribution_bands(
                chart_data,
                base_rate_path,
                positions=positions,
                shock_curves=shock_curves,
                funding_rate=funding_rate,
                funding_events=funding_events,
                sim_days=sim_days,
                shock_type=shock_type,
                shock_mode=shock_mode,
                base_shock_bp=base_shock_bp,
                base_date_str=base_date,
                irs_curves=irs_curves,
                irs_shock_curve=irs_shock_curve,
                custom_path=custom_path or None,
                sigma_bp=sigma_bp,
                funding_rate_fixed=funding_rate_fixed,
            )
    except Exception:
        logger.exception("[s11 T3] 분포 밴드 계산 실패 — distribution=null로 응답")

    if _prof is not None:
        _log_profile(
            _prof,
            n_positions=len(positions),
            n_swaps=sum(1 for p in positions if p.bondType == "swap"),
            sim_days=sim_days,
            total_secs=_time.perf_counter() - _prof_t0,
        )

    return {
        "status": "ok",
        "chartData": chart_data,
        "summary": summary,
        "pvbpSensitivity": pvbp_sensitivity,
        "bookDailyPnLs": book_daily_pnls,
        "irsSettlementEvents":    irs_settlement_events,
        "irsDailyReconciliation": irs_daily_recon,
        # s11 추가 필드 (기존 계약 불변·확장 전용): T4 조달금리 스트립 + T3 분포 팬.
        "fundingCurve": funding_curve,
        "distribution": distribution,
        # s15 추가 필드 (확장 전용): T2 명시적 자산군 제외 + Total Return 분해.
        "exclusions": exclusions,
        "totalReturnDecomposition": decomposition,
        # HARDEN-1 추가 필드 (확장 전용): 일별 누적 성분 분해 경로 — Results의
        # 성분 커브 히어로가 소비한다. 매일 5성분 합 == total (±₩1 핀).
        "decompositionDaily": decomposition_daily,
    }
