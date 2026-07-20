"""s11 T3 percentile fan (quantile-scenario identity) — moved verbatim from
simulation_service.py (R3a)."""

from __future__ import annotations

from datetime import date

import numpy as np

from ...engine import quant_engine as qe
from .chart import build_chart_data
from .models import FrontendPosition, FrontendShockCurves


# ── s11 T3: 분포(퍼센타일 팬) 밴드 ────────────────────────────────────────────
# 확률 가정 (REPORT_s11.md §3에 상세 문서화):
#   - 불확실성은 커브 "평행 레벨"에 대해서만 건다 (테너/크레딧 스프레드는
#     시나리오 값에 고정). 오프셋 Δp = z_p · σ_daily · √(영업일수).
#   - σ_daily 기본 2.0bp/영업일 (KRW 3Y 일변동 근사; 요청으로 조정 불가 — 상수).
#   - 각 밴드는 "사용자 시나리오 + 만기 Δp까지 선형 램프되는 평행 충격"의 실제
#     엔진 런이다. 만기 시점 분위수는 정확하고, 중간 시점은 만기 불확실성의
#     선형 보간이다 (√t 브리지가 아님 — 엔진의 자체 램프 의미론에 맞춤).
#   - 밴드 정체성(s15 T4): 각 밴드는 "그 밴드를 생성한 금리 분위수 시나리오"
#     (z_p 평행 오프셋 경로)에 고정된다 — p95는 금리 +1.645σ 경로의 실제 엔진
#     런이다. 일자별 재정렬은 하지 않는다: 비단조 북에서 런을 순위 간에
#     이주시켜 기본 런이 p25로, 충격 런이 화면상 중앙값으로 둔갑하는 왜곡을
#     만들었다(iv3 관측 결함). 밴드 교차는 정보다 — 금리가 오르면 손해 보는
#     북에서는 p95(금리 상방) 밴드가 p50 아래에 놓이는 것이 정직한 렌더링이다.
#   - 난수 없음 — 같은 요청은 항상 같은 밴드 (골든 테스트 안정).
_DIST_SIGMA_BP_DAILY = 2.0
_DIST_PERCENTILES = (5, 25, 50, 75, 95)
_DIST_Z = {5: -1.6448536269514722, 25: -0.6744897501960817, 50: 0.0,
           75: 0.6744897501960817, 95: 1.6448536269514722}


def _offset_curve_points(points: list[dict], off_bp: float) -> list[dict]:
    return [{**p, "val": float(p.get("val", 0)) + off_bp} for p in points]


def _offset_shock_curves(sc: FrontendShockCurves | None, off_bp: float) -> FrontendShockCurves | None:
    """모든 충격 커브(채권 섹터 + 스왑)에 평행 오프셋 bp를 더한 사본."""
    if sc is None:
        return None
    return FrontendShockCurves(
        bondCurves={k: _offset_curve_points(v, off_bp) for k, v in sc.bondCurves.items()},
        swapCurve=_offset_curve_points(sc.swapCurve, off_bp),
        fundingEvents=sc.fundingEvents,
    )


def _offset_custom_path(custom_path: list[dict] | None, off_bp: float, sim_days: int) -> list[dict] | None:
    """웨이포인트 경로에 만기 Δp까지 선형 램프되는 오프셋을 더한 사본."""
    if not custom_path:
        return custom_path
    horizon = max(sim_days, 1)
    return [
        {**p, "bp": float(p.get("bp", 0)) + off_bp * (int(p.get("day", 0)) / horizon)}
        for p in custom_path
    ]


