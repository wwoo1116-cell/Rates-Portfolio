"""
Scenario-simulation service: the computation behind POST /api/simulate.

Ported from rates-simulator-main/backend/main.py (the module-level helpers plus
the body of its `simulate()` endpoint) onto this repo's engine/quant_engine.py,
which is byte-identical to the source's quant_engine.py -- so every number this
service produces comes from the same engine code the source service ran.

Deliberate deviations from the source, kept to the glue only:
- `build_frontend_pvbp_sensitivity` (renamed R2: same name as the DIFFERENT portfolio_analytics_service builder was a hazard) is rewritten pandas-free (this deployment does not
  ship pandas). The original used a DataFrame group-by-sum; the plain-dict
  aggregation below sums the same values over the same rows.
- `print()` diagnostics became module-logger calls with the same text.
- The source annotated `build_chart_data -> tuple[list[dict], dict]` but
  returns a 4-tuple; the annotation here says what the code does.

The wire DTOs (FrontendPosition/FrontendShockCurves) live here rather than in
api/models.py because their camelCase field names ARE the frozen frontend
contract (UIUX_test src/features/simulation/api/simulate-dto.ts) -- they are
not reusable snake_case API models, and the ported functions read them by
attribute exactly as the source did.
"""

from __future__ import annotations

import logging
import time as _time
from datetime import date, timedelta

import numpy as np

from ..core.errors import NonBusinessDayError
from ..engine import quant_engine as qe
from ..engine.fixings import select_fixing
from . import market_data_service
from .simulation.chart import _build_irs_shock_curve, build_chart_data
from .simulation.constants import (
    FUNDING_RATE_KRW,
    FUNDING_SPREAD_BP,
    POLICY_BASE_RATE_KRW,
)
from .simulation.daily_valuation import (
    _is_matured,
    calc_dynamic_funding_rate,
    calculate_daily_carry,
    calculate_daily_funding_cost,
    calculate_daily_mtm,
    get_position_shock_bp,
    get_sector_curve_key,
    interpolate_curve_shift,
    parse_tenor_to_years,
)
from .simulation.kr_calendar import (
    _TENOR_MONTHS,
    build_bizday_schedule,
    modified_following_kr,
    next_kr_business_day,
    resolve_curve_maturity_dates,
    tenor_to_maturity_date,
)
from .simulation.models import FrontendPosition, FrontendShockCurves
from .simulation.profiling import (
    SIM_PROFILE_ENV,
    _log_profile,
    _phase,
    _sim_profiler,
)

logger = logging.getLogger(__name__)



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


def build_frontend_pvbp_sensitivity(positions: list[FrontendPosition]) -> list[dict]:
    sectors = ["국고채", "통안채", "특은채", "시은채", "공사채", "여전채", "회사채", "IRS", "OIS"]
    # qe.KRD_NAMES를 그대로 참조(하드코딩된 별도 목록이면 엔진에 새 테너를 추가해도
    # 여기서 누락되어 "합계"가 실제 평행이동 PVBP와 어긋난다 — 6Y/8Y/9Y 추가 시 실제로 발생했던 문제)
    tenors = qe.KRD_NAMES

    # 원본은 pandas group-by-sum이었다(rates-simulator-main/backend/main.py) —
    # 같은 행들을 같은 순서로 테너별 순차 합산하는 plain-dict 버전. 이 배포에는
    # pandas가 없고, 필요한 것은 섹터×테너 합 하나뿐이다.
    result: list[dict] = []
    col_totals = {t: 0.0 for t in tenors}

    for sector in sectors:
        row_vals = {t: 0.0 for t in tenors}
        for p in positions:
            if p.sector == sector:
                for t in tenors:
                    row_vals[t] += float(p.krdMap.get(t) or 0)
        row_total = sum(row_vals.values())
        row_vals["합계"] = row_total
        for t in tenors:
            col_totals[t] = col_totals.get(t, 0.0) + row_vals.get(t, 0.0)
        result.append({"sector": sector, "tenors": row_vals, "total": row_total})

    grand_total = sum(col_totals.values())
    col_totals["합계"] = grand_total
    result.append({"sector": "합계", "tenors": col_totals, "total": grand_total})
    return result


