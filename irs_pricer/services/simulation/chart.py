"""build_chart_data — the per-scenario engine run (R3a, moved verbatim from
simulation_service.py).

One call = one full scenario: IRS FM precompute (simulate_irs_path_fm per
swap — the ~82s full-book hotspot, measurement-only, do not optimize here),
the per-business-day valuation loop, the daily IRS reconciliation table, and
the decomposition accumulators whose float identity (bondMtm + bondCarry +
fundingCost + swapMtm + swapCarry == totalPnL) the FE waterfall consumes.

curve_cache contract: every bootstrap goes through `qe.bootstrap_zero_curve`
module-attribute lookup so the installed memo wrapper is picked up — never
import the function name directly.

The s18 T5 profiler (profiling.py) wraps THIS module's calculate_daily_mtm /
calculate_daily_carry attributes: build_chart_data resolves them from these
globals at call time.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta

import numpy as np

from ...engine import quant_engine as qe
from .daily_valuation import (
    _is_matured,
    calc_dynamic_funding_rate,
    calculate_daily_carry,
    calculate_daily_funding_cost,
    calculate_daily_mtm,
    get_position_shock_bp,
    get_sector_curve_key,
    interpolate_curve_shift,
)
from .kr_calendar import build_bizday_schedule, next_kr_business_day
from .models import FrontendPosition, FrontendShockCurves

logger = logging.getLogger(__name__)


def _build_irs_shock_curve(
    shock_mode: str,
    base_shock_bp: float,
    shock_curves: FrontendShockCurves | None,
) -> list[tuple[float, float]]:
    """IRS FM용 (tenor_years, shock_bp) 충격 커브 구성.
    평행이동: [(0, bp), (30, bp)] 플랫 커브.
    비평행이동: swapCurve [{t, val}] → [(t, val), ...] 변환.

    ※ swapCurve.val은 프론트엔드에서 이미 bp 절댓값(baseShockBp + irsSpread)으로 전달됨.
       base_shock_bp를 곱하면 이중 스케일 오류이므로 val을 그대로 사용한다.
       (run_simulation()에서 irs_shock_curve_prebuilt가 항상 주입되므로 이 함수는 fallback 경로)
    """
    if shock_mode == "parallel" or not shock_curves or not shock_curves.swapCurve:
        return [(0.0, base_shock_bp), (30.0, base_shock_bp)]
    parsed = [
        (float(p.get("t", 0)), float(p.get("val", 0)))  # val = bp 절댓값, 곱셈 불필요
        for p in shock_curves.swapCurve
        if float(p.get("t", 0)) > 0
    ]
    return parsed if parsed else [(0.0, base_shock_bp), (30.0, base_shock_bp)]


def build_chart_data(
    positions: list[FrontendPosition],
    shock_curves: FrontendShockCurves | None,
    funding_rate: float,
    funding_events: list[dict],
    sim_days: int,
    shock_type: str,
    shock_mode: str,
    base_shock_bp: float,
    base_date_str: str,
    irs_curves: list[dict] | None = None,
    irs_shock_curve_prebuilt: list[tuple[float, float]] | None = None,
    custom_path: list[dict] | None = None,
    skip_recon: bool = False,
    funding_rate_fixed: bool = False,
    funding_stepping: bool = False,
) -> tuple[list[dict], dict, list[dict], list[dict], list[dict], dict, list[dict]]:
    """7-튜플 (chart_data, summary, settlement_events, daily_recon, funding_curve,
    decomposition, rate_path).

    rate_path (s18 T3): 이 런이 소비한 국채 3Y 누적 충격 경로 [{day, bp}] —
    chart_data와 같은 day 축. 분포 밴드의 금리 팬(이중축 분리) 원천.

    funding_curve (s11 T4): 시뮬레이션 타임스텝별 조달금리/포지션 운용수익률/캐리 bp.
    chartData와 같은 영업일 스케줄(+day 0 앵커)로 정렬된다.

    skip_recon (s11 T3): 분포 밴드용 퍼센타일 런은 IRS 일별 대사표가 필요 없어
    그 루프(영업일당 커브 부트스트랩+12 범프)를 건너뛴다. 기본 False — 원본
    경로의 산출물은 변하지 않는다.

    funding_rate_fixed (s15 T1): True면 조달금리 쪽 계산(_funding_row·캐리의
    active_rate)이 funding_events 계단 스테핑을 받지 않고 funding_rate 상수를
    전 기간 그대로 쓴다. 금리 경로(쇼크) 쪽의 funding_events 사용(BOK 계단,
    FM 엔진 경로)은 영향받지 않는다 — 소유자 스펙: 조달은 상수, 시나리오
    금리 경로는 그대로.

    decomposition (s15 T2): 만기 시점 Total Return의 성분 분해(라운딩 전 float).
    bondMtm + bondCarry + fundingCost + swapMtm + swapCarry == totalPnL(비라운딩)
    이 부동소수점 항등으로 성립한다 — 모두 같은 루프의 같은 누적기에서 나온
    같은 float들이다(bondCarry는 총 이자수익+재투자수익, fundingCost는 음수).
    """
    try:
        base_date = date.fromisoformat(base_date_str)
    except Exception:
        base_date = date.today()

    chart_data: list[dict] = []
    cumulative_bond_carry = 0.0   # 채권 캐리 + 만기 재투자 수익
    cumulative_irs_carry  = 0.0   # IRS 일별 캐리 누적
    cumulative_funding    = 0.0   # s15 T2: 조달 비용 병렬 누적 (양수; 분해 전용)
    break_even_day = -1
    is_broken_even = False
    # HARDEN-1: 스왑 세타/평가 최종값(비라운딩) + 일별 분해 경로. 루프가 한 번도
    # 돌지 않는 극단(sim_days=0 미만)에서도 정의되도록 여기서 초기화한다.
    swap_theta_pnl = 0.0
    swap_valuation_pnl = 0.0
    decomposition_daily: list[dict] = []

    # s15 T1: 조달 비용 쪽이 보는 이벤트 목록 — 고정 조달 모드에서는 비운다.
    # 금리 경로(쇼크) 쪽 funding_events 사용은 아래에서 원본 그대로다.
    # SIM2-5 (ruling ④): 고정 모드에서도 옵트인 시 조달 비용이 금통위 이벤트로
    # 스테핑한다(base = 정책 상수). 기본(False)은 종전 고정 동작 그대로.
    _cost_events = [] if (funding_rate_fixed and not funding_stepping) else (funding_events or [])

    # 만기 채권을 재투자 Cash Pool로 추적
    bond_positions = [p for p in positions if p.bondType != "swap"]
    irs_positions  = [p for p in positions if p.bondType == "swap"]

    # 커스텀 경로 사전 처리 (웨이포인트 기반 factor 보간) — SIM2-4에서 IRS FM
    # 사전 계산보다 먼저 쓰이도록 함수 상단으로 이동(동작 불변).
    _sorted_cp = sorted(
        [{"day": int(p.get("day", 0)), "bp": float(p.get("bp", 0))} for p in (custom_path or [])],
        key=lambda x: x["day"],
    ) if custom_path else []

    def _factor(t: int) -> float:
        if _sorted_cp and base_shock_bp != 0:
            if t <= _sorted_cp[0]["day"]:
                return _sorted_cp[0]["bp"] / base_shock_bp
            if t >= _sorted_cp[-1]["day"]:
                return _sorted_cp[-1]["bp"] / base_shock_bp
            for i in range(len(_sorted_cp) - 1):
                lo, hi = _sorted_cp[i], _sorted_cp[i + 1]
                if lo["day"] <= t <= hi["day"]:
                    if hi["day"] == lo["day"]:
                        return lo["bp"] / base_shock_bp
                    r = (t - lo["day"]) / (hi["day"] - lo["day"])
                    return (lo["bp"] + r * (hi["bp"] - lo["bp"])) / base_shock_bp
        return (t / sim_days) if shock_type == "ramp" else (1.0 if t > 0 else 0.0)

    # ── SIM2-4 (ruling ③) — 스왑 경로 정합 활성화 조건 ──────────────────────
    # 경로 팩터는 설계 경로가 '비자명'할 때만 FM 엔진에 전달한다. 비자명 =
    # 웨이포인트가 캘린더 선형 램프(target × day/simDays)에서 벗어남. 자명한
    # 경로(빈 customPath, 정확한 선형 램프 — 골든 캡처의 대표 픽스처 포함)는
    # 종전 step/biz-ramp 레짐과 바이트 동일하게 남는다(절대-파라미터-부재
    # 바이트 동일성 게이트가 구조적으로 성립). 배열은 채권 쪽과 '같은'
    # _factor에서 뽑는다 — 병렬 수학 없음.
    _path_factor_arr: "np.ndarray | None" = None
    if _sorted_cp and base_shock_bp != 0 and any(
        abs(p["bp"] - base_shock_bp * p["day"] / sim_days) > 1e-9 for p in _sorted_cp
    ):
        _path_factor_arr = np.array([_factor(d) for d in range(sim_days + 1)], dtype=float)

    # ── IRS FM(Full Revaluation) 경로 사전 계산 ─────────────────────────────
    par_rates       = qe.parse_irs_curves(irs_curves or [], base_date=base_date)
    irs_fm_mtm      = np.zeros(sim_days + 1)   # 포트폴리오 합산 MTM 궤적 (실제 P&L = 세타+평가)
    irs_fm_mtm_theta = np.zeros(sim_days + 1)  # 세타손익 궤적 — 커브는 base_date 시점에 고정(zc_base),
                                                # 시간만 경과. metrics['npv_b']/['scf_b']에서 재구성.
    irs_fm_carry    = np.zeros(sim_days + 1)   # FM 파생 일별 캐리 (리픽싱 비선형 포함)
    irs_daily_scf   = np.zeros(sim_days + 1)   # 일별 리픽싱 정산 CF 합산 (scf_s)
    irs_shock_curve = (
        irs_shock_curve_prebuilt
        if irs_shock_curve_prebuilt is not None
        else _build_irs_shock_curve(shock_mode, base_shock_bp, shock_curves)
    )
    # BOK 이벤트 당일 KRD 재계산용 — 쇼크커브 numpy 배열로 미리 변환
    _irs_sc_t  = np.array([_st for _st, _ in irs_shock_curve], dtype=float) if irs_shock_curve else np.array([0.0, 30.0])
    _irs_sc_bp = np.array([_sb for _, _sb in irs_shock_curve], dtype=float) if irs_shock_curve else np.array([0.0,  0.0])
    irs_settlement_events: list[dict] = []
    _base_dt = None
    try:
        _base_dt = date.fromisoformat(base_date_str[:10]) if base_date_str else None
    except Exception:
        pass

    for i, p in enumerate(irs_positions):
        t_mat = max(float(p.remainingDays or 0) / 365.0, 1 / 365)
        if p.nextFixingDate:
            try:
                nfd   = date.fromisoformat(str(p.nextFixingDate)[:10])
                ref   = date.fromisoformat(base_date_str[:10])
                t_next = max((nfd - ref).days, 1) / 365.0
            except Exception:
                t_next = 0.25
        else:
            t_next = t_mat * 0.1 if t_mat < 0.25 else 0.25
        t_next = max(min(t_next, t_mat), 1.0 / 365.0)

        try:
            mtm_arr, _, carry_arr, metrics, *_ = qe.simulate_irs_path_fm(
                par_rates              = par_rates,
                notional               = p.notional or 0.0,
                fixed_rate_pct         = p.couponRate or 0.0,
                direction              = int(p.direction or 1),
                t_maturity             = t_mat,
                t_next_payment         = t_next,
                current_float_rate_pct = p.currentFloatRate or 0.0,
                sector                 = p.sector or "IRS",
                shock_curve            = irs_shock_curve,
                days_to_simulate       = sim_days,
                shock_type             = shock_type,
                base_date_str          = base_date_str,
                start_date_str         = str(p.startDate)[:10] if p.startDate else "",
                funding_events         = funding_events,
                # SIM2-4: 비자명 설계 경로일 때만 값이 있다(위 활성화 조건).
                path_factor            = _path_factor_arr,
            )
            irs_fm_mtm   += mtm_arr
            irs_fm_carry += carry_arr

            # 세타손익 궤적 재구성: npv_b(커브 고정 zc_base)와 scf_b(같은 커브 기준 정산CF)로
            # mtm_pnl과 동일한 방식(누적 정산CF + 클린 NPV 변화)으로 조립 — 커브가 base_date
            # 그대로 고정되어 있으니 이 궤적의 day-to-day 변화가 곧 "순수 세타"다.
            _npv_b_arr = np.asarray(metrics.get("npv_b", []), dtype=float)
            _scf_b_arr = np.asarray(metrics.get("scf_b", []), dtype=float)
            if _npv_b_arr.size > 0:
                _clip_b = min(_npv_b_arr.size, sim_days + 1)
                _mtm_b = (_npv_b_arr[:_clip_b] - _npv_b_arr[0]) + np.cumsum(_scf_b_arr[:_clip_b])
                irs_fm_mtm_theta[:_clip_b] += _mtm_b

            # 정산 이벤트 수집 (scf_s 배열에서 0이 아닌 날 = 리픽싱 정산일)
            scf_arr = metrics.get("scf_s", [])
            _scf_np = np.array(scf_arr, dtype=float)
            _clip   = min(len(_scf_np), sim_days + 1)
            if _clip > 0:
                irs_daily_scf[:_clip] += _scf_np[:_clip]

            for day_idx, scf in enumerate(scf_arr):
                if day_idx > 0 and abs(float(scf)) > 1:
                    event_date = (_base_dt + timedelta(days=day_idx)).isoformat() if _base_dt else None
                    irs_settlement_events.append({
                        "day":          day_idx,
                        "date":         event_date,
                        "positionName": getattr(p, "name", "") or getattr(p, "id", ""),
                        "positionId":   getattr(p, "id", ""),
                        "notional":     p.notional or 0,
                        "direction":    int(p.direction or 1),
                        "fixedRate":    p.couponRate or 0,
                        "settledCf":    round(float(scf)),
                    })
        except Exception as e:
            logger.exception("=== [CRITICAL] 엔진 크래시 상세 추적 (%s) ===", getattr(p, "id", ""))
            raise ValueError(f"FM Engine Crash ({getattr(p, 'id', '')}): {e}") from e

    # ── IRS 일별 손익 대사 — 정확한 일별 KRD 재계산 ────────────────────────────
    # 전략: 선형 에이징(_rage) 완전 폐기 → IRS_Trade 기반 실시간 KRD
    # 최적화: 일당 12개 범프 커브 1회 빌드 + 배치 DF LUT → 종목별 순수 NPV 차분만 수행
    _recon_names  = qe.KRD_NAMES
    _recon_tenors = qe.KRD_TENORS

    # ── BOK 이벤트 목록 (계단식 충격 모델에 사용) ───────────────────────────────
    # 1D/3M: BOK 이벤트 누적 bp (계단식)
    # 3M~6M: BOK ↔ IRS ramp 선형 보간
    # 6M+:   IRS shock_curve × 누적 factor (기존 ramp/step)
    try:
        _bok_evts_r = sorted(
            [{"day": (date.fromisoformat(ev["date"]) - base_date).days,
              "bp":  float(ev.get("shiftBp", 0))}
             for ev in (funding_events or [])
             if ev.get("date") and 0 <= (date.fromisoformat(ev["date"]) - base_date).days <= sim_days],
            key=lambda x: x["day"],
        )
    except Exception:
        _bok_evts_r = []

    def _cum_bok_r(day: int) -> float:
        """BOK 이벤트 누적 bp (day 이하 이벤트 합산, 계단식)."""
        return sum(e["bp"] for e in _bok_evts_r if e["day"] <= day)

    # 램프 충격을 영업일 기준으로 정규화(주말 skip) — simulate_irs_path_fm(irs_fm_mtm)과
    # 동일한 기준을 써야 "추정"(_cum_shock_r)과 "실제"(irs_fm_mtm)가 일관된다. 캘린더
    # 일수로 나누면 월요일에 토+일+월 3일치가 한꺼번에 반영되어 실제 P&L이 부풀어 보인다.
    _biz_ranks_r  = qe.biz_day_ranks(base_date, sim_days)
    _biz_total_r  = int(_biz_ranks_r[-1]) if _biz_ranks_r[-1] > 0 else max(sim_days, 1)

    def _ramp_factor_r(day: int) -> float:
        return float(_biz_ranks_r[min(max(day, 0), len(_biz_ranks_r) - 1)]) / _biz_total_r

    def _cum_shock_r(tau: float, day: int) -> float:
        """테너별 누적 충격 bp (계단식 1D/3M → 선형 소멸 at 1Y → ramp 1Y+).

        SIM2-4: 경로 정합이 활성화된 요청은 1Y+ ramp 성분이 biz-ranked ramp
        대신 설계 경로 팩터를 따른다 — FM 엔진(irs_fm_mtm)과 같은 기준을 써야
        "추정"과 "실제"가 일관된다는 기존 원칙 그대로다.
        """
        if _path_factor_arr is not None:
            _fac = float(_path_factor_arr[min(max(day, 0), sim_days)])
        else:
            _fac = _ramp_factor_r(day) if shock_type == "ramp" else (1.0 if day > 0 else 0.0)
        _ramp_bp = float(np.interp(tau, _irs_sc_t, _irs_sc_bp)) * _fac
        if not _bok_evts_r:
            return _ramp_bp
        _bok_bp = _cum_bok_r(day)
        if tau <= 0.25:          # 1D, 3M: BOK 계단식 100% 직결
            return _bok_bp
        elif tau < 1.0:          # 3M~1Y: BOK 선형 소멸 (6M≈67%, 9M≈33%)
            w = (tau - 0.25) / 0.75
            return _bok_bp * (1.0 - w) + _ramp_bp * w
        else:                    # 1Y+: IRS shock_curve ramp만 적용
            return _ramp_bp

    # ── 포지션별 IRS_Trade 사전 빌드 (불변 스케줄, 루프 밖) ─────────────────
    _pos_trades: list[tuple] = []   # (IRS_Trade | None, float_rate_pct)
    for _rp in irs_positions:
        _rt0 = max(float(_rp.remainingDays or 0) / 365.0, 1.0 / 365.0)
        _flt_r = float(_rp.currentFloatRate or 0.0)
        _fr_r  = float(_rp.couponRate or 0.0)
        _dir_r = int(_rp.direction or 1)
        _N_r   = float(_rp.notional or 0.0)
        _sec_r = _rp.sector or "IRS"

        if _rp.nextFixingDate:
            try:
                _nfd_r  = date.fromisoformat(str(_rp.nextFixingDate)[:10])
                _ref_r  = date.fromisoformat(base_date_str[:10])
                _t_nxt_r = max((_nfd_r - _ref_r).days, 1) / 365.0
            except Exception:
                _t_nxt_r = 0.25
        else:
            _t_nxt_r = _rt0 * 0.1 if _rt0 < 0.25 else 0.25
        _t_nxt_r = max(min(_t_nxt_r, _rt0), 1.0 / 365.0)

        _mat_dt_r = qe._modfol_bd(base_date + timedelta(days=round(_rt0 * 365)))
        _freq_m_r = 3   # quarterly (float_freq=0.25)
        _start_dt_r = None
        _sdate_str  = str(_rp.startDate)[:10] if _rp.startDate else ""
        if _sdate_str:
            try:
                _start_dt_r = date.fromisoformat(_sdate_str)
            except Exception:
                pass
        if _start_dt_r is None:
            _nxt_raw_r  = base_date + timedelta(days=max(round(_t_nxt_r * 365), 1))
            _nxt_adj_r  = qe._next_business_day(_nxt_raw_r)
            _start_dt_r = qe._modfol_bd(qe._subtract_months(_nxt_adj_r, _freq_m_r))

        if _mat_dt_r > _start_dt_r:
            _trade_r = qe.IRS_Trade(_start_dt_r, _mat_dt_r, _fr_r, _dir_r, _N_r, sector=_sec_r)
        else:
            _trade_r = None
        _pos_trades.append((_trade_r, _flt_r))

    # ── 일별 루프: 기준 커브 + 12 범프 커브 빌드 후 포트폴리오 KRD 합산 ────
    _flts_r    = [flt for (_, flt) in _pos_trades if flt > 0]
    _avg_flt0  = float(np.mean(_flts_r)) / 100.0 if _flts_r else 0.03   # Day 0 기준 float (소수)

    # 영업일 스케줄 (한국 공휴일+주말 제외) — recon/메인 시뮬 루프 공용
    _bizday_schedule = build_bizday_schedule(base_date, sim_days)

    irs_daily_recon: list[dict] = []
    _prev_cal_r = 0
    # ── 배포 계약 보정 — 원본과 다른 유일한 런타임 동작 ─────────────────────
    # 실제 프론트 브리지(position-bridge.ts, S6)는 irsParRates를 아직 싣지 않아
    # irsCurves가 빈 배열로 온다. 원본(rates-simulator-main)은 이 경우 아래
    # 대사 루프의 bootstrap_zero_curve/build_bumped_curves가 빈 par 커브로
    # ValueError를 던져 요청 전체가 500이었다(2026-07-15 실측). par 커브가
    # 없으면 IRS 일별 대사표 자체가 정의되지 않으므로, 대사표만 비우고
    # 나머지(채권 chartData/summary/pvbp/book)는 정상 산출한다. IRS 포지션이
    # 있는데 커브가 없는 경우는 원본과 동일하게 FM 경로에서 실패한다.
    if par_rates and not skip_recon:
        for _val_date_r, _cal_day, _dt_cal in _bizday_schedule:
            # ── 테너별 누적 충격 bp 계산 (계단식 1D/3M + ramp 6M+) ─────────────
            _cum_r    = {_n: _cum_shock_r(_tau, _cal_day)    for _n, _tau in zip(_recon_names, _recon_tenors)}
            _cum_prev = {_n: _cum_shock_r(_tau, _prev_cal_r) for _n, _tau in zip(_recon_names, _recon_tenors)}
            _daily_dbp_r = {_n: _cum_r[_n] - _cum_prev[_n] for _n in _recon_names}

            # ── par 커브 구성: 6M+ ramp + 1D/3M BOK 계단 앙커 ──────────────────
            # 6M+ par 노드는 ramp 충격 그대로 적용
            _cum_bok_rt = _cum_bok_r(_cal_day)
            _par_day_r: list[tuple[float, float]] = [
                (t_p, r_p + float(np.interp(t_p, _irs_sc_t, _irs_sc_bp))
                 * (_ramp_factor_r(_cal_day) if shock_type == "ramp" else (1.0 if _cal_day > 0 else 0.0))
                 * 1e-4)
                for t_p, r_p in par_rates
            ]
            # 1D/3M 앙커: 기본 float rate + BOK 누적 bp 반영 (계단식)
            _avg_flt_r_shocked = _avg_flt0 + _cum_bok_rt * 1e-4
            _par_anch_r = qe._inject_short_anchors(_par_day_r, _avg_flt_r_shocked)

            # 기준 + KRD_TENORS 범프 커브 (일당 1회 빌드)
            _zc_base_r   = qe.bootstrap_zero_curve(_par_anch_r)
            _zc_bumped_r = qe.build_bumped_curves(_par_anch_r)

            # 포트폴리오 KRD (배치 DF LUT 최적화)
            # 마켓 컨벤션: "N일자 KRD/PVBP"는 N의 결제일(다음 영업일) 기준으로 재평가한
            # 값을 보고한다 — irs_fm_mtm(simulate_irs_path_fm 내부에서 이미 동일 규칙
            # 적용됨)과 일관되도록 여기서도 val_date를 결제일로 한 번 밀어서 넘긴다.
            _pvbp_r = qe.portfolio_krd_day(_pos_trades, next_kr_business_day(_val_date_r), _zc_base_r, _zc_bumped_r)

            _pnl_r       = {_n: -_pvbp_r[_n] * _daily_dbp_r[_n] for _n in _recon_names}
            _total_est   = round(sum(_pnl_r.values()))
            _settle      = round(float(np.sum(irs_daily_scf[_prev_cal_r + 1:_cal_day + 1])))
            _total_act   = round(float(irs_fm_mtm[_cal_day] - irs_fm_mtm[_prev_cal_r]))
            _npv_change  = _total_act - _settle
            _residual    = _total_act - _total_est     # 잔차: 실제P&L − 추정P&L (양수=모델 과소추정)
            # 세타손익: 커브를 base_date 시점에 고정한 궤적(irs_fm_mtm_theta)의 같은 구간 변화.
            # 평가손익(=마켓무브): 실제P&L에서 세타손익을 뺀 나머지 — "그날 실제로 커브가
            # 움직여서 생긴" 손익만 분리한 값.
            _theta_pnl   = round(float(irs_fm_mtm_theta[_cal_day] - irs_fm_mtm_theta[_prev_cal_r]))
            _valuation_pnl = _total_act - _theta_pnl
            irs_daily_recon.append({
                "date":         _val_date_r.isoformat(),
                "day":          _cal_day,
                "pvbp":         {_n: round(_pvbp_r[_n]) for _n in _recon_names},
                "cumulativeBp": {_n: round(_cum_r[_n], 3) for _n in _recon_names},
                "dailyDbp":     {_n: round(_daily_dbp_r[_n], 4) for _n in _recon_names},
                "pnl":          {_n: round(_pnl_r[_n]) for _n in _recon_names},
                "totalEstPnl":  _total_est,
                "totalActual":  _total_act,
                "settleCf":     _settle,
                "npvChange":    _npv_change,
                "residual":     _residual,
                "thetaPnl":     _theta_pnl,
                "valuationPnl": _valuation_pnl,
            })
            _prev_cal_r = _cal_day

    # (SIM2-4: 커스텀 경로 전처리(_sorted_cp/_factor)는 IRS FM 사전 계산보다
    #  먼저 필요해져 함수 상단으로 이동했다 — 동작 불변, 위치만 이동.)

    # 단기 이벤트 계단 함수: funding_events 날짜 → D+N 변환
    try:
        _short_evts = sorted(
            [
                {
                    "day": (date.fromisoformat(ev["date"]) - base_date).days,
                    "bp":  float(ev.get("shiftBp", 0)),
                }
                for ev in (funding_events or [])
                if ev.get("date") and 0 <= (date.fromisoformat(ev["date"]) - base_date).days <= sim_days
            ],
            key=lambda x: x["day"],
        )
        _cum_short = sum(e["bp"] for e in _short_evts)
    except Exception:
        _short_evts = []
        _cum_short = 0.0

    def _short_factor(t: int) -> float:
        """잔존 1Y 미만 채권용: BOK 이벤트 누적 변동 기준 정규화 계단 함수."""
        if not _short_evts or _cum_short == 0:
            return _factor(t)
        cum_t = sum(e["bp"] for e in _short_evts if e["day"] <= t)
        return cum_t / _cum_short

    def _get_bond_zone(p: FrontendPosition, day: int) -> str:
        cr = max(float(p.remainingDays or 1) - day, 0.0)
        r = cr / 365.0
        if r < 0.25: return "short"
        if r < 1.0:  return "blend"
        return "long"

    # ── s11 T4: 시간축 조달금리/캐리 스트립 ─────────────────────────────────
    def _weighted_position_rate(t: int, multiplier: float, cur_date: date) -> float | None:
        """비만기 채권의 평가액가중 운용수익률(소수). calculate_daily_carry의
        carry_rate(mtmYield + 경로 충격 bp/100)와 같은 정의를 써서 캐리 표기가
        엔진의 캐리 계산과 어긋나지 않게 한다. 살아있는 채권이 없으면 None."""
        tot_eval = 0.0
        acc = 0.0
        for p in bond_positions:
            initial_remaining = max(float(p.remainingDays or 0), 0.0)
            matured = _is_matured(p, cur_date) or (initial_remaining > 0 and t >= initial_remaining)
            if matured:
                continue
            ev = p.evaluationAmount or 0.0
            if ev <= 0:
                continue
            shock_bp = get_position_shock_bp(p, shock_mode, shock_type, base_shock_bp, shock_curves, multiplier, t)
            acc += ev * ((p.mtmYield or 0.0) + shock_bp / 100.0)
            tot_eval += ev
        return (acc / tot_eval) / 100.0 if tot_eval > 0 else None

    def _funding_row(t: int, cur_date: date, multiplier: float) -> dict:
        rate = calc_dynamic_funding_rate(funding_rate, _cost_events, cur_date)
        pos_rate = _weighted_position_rate(t, multiplier, cur_date)
        return {
            "day": t,
            "date": cur_date.isoformat(),
            "fundingRate": rate,        # 소수 (0.042 = 4.2%)
            "positionRate": pos_rate,   # 소수; 살아있는 채권 없으면 None
            "carryBp": None if pos_rate is None else round((pos_rate - rate) * 10000.0, 2),
        }

    funding_curve: list[dict] = []

    # ── s18 T3: 이 런이 실제로 소비한 국채 3Y 누적 충격 경로 (bp) ────────────
    # 금리 팬(이중축 분리의 1축)은 "라벨이 진실인" 금리 분위수 밴드를 그린다 —
    # 그 원천은 엔진이 채권 쇼크에 실제로 쓴 것과 같은 변수들이다: matrix 모드는
    # 국채 커브의 3Y 노드 보간 × multiplier, parallel 모드는 base_shock_bp ×
    # multiplier. 새 수식이 아니라 calculate_daily_mtm이 소비하는 항의 3Y 단면.
    def _ktb3y_bp(mult: float) -> float:
        if shock_mode == "parallel" or not shock_curves:
            return (base_shock_bp or 0.0) * mult
        ktb = shock_curves.bondCurves.get("국채") or []
        return interpolate_curve_shift(3.0, ktb) * mult

    rate_path: list[dict] = []

    # Day 0 초기 항목 (모든 P&L = 0)
    chart_data.append({"day": 0, "mtmPnL": 0, "cumulativeCarry": 0, "swapPnL": 0, "totalPnL": 0,
                        "swapThetaPnL": 0, "swapValuationPnL": 0})
    # HARDEN-1: 일별 분해 경로도 chartData와 같은 day 축 — day 0 = 전 성분 0.
    decomposition_daily.append({
        "day": 0, "fundingCost": 0.0, "bondMtm": 0.0, "bondCarry": 0.0,
        "swapMtm": 0.0, "swapCarry": 0.0, "total": 0.0,
    })
    funding_curve.append(_funding_row(0, base_date, _factor(0)))
    rate_path.append({"day": 0, "bp": _ktb3y_bp(_factor(0))})

    prev_cal        = 0
    prev_short_mult = _short_factor(0)
    bond_mtm  = 0.0   # 루프가 비어도(영업일 0일) 분해가 정의되도록 초기화
    irs_mtm_t = 0.0
    for current_date, cal_day, dt_cal in _bizday_schedule:
        t = cal_day
        multiplier = _factor(t)
        short_mult  = _short_factor(t)
        active_rate = calc_dynamic_funding_rate(funding_rate, _cost_events, current_date)

        # 채권: 기존 선형 MTM / IRS: FM 결과 직접 사용 (내부에서 이미 ramp/step 적용)
        bond_mtm  = calculate_daily_mtm(bond_positions, shock_mode, shock_type, base_shock_bp, shock_curves, multiplier, t, current_date, short_mult)
        irs_mtm_t = float(irs_fm_mtm[t])

        # BOK 이벤트 당일/영업일: 구간별(3M미만/3M~1Y/1Y이상) MTM 변화 분해 (검증용)
        bok_breakdown = None
        if _short_evts and short_mult != prev_short_mult:
            prev_mult_bd = _factor(prev_cal)
            prev_sf_bd   = _short_factor(prev_cal)
            prev_date_bd = base_date + timedelta(days=prev_cal)
            bd: dict[str, object] = {}
            for zone_name in ("short", "blend", "long"):
                z_cur  = [p for p in bond_positions if p.bondType != "swap" and _get_bond_zone(p, t)       == zone_name]
                z_prev = [p for p in bond_positions if p.bondType != "swap" and _get_bond_zone(p, prev_cal) == zone_name]
                cur_m  = calculate_daily_mtm(z_cur,  shock_mode, shock_type, base_shock_bp, shock_curves, multiplier,    t,       current_date, short_mult)  if z_cur  else 0.0
                prev_m = calculate_daily_mtm(z_prev, shock_mode, shock_type, base_shock_bp, shock_curves, prev_mult_bd, prev_cal, prev_date_bd, prev_sf_bd)  if z_prev else 0.0
                # 구간 현재 PVBP 합산 (에이징 반영) — 암묵적 bp 역산용
                zone_pvbp = sum(
                    (p.pvbp or 0.0) * max(float(p.remainingDays or 1) - t, 0.0) / max(float(p.remainingDays or 1), 1.0)
                    for p in z_cur
                )
                bd[f"{zone_name}Delta"] = round(cur_m - prev_m)
                bd[f"{zone_name}Pvbp"]  = round(zone_pvbp)

            # IRS KRD 구간별 분해: BOK 이벤트 당일 에이징된 par커브로 KRD 재계산
            # 단기(1D/3M): BOK 정책금리 직결 → _bok_event_bp 그대로 사용
            # 장기(1Y+):  [SIM2-4] 비자명 설계 경로가 활성화된 요청은 IRS FM이
            #              그 경로를 타므로 이 진단도 같은 경로 팩터를 쓴다;
            #              그 외에는 종전 linear ramp(factor=day/sim_days).
            _bok_event_bp  = sum(e["bp"] for e in _short_evts if prev_cal < e["day"] <= t)
            if _path_factor_arr is not None:
                _irs_ramp_step = float(
                    _path_factor_arr[min(t, sim_days)] - _path_factor_arr[min(max(prev_cal, 0), sim_days)]
                )
            else:
                _irs_ramp_step = dt_cal / max(sim_days, 1)  # 영업일 기간 ramp 증분 (월요일=3/sim_days)
            _KRD_PAIRS = [
                ("1D", 1/365), ("3M", 0.25), ("6M", 0.5),  ("9M", 0.75),
                ("1Y", 1.0),   ("1.5Y", 1.5), ("2Y", 2.0), ("3Y", 3.0),
                ("4Y", 4.0),   ("5Y", 5.0),  ("7Y", 7.0),  ("10Y", 10.0),
            ]
            _irs_1p = _irs_3p = _irs_bp = _irs_lp = 0.0  # PVBP 합산
            _irs_1d = _irs_3d = _irs_bd = _irs_ld = 0.0  # P&L 합산
            # BOK 이벤트 당일 shocked par 커브 — [SIM2-4] 경로 활성 시 설계 팩터.
            _fac_irs = (
                float(_path_factor_arr[min(t, sim_days)])
                if _path_factor_arr is not None
                else t / max(sim_days, 1)
            )
            _par_t   = [(tau, r + float(np.interp(tau, _irs_sc_t, _irs_sc_bp)) * _fac_irs * 1e-4)
                        for tau, r in par_rates]
            _FLOAT_Q = 0.25  # 분기 픽싱 표준
            for _p in irs_positions:
                _t_mat_0 = max(float(_p.remainingDays or 0) / 365.0, 1.0/365.0)
                _t_mat_t = max(_t_mat_0 - t / 365.0, 1.0/365.0)
                if _t_mat_t < 2.0/365.0:   # 사실상 만기 → 스킵
                    continue
                # 에이징된 다음 변동일:
                # nextFixingDate 기준으로 이벤트 당일(current_date)까지 에이징
                # → enrich_irs_pvbp 의 t_next 계산과 동일 방식 → pvbpSensitivity 일치
                # 지난 픽싱일이면 91일(분기 근사) 단위로 롤링하여 미래 픽싱일 산출
                if _p.nextFixingDate:
                    try:
                        _nfd = date.fromisoformat(str(_p.nextFixingDate)[:10])
                        _days_to_nfd = (_nfd - current_date).days
                        while _days_to_nfd <= 0:
                            _days_to_nfd += 91  # 분기 근사 롤링
                        _t_nxt_t = max(min(_days_to_nfd / 365.0, _t_mat_t), 1.0/365.0)
                    except Exception:
                        _k_fl    = int(_t_mat_t / _FLOAT_Q)
                        _t_nxt_t = _t_mat_t - _k_fl * _FLOAT_Q
                        if _t_nxt_t < 1.0/365.0: _t_nxt_t = _FLOAT_Q
                        _t_nxt_t = max(min(_t_nxt_t, _t_mat_t), 1.0/365.0)
                else:
                    # nextFixingDate 없으면 backward-from-maturity fallback
                    _k_fl    = int(_t_mat_t / _FLOAT_Q)
                    _t_nxt_t = _t_mat_t - _k_fl * _FLOAT_Q
                    if _t_nxt_t < 1.0/365.0: _t_nxt_t = _FLOAT_Q
                    _t_nxt_t = max(min(_t_nxt_t, _t_mat_t), 1.0/365.0)
                try:
                    _krd = qe.compute_irs_krd_map(
                        par_rates              = _par_t,
                        notional               = _p.notional or 0.0,
                        fixed_rate_pct         = _p.couponRate or 0.0,
                        direction              = int(_p.direction or 1),
                        t_maturity             = _t_mat_t,
                        t_next_payment         = _t_nxt_t,
                        current_float_rate_pct = _p.currentFloatRate or 0.0,
                        sector                 = _p.sector or "IRS",
                        sim_date               = current_date,
                    )
                except Exception as _krd_err:
                    logger.warning(
                        "[BOK KRD] t=%s pos=%s t_mat=%.3f t_nxt=%.3f err=%s",
                        t, _p.sector, _t_mat_t, _t_nxt_t, _krd_err,
                    )
                    # 재계산 실패 시 만기 비율로 t=0 KRD를 1차 근사 스케일링
                    _age_scale = _t_mat_t / max(_t_mat_0, 1.0/365.0)
                    _krd = {k: v * _age_scale for k, v in (_p.krdMap or {}).items()}
                for _tn, _ty in _KRD_PAIRS:
                    _kv = _krd.get(_tn, 0.0) or 0.0
                    if abs(_kv) < 1:
                        continue
                    # 해당 테너의 IRS ramp 증분: 쇼크 커브에서 τ별 크기 보간 × (dt_cal/sim_days)
                    _irs_d_bp = float(np.interp(_ty, _irs_sc_t, _irs_sc_bp)) * _irs_ramp_step
                    if _ty < 0.1:         # 1D — BOK 정책금리 직결
                        _irs_1p += _kv;  _irs_1d -= _kv * _bok_event_bp
                    elif _ty <= 0.25:     # 3M — BOK 직결
                        _irs_3p += _kv;  _irs_3d -= _kv * _bok_event_bp
                    elif _ty <= 1.0:      # 3M~1Y — BOK ↔ IRS ramp 선형 블렌드
                        _w   = (_ty - 0.25) / 0.75
                        _dbp = _bok_event_bp * (1 - _w) + _irs_d_bp * _w
                        _irs_bp += _kv;  _irs_bd -= _kv * _dbp
                    else:                 # 1Y이상 — IRS linear ramp 기준 (채권 커스텀 경로와 무관)
                        _irs_lp += _kv;  _irs_ld -= _kv * _irs_d_bp
            # 블렌드/장기 대표 변동폭: IRS 쇼크 커브의 5Y 기준 × ramp 증분
            _irs_long_d_bp = float(np.interp(5.0, _irs_sc_t, _irs_sc_bp)) * _irs_ramp_step
            _blend_mid_bp  = round((_bok_event_bp * 0.5 + _irs_long_d_bp * 0.5) * 10) / 10
            bd.update({
                "irs1dPvbp":    round(_irs_1p), "irs1dDelta":    round(_irs_1d),
                "irs3mPvbp":    round(_irs_3p), "irs3mDelta":    round(_irs_3d),
                "irsBlendPvbp": round(_irs_bp), "irsBlendDelta": round(_irs_bd),
                "irsLongPvbp":  round(_irs_lp), "irsLongDelta":  round(_irs_ld),
                "bokShortBp":   round(_bok_event_bp    * 10) / 10,  # BOK 이벤트 실제 bp
                "bokBlendBp":   _blend_mid_bp,                        # IRS 블렌드 중간점
                "bokLongBp":    round(_irs_long_d_bp   * 10) / 10,  # IRS 5Y 기준 장기 변동폭
            })
            bok_breakdown = bd
        # 일별 캐리: 채권만 calculate_daily_carry, IRS는 FM 엔진 리턴 값 사용 (리픽싱 비선형 반영)
        bond_carry  = calculate_daily_carry(bond_positions, shock_mode, shock_type, base_shock_bp, shock_curves, active_rate, multiplier, t, current_date, dt_cal=dt_cal)
        # s15 T2: 같은 인자의 조달 비용 성분만 병렬 누적 (분해 전용 — 기존 수치 불변)
        cumulative_funding += calculate_daily_funding_cost(bond_positions, active_rate, t, current_date, dt_cal=dt_cal)
        irs_carry_t = float(np.sum(irs_fm_carry[prev_cal + 1:t + 1]))
        # 만기 채권의 재투자 수익: Notional 기준으로 Funding Cost와 정확히 상쇄
        reinvested_cash = sum(
            p.notional or 0.0
            for p in bond_positions
            if float(p.remainingDays or 0) <= t
        )
        daily_cash_return = reinvested_cash * active_rate * dt_cal / 365.0

        cumulative_bond_carry += (bond_carry or 0.0) + daily_cash_return
        cumulative_irs_carry  += (irs_carry_t or 0.0)

        # 스왑손익 = IRS MTM + 누적 IRS 캐리
        swap_pnl  = irs_mtm_t + cumulative_irs_carry
        total_pnl = bond_mtm + cumulative_bond_carry + swap_pnl
        total_mtm = bond_mtm + irs_mtm_t   # BEP 체크용

        # 스왑손익 분해: 세타손익(커브 고정, 시간경과만) + 평가손익(그날 실제 커브변동)
        # irs_fm_mtm_theta는 irs_fm_mtm과 동일한 방식(누적 정산CF+클린NPV변화)으로 조립된
        # "커브 고정" 궤적이라, 둘의 차이가 곧 누적 평가손익이다(일별 대사표와 동일 정의).
        swap_theta_pnl      = float(irs_fm_mtm_theta[t]) + cumulative_irs_carry
        swap_valuation_pnl  = swap_pnl - swap_theta_pnl

        if total_pnl >= 0 and total_mtm < 0 and not is_broken_even:
            break_even_day = t
            is_broken_even = True

        entry: dict = {
            "day": t,
            "mtmPnL":         round(bond_mtm)             if bond_mtm             else 0,
            "cumulativeCarry": round(cumulative_bond_carry) if cumulative_bond_carry else 0,
            "swapPnL":        round(swap_pnl)              if swap_pnl             else 0,
            "totalPnL":       round(total_pnl)             if total_pnl            else 0,
            "swapThetaPnL":     round(swap_theta_pnl)      if swap_theta_pnl       else 0,
            "swapValuationPnL": round(swap_valuation_pnl)  if swap_valuation_pnl   else 0,
        }
        # HARDEN-1: 일별 누적 성분 분해(비라운딩 float) — 최종 decomposition과
        # 같은 누적기에서 나온 같은 float들이라 매일
        # fundingCost + bondMtm + bondCarry + swapMtm + swapCarry == total 이
        # 부동소수점 항등으로 성립한다. 스왑 성분은 세타/평가 대칭 분해
        # (아래 decomposition 주석 참조).
        decomposition_daily.append({
            "day":         t,
            "fundingCost": -cumulative_funding,
            "bondMtm":     bond_mtm,
            "bondCarry":   cumulative_bond_carry + cumulative_funding,
            "swapMtm":     swap_valuation_pnl,
            "swapCarry":   swap_theta_pnl,
            "total":       total_pnl,
        })
        if bok_breakdown:
            entry["bokBreakdown"] = bok_breakdown
        chart_data.append(entry)
        funding_curve.append(_funding_row(t, current_date, multiplier))
        rate_path.append({"day": t, "bp": _ktb3y_bp(multiplier)})

        prev_cal        = t
        prev_short_mult = short_mult

    last = chart_data[-1] if chart_data else {}
    summary = {
        "finalMTM":   last.get("mtmPnL", 0),
        "finalCarry": last.get("cumulativeCarry", 0),
        "finalSwap":  last.get("swapPnL", 0),
        "finalTotal": last.get("totalPnL", 0),
        "breakEvenDay": break_even_day,
    }

    # s15 T2 — 만기 시점 Total Return 분해 (비라운딩 float; 문서화된 항등:
    # bondMtm + bondCarry + fundingCost + swapMtm + swapCarry == 최종 totalPnL).
    # bondCarry = 총 이자수익 + 만기 재투자 수익 (= net 누적 + 조달 누적),
    # fundingCost = -조달 누적. 모두 위 루프의 같은 float 누적기에서 나온다.
    #
    # HARDEN-1 (스왑캐리 어드주디케이션, route ii): 엔진의 daily_carry는
    # quant_engine.simulate_irs_path_fm이 정산 CF를 mtm_pnl(더티)에 접어 넣고
    # 무조건 0을 리턴하므로(cumulative_irs_carry ≡ 0), 이전의 swapMtm=더티 전액
    # / swapCarry=0 분해는 채권 분해(평가 vs 캐리)와 비대칭이었다. 이제 스왑도
    # 같은 정의로 나눈다 — swapCarry = 세타손익(커브 base_date 고정, 시간경과
    # + 정산 CF = irs_fm_mtm_theta 궤적 + cumulative_irs_carry), swapMtm =
    # 평가손익(전체 − 세타). 두 값은 위 루프가 이미 chartData(swapThetaPnL/
    # swapValuationPnL)용으로 계산한 동일 float들이며, 합은 종전 스왑 전액과
    # 동일하므로 total·bond 성분·funding은 바이트 동일하게 유지된다.
    decomposition = {
        "bondMtm":     bond_mtm,
        "bondCarry":   cumulative_bond_carry + cumulative_funding,
        "fundingCost": -cumulative_funding,
        "swapMtm":     swap_valuation_pnl,
        "swapCarry":   swap_theta_pnl,
        "total":       bond_mtm + cumulative_bond_carry + irs_mtm_t + cumulative_irs_carry,
        # HARDEN-1: 일별 누적 경로 (orchestrator가 응답의 decompositionDaily로
        # 분리한다 — 튜플 모양을 바꾸지 않기 위해 dict에 실어 보낸다).
        "daily":       decomposition_daily,
    }

    return chart_data, summary, irs_settlement_events, irs_daily_recon, funding_curve, decomposition, rate_path