def build_distribution_bands(
    base_chart: list[dict],
    base_rate_path: list[dict] | None = None,
    *,
    positions: list[FrontendPosition],
    shock_curves: FrontendShockCurves | None,
    funding_rate: float,
    funding_events: list[dict],
    sim_days: int,
    shock_type: str,
    shock_mode: str,
    base_shock_bp: float,
    base_date_str: str,
    irs_curves: list[dict] | None,
    irs_shock_curve: list[tuple[float, float]],
    custom_path: list[dict] | None,
    sigma_bp: float = _DIST_SIGMA_BP_DAILY,
    funding_rate_fixed: bool = False,
    funding_stepping: bool = False,
) -> dict:
    """totalPnL의 퍼센타일 팬 밴드. z=0 런은 기본 시나리오와 입력이 동일하므로
    base_chart를 그대로 재사용한다(p50 ≡ 기본 런 바이트 동일 — 중앙선 고정,
    σ와 무관). 나머지 4개 분위수는 skip_recon=True 엔진 런이고, 각 밴드는 그
    생성 시나리오에 고정된다(위 확률 가정 블록의 s15 T4 항목).

    sigma_bp (s13): 요청으로 조정 가능한 σ(bp/√영업일). 검증(0<σ≤25)은 라우터
    Field가 담당하고, 여기서는 기본값이 s11 상수와 같아 생략 시 바이트 동일이다.

    ratePaths (s18 T3 — 이중축 분리): 각 분위수 시나리오가 실제 소비한 국채 3Y
    누적 충격 경로(bp)를 bands와 같은 day 축으로 반환한다. 금리는 분위수에 대해
    구성상 단조라서 이 밴드는 절대 교차하지 않는다 — P5..P95 라벨이 진실인 축.
    수익 밴드(bands)는 시나리오 정체성 그대로이며 순위 의미를 갖지 않는다(FE는
    라인으로, "금리 P95 시나리오"처럼 시나리오 라벨로만 렌더링)."""
    try:
        _bd = date.fromisoformat(base_date_str[:10])
    except Exception:
        _bd = date.today()
    ranks = qe.biz_day_ranks(_bd, sim_days)
    n_biz = int(ranks[-1]) if ranks[-1] > 0 else max(sim_days, 1)
    sigma_t = sigma_bp * float(np.sqrt(n_biz))

    days = [int(row.get("day", 0)) for row in base_chart]
    runs: dict[int, dict[int, float]] = {
        50: {int(r.get("day", 0)): float(r.get("totalPnL", 0)) for r in base_chart}
    }
    # s18 T3 — 시나리오별 국채 3Y 경로 (p50 = 기본 런의 경로, 바이트 동일 원천)
    rate_runs: dict[int, dict[int, float]] = {
        50: {int(r.get("day", 0)): float(r.get("bp", 0.0)) for r in (base_rate_path or [])}
    }
    for pct in _DIST_PERCENTILES:
        if pct == 50:
            continue
        off = _DIST_Z[pct] * sigma_t
        shifted_base = base_shock_bp + off
        if abs(shifted_base) < 1e-9:
            # _factor()는 base_shock_bp==0이면 커스텀 경로를 무시한다(원본 특성).
            # 그 불연속을 피하기 위해 무시할 수 있는 크기만큼 비켜 간다.
            off += 1e-6
            shifted_base = base_shock_bp + off
        chart_p, _sum_p, _ev_p, _rec_p, _fc_p, _dec_p, rate_path_p = build_chart_data(
            positions=positions,
            shock_curves=_offset_shock_curves(shock_curves, off),
            funding_rate=funding_rate,
            funding_events=funding_events,
            sim_days=sim_days,
            shock_type=shock_type,
            shock_mode=shock_mode,
            base_shock_bp=shifted_base,
            base_date_str=base_date_str,
            irs_curves=irs_curves,
            irs_shock_curve_prebuilt=[(t_, v_ + off) for t_, v_ in irs_shock_curve],
            custom_path=_offset_custom_path(custom_path, off, sim_days),
            skip_recon=True,
            funding_rate_fixed=funding_rate_fixed,
            funding_stepping=funding_stepping,
        )
        runs[pct] = {int(r.get("day", 0)): float(r.get("totalPnL", 0)) for r in chart_p}
        rate_runs[pct] = {int(r.get("day", 0)): float(r.get("bp", 0.0)) for r in rate_path_p}

    bands: list[dict] = []
    for d in days:
        # s15 T4 — 시나리오 정체성: 밴드 p는 항상 z_p 오프셋 런의 그날 값이다.
        # (일자별 정렬 배정 제거 — 비단조 북에서 런이 순위 간 이주하던 결함.)
        bands.append({
            "day": d,
            **{f"p{p}": runs[p].get(d, 0.0) for p in _DIST_PERCENTILES},
        })

    rate_paths: list[dict] = [
        {"day": d, **{f"p{p}": rate_runs[p].get(d, 0.0) for p in _DIST_PERCENTILES}}
        for d in days
    ]

    return {
        "sigmaBpDaily": sigma_bp,
        "sigmaTerminalBp": round(sigma_t, 4),
        "percentiles": list(_DIST_PERCENTILES),
        "method": "quantile-scenario",
        "bands": bands,
        # s18 T3 추가 필드 (확장 전용): 금리 분위수 경로 — 절대 비교차.
        "ratePaths": rate_paths,
    }