def build_book_daily_pnl(
    positions: list[FrontendPosition],
    shock_curves: FrontendShockCurves | None,
    funding_rate: float,
) -> list[dict]:
    books = list(dict.fromkeys(p.book for p in positions))
    daily_pnls: list[dict] = []

    for book_name in books:
        bp_list = [p for p in positions if p.book == book_name]
        daily_carry = funding_cost = bond_val = swap_val = swap_theta = 0.0

        for p in bp_list:
            if p.bondType == "swap":
                delta = 0.0
                if p.krdMap and shock_curves and shock_curves.swapCurve:
                    for tenor, pvbp_val in p.krdMap.items():
                        sbp = interpolate_curve_shift(parse_tenor_to_years(tenor), shock_curves.swapCurve)
                        # IRS PVBP는 DV01 관행: receive-fixed=양수, pay-fixed=음수
                        # MTM = pvbp * (-sbp)  (채권과 동일)
                        delta += float(pvbp_val or 0) * (-sbp)
                swap_val += delta
                swap_theta += p.expectedThetaPnL or 0.0
            else:
                eval_amt = p.evaluationAmount or 0.0
                daily_carry += (eval_amt * ((p.mtmYield or 0.0) / 100.0)) / 365.0
                funding_cost -= (eval_amt * funding_rate) / 365.0
                curve_key = get_sector_curve_key(p.sector)
                target: list[dict] = []
                if shock_curves:
                    target = shock_curves.bondCurves.get(curve_key) or shock_curves.bondCurves.get("국채") or []
                sbp = interpolate_curve_shift((p.remainingDays or 0) / 365.0, target)
                bond_val += (p.pvbp or 0.0) * (-sbp)

        total = daily_carry + funding_cost + bond_val + swap_val + swap_theta
        daily_pnls.append({
            "bookName": book_name,
            "dailyCarry": round(daily_carry),
            "fundingCost": round(funding_cost),
            "bondValuation": round(bond_val),
            "swapValuation": round(swap_val),
            "swapThetaPnL": round(swap_theta),
            "totalDailyPnL": round(total),
        })

    if daily_pnls:
        daily_pnls.append({
            "bookName": "Total",
            "dailyCarry": sum(d["dailyCarry"] for d in daily_pnls),
            "fundingCost": sum(d["fundingCost"] for d in daily_pnls),
            "bondValuation": sum(d["bondValuation"] for d in daily_pnls),
            "swapValuation": sum(d["swapValuation"] for d in daily_pnls),
            "swapThetaPnL": sum(d["swapThetaPnL"] for d in daily_pnls),
            "totalDailyPnL": sum(d["totalDailyPnL"] for d in daily_pnls),
        })
    return daily_pnls


def enrich_irs_pvbp(
    positions: list[FrontendPosition],
    irs_curves: list[dict],
    base_date_str: str = "2026-01-01",
) -> list[FrontendPosition]:
    """
    IRS 포지션의 pvbp / krdMap / expectedThetaPnL을 quant_engine으로 산출하여 채워 반환.

    irsCurves가 비어있으면 flat 3% 커브를 fallback으로 사용.
    채권 포지션은 그대로 통과.
    """
    try:
        _enrich_base_date = date.fromisoformat(str(base_date_str)[:10])
    except Exception:
        _enrich_base_date = date.today()
    par_rates = qe.parse_irs_curves(irs_curves, base_date=_enrich_base_date)

    enriched: list[FrontendPosition] = []
    for p in positions:
        if p.bondType != "swap":
            enriched.append(p)
            continue

        t_mat = max(float(p.remainingDays or 0) / 365.0, 1 / 365)
        # 다음 변동 지급일: nextFixingDate 필드 우선 사용, 없으면 3개월 근사
        if p.nextFixingDate:
            try:
                nfd = date.fromisoformat(str(p.nextFixingDate)[:10])
                ref = date.fromisoformat(str(base_date_str)[:10])
                days_to_next = max((nfd - ref).days, 1)
                t_next = days_to_next / 365.0
            except Exception:
                t_next = 0.25
        else:
            t_next = t_mat * 0.1 if t_mat < 0.25 else 0.25
        t_next = max(min(t_next, t_mat), 1.0 / 365.0)

        # startDate가 있으면 실제 ISDA 스케줄(Forward Generation + EOM + Modified
        # Following + 만기 스냅)을 그대로 재현해 compute_irs_krd_map에 전달한다.
        # 이렇게 하면 compute_irs_npv 내부의 "t_maturity/t_next_payment 두 float만
        # 보고 날짜를 역산"하는 근사 로직을 완전히 건너뛰므로, 시작일 day-of-month가
        # 만기일과 다른 경우(예: 매달 16일 지급인데 만기가 18일)의 마지막 구간
        # 스텁까지 정확해진다. startDate가 없으면(프론트가 못 채운 레거시 포지션)
        # None으로 두어 기존 근사 경로로 폴백.
        _base = date.fromisoformat(str(base_date_str)[:10])
        _settle_date = next_kr_business_day(_base)  # 결제일(T+1 영업일, 한국 공휴일 반영)

        real_pay_dates = None
        real_accruals = None
        real_start_date = None
        if p.startDate:
            try:
                _sdate = date.fromisoformat(str(p.startDate)[:10])
                _mat_date = qe._modfol_bd(_base + timedelta(days=round(t_mat * 365)))
                if _mat_date > _sdate:
                    _trade_tmp = qe.IRS_Trade(
                        _sdate, _mat_date, p.couponRate or 0.0,
                        int(p.direction or 1), p.notional or 0.0, sector=p.sector or "IRS",
                    )
                    real_pay_dates = _trade_tmp.pay_dates
                    real_accruals = _trade_tmp.accruals
                    real_start_date = _sdate
            except Exception:
                real_pay_dates = None
                real_accruals = None
                real_start_date = None

        # 병행 방법론(linear-on-rate 보간 + 결제일 기준 할인)의 current_float_rate_pct:
        # 실제 스케줄을 알 때만 "리셋일이 [평가일, 결제일]에 걸리는 롤링 종목"을
        # 판정해 3M par rate로 리픽싱(resolve_current_float_rate). 실제 스케줄이
        # 없으면(startDate 미전달) 이 판정 자체가 불가능하므로 프론트 값 그대로 사용.
        _settle_float_rate = p.currentFloatRate or 0.0
        if real_pay_dates is not None:
            _settle_float_rate = qe.resolve_current_float_rate(
                pay_dates=real_pay_dates, start_date=real_start_date, val_date=_base,
                settle_date=_settle_date, cutoff_date=_settle_date,
                par_rates=par_rates, file_float_rate_pct=p.currentFloatRate or 0.0,
            )

        pvbp = qe.compute_irs_pvbp(
            par_rates          = par_rates,
            notional           = p.notional or 0.0,
            fixed_rate_pct     = p.couponRate or 0.0,       # % 단위
            direction          = int(p.direction or 1),
            t_maturity         = t_mat,
            t_next_payment     = t_next,
            current_float_rate_pct = _settle_float_rate,  # % 단위
            sector             = p.sector or "IRS",
            sim_date           = _settle_date,
            df_fn              = qe.df_linear_rate,
            pay_dates          = real_pay_dates,
            accruals           = real_accruals,
        )
        krd = qe.compute_irs_krd_map(
            par_rates          = par_rates,
            notional           = p.notional or 0.0,
            fixed_rate_pct     = p.couponRate or 0.0,
            direction          = int(p.direction or 1),
            t_maturity         = t_mat,
            t_next_payment     = t_next,
            current_float_rate_pct = _settle_float_rate,
            sector             = p.sector or "IRS",
            sim_date           = _settle_date,
            pay_dates          = real_pay_dates,
            accruals           = real_accruals,
        )
        theta = qe.compute_irs_theta(
            par_rates          = par_rates,
            notional           = p.notional or 0.0,
            fixed_rate_pct     = p.couponRate or 0.0,
            direction          = int(p.direction or 1),
            t_maturity         = t_mat,
            t_next_payment     = t_next,
            current_float_rate_pct = p.currentFloatRate or 0.0,
            sector             = p.sector or "IRS",
            base_date          = date.fromisoformat(base_date_str[:10]),
            pay_dates          = real_pay_dates,
            accruals           = real_accruals,
        )

        # Pydantic 모델은 immutable이므로 copy(update=...) 사용
        enriched.append(p.model_copy(update={
            "pvbp": pvbp,
            "krdMap": krd,
            "expectedThetaPnL": theta,
        }))

    return enriched


# ── s15 T2: 스왑 시장 데이터 결정 (IRS par 커브 + 픽싱) ───────────────────────

_MONTHS_TO_TENOR = {m: lbl for lbl, m in _TENOR_MONTHS.items()}

# 명시적 제외 사유 — FE Results 표면이 그대로 렌더링하는 문자열.
SWAP_EXCLUSION_REASON_NO_QUOTES = "당일 IRS 호가 없음"


def _resolve_swap_inputs(
    positions: list[FrontendPosition],
    irs_curves: list[dict],
    base_date_str: str,
) -> tuple[list[FrontendPosition], list[dict], list[dict]]:
    """스왑이 포함된 요청의 시장 데이터 결정. (positions, irs_curves, exclusions) 반환.

    브리지(S6)는 irsCurves를 싣지 않는다 — 스왑 포지션이 있고 irsCurves가 비어
    있으면 백엔드의 IRS 스냅샷 저장소(market_data_service.load_snapshot)에서
    base_date **당일** par 호가를 가져온다. 소유자 결정: 당일 호가가 없으면
    폴백 스냅샷도, 침묵의 0도 없다 — 스왑을 명시적으로 제외하고(exclusions
    항목 + 포지션 제거) 나머지 채권 산출은 정상 진행한다. 요청이 irsCurves를
    직접 실으면(구형/테스트 페이로드) 그대로 존중한다.

    유지되는 제약: par 커브가 비어도 500이 나지 않는다 — build_chart_data의
    문서화된 의도적 분기(빈 대사표)는 이제 "스왑 없는 북 + 커브 없음"의
    순수 부재 케이스에서만 도달한다.
    """
    has_swaps = any(p.bondType == "swap" for p in positions)
    if not has_swaps or irs_curves:
        return positions, irs_curves, []

    try:
        base_date = date.fromisoformat(str(base_date_str)[:10])
    except Exception:
        base_date = date.today()

    snapshot = None
    try:
        snapshot = market_data_service.load_snapshot(base_date)
    except (NonBusinessDayError, ValueError) as e:
        logger.warning("[s15 T2] base_date=%s IRS 호가 없음 → 스왑 제외: %s", base_date, e)

    resolved: list[dict] = []
    if snapshot is not None:
        for q in snapshot.swap_quotes:
            months = q.tenor_months if q.tenor_months is not None else int(q.tenor_years) * 12
            entry: dict = {"t": months / 12.0, "rate": q.rate}
            lbl = _MONTHS_TO_TENOR.get(months)
            if lbl:
                # 테너 라벨을 실어 resolve_curve_maturity_dates가 실제 만기일
                # (Modified Following)을 계산하게 한다 — 라벨 T보다 정확.
                entry["tenor"] = lbl
            resolved.append(entry)

    # 스냅샷 자체가 없거나(예외) 있어도 IRS 호가가 0건이면 동일하게 "당일 호가
    # 없음" — 빈 par 커브로 FM 경로에 들어가 500이 나는 대신 명시적 제외.
    if not resolved:
        exclusions = [{
            "assetClass": "swap",
            "reason": SWAP_EXCLUSION_REASON_NO_QUOTES,
            "asOf": base_date.isoformat(),
        }]
        return [p for p in positions if p.bondType != "swap"], irs_curves, exclusions
    return positions, resolved, []


def _resolve_swap_float_fields(
    positions: list[FrontendPosition],
    base_date_str: str,
) -> list[FrontendPosition]:
    """스왑 포지션의 미충전 시장 필드(currentFloatRate, nextFixingDate,
    remainingDays)를 백엔드에서 채운다. 브리지의 ManualPosition은 계약 조건
    (시작/만기/고정금리/방향)만 알고 현재 구간 변동금리는 모른다.

    같은 원천 사용: 스케줄은 qe.IRS_Trade(FM 경로가 쓰는 그 ISDA 스케줄),
    픽싱은 engine/fixings.select_fixing(실북 MtM 경로 value_booked_trade와
    동일한 리셋일 기준 F(R)=R−1 서울영업일 규칙) + market_data_service.load_fixings.
    이미 값이 채워져 온 포지션(구형 페이로드·테스트)은 건드리지 않는다.
    """
    swaps = [p for p in positions if p.bondType == "swap"]
    if not swaps:
        return positions
    try:
        base_date = date.fromisoformat(str(base_date_str)[:10])
    except Exception:
        base_date = date.today()

    # 픽싱 이력은 실제로 해결할 변동금리가 있을 때만 로드 — 모든 필드가 이미
    # 채워진 페이로드(구형/골든/프리즈드 픽스처)는 데이터 저장소를 건드리지 않는다.
    fixings: dict = {}
    if any(not p.currentFloatRate for p in swaps):
        try:
            fixings = market_data_service.load_fixings()
        except Exception:
            logger.warning("[s15 T2] CD 픽싱 이력 로드 실패 — currentFloatRate 미해결", exc_info=True)

    out: list[FrontendPosition] = []
    for p in positions:
        if p.bondType != "swap":
            out.append(p)
            continue
        updates: dict = {}
        try:
            mat = date.fromisoformat(str(p.maturityDate)[:10]) if p.maturityDate else None
            if mat is not None and not p.remainingDays:
                updates["remainingDays"] = float(max((mat - base_date).days, 0))
            start = date.fromisoformat(str(p.startDate)[:10]) if p.startDate else None
            if start is not None and mat is not None and mat > start:
                trade = qe.IRS_Trade(
                    start, mat, p.couponRate or 0.0,
                    int(p.direction or 1), p.notional or 0.0, sector=p.sector or "IRS",
                )
                future = [d for d in trade.pay_dates if d > base_date]
                if future:
                    nfd = future[0]
                    if not p.nextFixingDate:
                        updates["nextFixingDate"] = nfd.isoformat()
                    if not p.currentFloatRate and fixings:
                        idx = trade.pay_dates.index(nfd)
                        reset = trade.pay_dates[idx - 1] if idx > 0 else trade.start_date
                        res = select_fixing(fixings, reset, base_date)
                        if res is not None and res.rate is not None:
                            updates["currentFloatRate"] = res.rate * 100.0
                            if res.is_data_quality_event:
                                logger.warning(
                                    "[s15 T2] 픽싱 데이터 품질 이벤트 (pos=%s): %s",
                                    p.id or p.name, res.to_payload(),
                                )
        except Exception:
            logger.warning("[s15 T2] 스왑 시장 필드 해결 실패 (pos=%s)", p.id or p.name, exc_info=True)
        out.append(p.model_copy(update=updates) if updates else p)
    return out


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

    # 스왑이 제외된 경우(당일 호가 없음): 스왑 성분은 0이 아니라 "미정의"다 —
    # FE는 이 null을 —(공란)으로 렌더링한다(blank-MtM 정책). 스왑이 아예 없는
    # 북(제외 아님)은 정직한 0 기여로 남는다.
    if swaps_excluded:
        decomposition["swapMtm"] = None
        decomposition["swapCarry"] = None
        decomposition["total"] = (
            decomposition["bondMtm"] + decomposition["bondCarry"] + decomposition["fundingCost"]
        )
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
    }
