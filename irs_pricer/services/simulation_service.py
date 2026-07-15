"""
Scenario-simulation service: the computation behind POST /api/simulate.

Ported from rates-simulator-main/backend/main.py (the module-level helpers plus
the body of its `simulate()` endpoint) onto this repo's engine/quant_engine.py,
which is byte-identical to the source's quant_engine.py -- so every number this
service produces comes from the same engine code the source service ran.

Deliberate deviations from the source, kept to the glue only:
- `build_pvbp_sensitivity` is rewritten pandas-free (this deployment does not
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
from datetime import date, timedelta

import numpy as np
from pydantic import BaseModel

from ..engine import quant_engine as qe

try:
    import holidays as _hols_lib
    _KR_HOLIDAYS = _hols_lib.KR(years=range(2020, 2035))
except ImportError:
    _KR_HOLIDAYS = set()

logger = logging.getLogger(__name__)


# ── 프론트엔드 시뮬레이션 요청 모델 ──────────────────────────────────────────

class FrontendPosition(BaseModel):
    id: str = ""
    name: str = ""
    book: str = ""
    bondType: str = "bond"              # 'swap' | 'bond'
    sector: str = ""
    maturityDate: str | None = None
    couponRate: float = 0.0
    frequency: int = 2
    notional: float = 0.0
    entryYield: float = 0.0
    evaluationAmount: float = 0.0
    duration: float = 0.0
    pvbp: float = 0.0
    tenor: str = ""
    remainingDays: float = 0.0
    krdMap: dict[str, float] = {}
    mtmYield: float | None = None
    expectedThetaPnL: float | None = None
    direction: float = 1.0          # IRS: +1=receive-fixed, -1=pay-fixed / Bond: +1=long
    currentFloatRate: float = 0.0   # IRS 현재 구간 변동금리 (% 단위, e.g. 2.81)
    nextFixingDate: str | None = None   # IRS 다음 변동금리 픽싱/지급일 (ISO date string)
    startDate: str | None = None        # IRS 계약 시작일 (ISDA Forward Schedule 생성용)


class FrontendShockCurves(BaseModel):
    bondCurves: dict[str, list[dict]] = {}  # {섹터키: [{t, val}, ...]}
    swapCurve: list[dict] = []
    fundingEvents: list[dict] = []


# ── 퀀트 엔진 헬퍼 함수 ───────────────────────────────────────────────────────

def get_sector_curve_key(sector: str) -> str:
    s = sector or ""
    if any(k in s for k in ("국고", "통안", "국채")): return "국채"
    if any(k in s for k in ("시은", "은행")): return "은행채"
    if any(k in s for k in ("특은", "공사")): return "특은채"
    if any(k in s for k in ("여전", "카드")): return "카드채"
    if "회사" in s: return "회사채"
    return "국채"


def parse_tenor_to_years(tenor: str) -> float:
    t = str(tenor).upper().replace("년", "Y").replace("개월", "M").replace("일", "D").strip()
    try:
        if "Y" in t: return float(t.replace("Y", ""))
        if "M" in t: return float(t.replace("M", "")) / 12
        if "D" in t: return float(t.replace("D", "")) / 365
        return float(t)
    except Exception:
        return 0.0


def interpolate_curve_shift(years: float, curve: list[dict]) -> float:
    if not curve:
        return 0.0
    pts = sorted(
        [{"t": float(p.get("t", 0)), "val": float(p.get("val", 0))} for p in curve],
        key=lambda x: x["t"],
    )
    if not pts: return 0.0
    if years <= pts[0]["t"]: return pts[0]["val"]
    if years >= pts[-1]["t"]: return pts[-1]["val"]
    for i in range(len(pts) - 1):
        lo, hi = pts[i], pts[i + 1]
        if lo["t"] <= years <= hi["t"]:
            if hi["t"] == lo["t"]: return lo["val"]
            ratio = (years - lo["t"]) / (hi["t"] - lo["t"])
            return lo["val"] + (hi["val"] - lo["val"]) * ratio
    return 0.0


def get_position_shock_bp(
    p: FrontendPosition,
    shock_mode: str,
    shock_type: str,
    base_shock_bp: float,
    shock_curves: FrontendShockCurves | None,
    multiplier: float,
    t: int,
) -> float:
    if shock_mode == "parallel":
        return (base_shock_bp or 0.0) * multiplier
    if not shock_curves:
        return 0.0
    safe_remaining = max(p.remainingDays or 0, 0)
    eval_days = safe_remaining if shock_type == "step" else max(0, safe_remaining - t)
    years = eval_days / 365.0
    if p.bondType == "swap":
        return interpolate_curve_shift(years, shock_curves.swapCurve) * multiplier
    curve_key = get_sector_curve_key(p.sector)
    target = (
        shock_curves.bondCurves.get(curve_key)
        or shock_curves.bondCurves.get("국채")
        or []
    )
    return interpolate_curve_shift(years, target) * multiplier


def _is_matured(p: FrontendPosition, current_date: date) -> bool:
    if p.maturityDate:
        try:
            return current_date >= date.fromisoformat(p.maturityDate)
        except Exception:
            pass
    return False


def calculate_daily_mtm(
    positions: list[FrontendPosition],
    shock_mode: str,
    shock_type: str,
    base_shock_bp: float,
    shock_curves: FrontendShockCurves | None,
    multiplier: float,
    t: int,
    current_date: date | None = None,
    short_multiplier: float | None = None,  # 잔존 1Y 미만 채권에 적용 (BOK 계단 함수)
) -> float:
    total = 0.0
    for p in positions:
        if current_date and _is_matured(p, current_date):
            continue

        initial_remaining = max(float(p.remainingDays or 1), 1.0)
        initial_pvbp = p.pvbp or 0.0

        if p.bondType != "swap":
            # 채권: 잔존일수·PVBP를 매일 재산정
            current_remaining = max(initial_remaining - t, 0.0)

            if current_remaining <= 0:
                continue  # 만기 Roll-off: MTM = 0

            current_pvbp = initial_pvbp * (current_remaining / initial_remaining)

            # 잔존기간별 팩터 결정:
            #   < 3M (0.25Y) : BOK 계단 함수 (기준금리 직결)
            #   3M ~ 1Y      : BOK ↔ 웨이포인트 선형 보간
            #   >= 1Y        : 웨이포인트 경로
            r_years = current_remaining / 365.0
            if short_multiplier is not None:
                if r_years < 0.25:
                    eff_mult = short_multiplier
                elif r_years < 1.0:
                    blend = (r_years - 0.25) / (1.0 - 0.25)   # 0 at 3M → 1 at 1Y
                    eff_mult = short_multiplier * (1.0 - blend) + multiplier * blend
                else:
                    eff_mult = multiplier
            else:
                eff_mult = multiplier

            if shock_mode == "parallel":
                shock_bp = (base_shock_bp or 0.0) * eff_mult
            else:
                if not shock_curves:
                    shock_bp = 0.0
                else:
                    curve_key = get_sector_curve_key(p.sector)
                    target = (
                        shock_curves.bondCurves.get(curve_key)
                        or shock_curves.bondCurves.get("국채")
                        or []
                    )
                    # BOK 이벤트는 기준금리(KTB) 성분에만 적용; 크레딧 스프레드는 장기 경로를 따름
                    # → 특은채 등에 크레딧 스프레드가 포함된 경우 eff_mult가 스프레드까지 스케일하는 오류 방지
                    ktb_curve  = shock_curves.bondCurves.get("국채") or []
                    ktb_at_r   = interpolate_curve_shift(r_years, ktb_curve)
                    total_at_r = interpolate_curve_shift(r_years, target)
                    credit_addon = total_at_r - ktb_at_r   # 크레딧 스프레드 성분
                    shock_bp = ktb_at_r * eff_mult + credit_addon * multiplier

            total += current_pvbp * (-shock_bp)
        else:
            # IRS: PVBP는 DV01 관행 (receive-fixed=양수, pay-fixed=음수)
            # MTM = pvbp * (-shock_bp)  — 채권과 동일 공식
            if current_date and _is_matured(p, current_date):
                continue
            shock_bp = get_position_shock_bp(p, shock_mode, shock_type, base_shock_bp, shock_curves, multiplier, t)
            aging = 1.0 if shock_type == "step" else max(0.0, initial_remaining - t) / initial_remaining
            total += initial_pvbp * aging * (-shock_bp)

    return total


def calculate_daily_carry(
    positions: list[FrontendPosition],
    shock_mode: str,
    shock_type: str,
    base_shock_bp: float,
    shock_curves: FrontendShockCurves | None,
    active_funding_rate: float,
    multiplier: float,
    t: int,
    current_date: date | None = None,
    dt_cal: int = 1,
) -> float:
    total = 0.0
    for p in positions:
        if p.bondType == "swap":
            continue  # IRS carry는 FM 엔진(irs_fm_carry)이 전담
        initial_remaining = max(float(p.remainingDays or 0), 0.0)
        matured = (current_date and _is_matured(p, current_date)) or (initial_remaining > 0 and t >= initial_remaining)
        if matured:
            # 조달의 연속성: 만기 후에도 Notional에 대한 Funding Cost 유지
            total -= (p.notional or 0.0) * active_funding_rate * dt_cal / 365.0
        else:
            shock_bp   = get_position_shock_bp(p, shock_mode, shock_type, base_shock_bp, shock_curves, multiplier, t)
            eval_amt   = p.evaluationAmount or 0.0
            # 금리 경로에 따라 채권 운용수익률도 상승 (carry_rate = mtmYield + 경로상 bp 변동)
            # 조달금리(active_funding_rate)는 금통위 이벤트 시 BOK bp만큼 이미 상승 반영됨
            # → 두 효과가 서로 상쇄되어 순 carry 변화는 (금리경로 - BOK 인상) 차이만큼
            carry_rate = (p.mtmYield or 0.0) + shock_bp / 100.0
            total += (eval_amt * (carry_rate / 100.0)) * dt_cal / 365.0 - (eval_amt * active_funding_rate) * dt_cal / 365.0
    return total


def calc_dynamic_funding_rate(base_rate: float, funding_events: list[dict], current_date: date) -> float:
    total = base_rate or 0.0
    for ev in funding_events:
        try:
            if date.fromisoformat(ev.get("date", "")) <= current_date:
                total += ev.get("shiftBp", 0) / 10000.0
        except Exception:
            pass
    return total


def next_kr_business_day(d: date) -> date:
    """d의 다음 한국 영업일(주말+공휴일 제외) — '결제일(T+1)' 계산용."""
    try:
        kr_hols = _hols_lib.KR(years=range(d.year, d.year + 2))
    except Exception:
        kr_hols = _KR_HOLIDAYS
    nd = d + timedelta(days=1)
    while nd.weekday() >= 5 or nd in kr_hols:
        nd += timedelta(days=1)
    return nd


def modified_following_kr(d: date) -> date:
    """Modified Following(한국 공휴일 반영): 다음 영업일로 조정하되, 그 조정이
    월(月)을 넘기면 대신 직전 영업일로 조정. par curve 테너 만기일 계산에 사용."""
    try:
        kr_hols = _hols_lib.KR(years=range(d.year - 1, d.year + 2))
    except Exception:
        kr_hols = _KR_HOLIDAYS

    def _is_biz(x: date) -> bool:
        return x.weekday() < 5 and x not in kr_hols

    if _is_biz(d):
        return d
    fwd = d
    while not _is_biz(fwd):
        fwd += timedelta(days=1)
    if fwd.month != d.month:
        bwd = d
        while not _is_biz(bwd):
            bwd -= timedelta(days=1)
        return bwd
    return fwd


_TENOR_MONTHS = {
    "3m": 3, "6m": 6, "9m": 9, "1y": 12, "18m": 18, "2y": 24,
    "3y": 36, "4y": 48, "5y": 60, "6y": 72, "7y": 84, "8y": 96,
    "9y": 108, "10y": 120,
}


def tenor_to_maturity_date(base_date: date, tenor: str) -> date | None:
    """테너 라벨(예: '3m', '1y')과 평가일(base_date)로 실제 만기일을 계산.
    월단위 테너는 base_date + N개월을 Modified Following(한국 공휴일 반영)으로
    조정 — 이 값이 파일에서 받던 '만기' 컬럼과 동일한 시장 관행(예: '3m' →
    2026-06-23처럼 실제 며칠씩 어긋나는 값)을 그대로 재현한다. '1d'는 익영업일.
    1y 만기가 주말/공휴일이라 익영업일로 넘어가 실제로는 365일보다 길어지더라도,
    그 조정된 날짜에 '1년 par rate'를 그대로 적용해 일자별 부트스트래핑한다
    (라벨 T=1.0로 강제 클램프하지 않음 — parse_irs_curves가 이 실제 날짜 기준
    T를 그대로 사용).
    """
    t = str(tenor).strip().lower()
    if t in ("1d", "1일", "o/n", "on", "overnight"):
        return next_kr_business_day(base_date)
    months = _TENOR_MONTHS.get(t)
    if months is None:
        return None
    from dateutil.relativedelta import relativedelta
    raw = base_date + relativedelta(months=months)
    return modified_following_kr(raw)


def resolve_curve_maturity_dates(irs_curves: list[dict], base_date: date) -> list[dict]:
    """irsCurves 항목에 maturityDate가 없고 tenor 라벨이 있으면, base_date+tenor
    기준 실제 만기일(Modified Following, 한국 공휴일 반영)을 계산해 채워 넣는다.

    파일이 '만기' 컬럼 없이 테너/금리만 제공하는 경우에도(v5 포맷), 라벨 T(0.25,
    0.5 등 명목상 값) 대신 실제 날짜 기반 T를 쓸 수 있게 하기 위함 —
    bootstrap_zero_curve가 실제 만기 기준 분기 스케줄을 역산하므로 정확도가 더
    높다(1D/9M/18M/4Y/10Y 등에서 실측 최대 4일 차이, NPV 대사 정확도 약 16% 개선
    확인). maturityDate가 이미 있으면(파일이 직접 제공) 그 값을 그대로 우선 사용.
    """
    out = []
    for item in irs_curves:
        if item.get("maturityDate"):
            out.append(item)
            continue
        tenor = item.get("tenor")
        if tenor:
            mat = tenor_to_maturity_date(base_date, tenor)
            if mat is not None:
                item = {**item, "maturityDate": mat.isoformat()}
        out.append(item)
    return out


def build_bizday_schedule(
    base_date: date,
    sim_days: int,
) -> list[tuple[date, int, int]]:
    """한국 영업일(주말+공휴일 제외) 스케줄.
    Returns [(val_date, cal_day, dt_cal), ...]
      val_date : 영업일 날짜
      cal_day  : base_date 기준 누적 캘린더 일수 (충격 factor 인덱스용)
      dt_cal   : 직전 영업일 대비 경과 캘린더 일수 (월요일=3, 연휴 후=N, 기타=1)
    """
    needed_years = range(base_date.year, (base_date + timedelta(days=sim_days)).year + 2)
    try:
        kr_hols = _hols_lib.KR(years=needed_years)
    except Exception:
        kr_hols = _KR_HOLIDAYS
    schedule: list[tuple[date, int, int]] = []
    prev_cal = 0
    for cal_day in range(1, sim_days + 1):
        d = base_date + timedelta(days=cal_day)
        if d.weekday() >= 5 or d in kr_hols:
            continue
        schedule.append((d, cal_day, cal_day - prev_cal))
        prev_cal = cal_day
    return schedule


# ── 4가지 결과 산출 함수 ──────────────────────────────────────────────────────

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
) -> tuple[list[dict], dict, list[dict], list[dict], list[dict]]:
    """5-튜플 (chart_data, summary, settlement_events, daily_recon, funding_curve).

    funding_curve (s11 T4): 시뮬레이션 타임스텝별 조달금리/포지션 운용수익률/캐리 bp.
    chartData와 같은 영업일 스케줄(+day 0 앵커)로 정렬된다.

    skip_recon (s11 T3): 분포 밴드용 퍼센타일 런은 IRS 일별 대사표가 필요 없어
    그 루프(영업일당 커브 부트스트랩+12 범프)를 건너뛴다. 기본 False — 원본
    경로의 산출물은 변하지 않는다.
    """
    try:
        base_date = date.fromisoformat(base_date_str)
    except Exception:
        base_date = date.today()

    chart_data: list[dict] = []
    cumulative_bond_carry = 0.0   # 채권 캐리 + 만기 재투자 수익
    cumulative_irs_carry  = 0.0   # IRS 일별 캐리 누적
    break_even_day = -1
    is_broken_even = False

    # 만기 채권을 재투자 Cash Pool로 추적
    bond_positions = [p for p in positions if p.bondType != "swap"]
    irs_positions  = [p for p in positions if p.bondType == "swap"]

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
        """테너별 누적 충격 bp (계단식 1D/3M → 선형 소멸 at 1Y → ramp 1Y+)."""
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

    # 커스텀 경로 사전 처리 (웨이포인트 기반 factor 보간)
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
        rate = calc_dynamic_funding_rate(funding_rate, funding_events, cur_date)
        pos_rate = _weighted_position_rate(t, multiplier, cur_date)
        return {
            "day": t,
            "date": cur_date.isoformat(),
            "fundingRate": rate,        # 소수 (0.042 = 4.2%)
            "positionRate": pos_rate,   # 소수; 살아있는 채권 없으면 None
            "carryBp": None if pos_rate is None else round((pos_rate - rate) * 10000.0, 2),
        }

    funding_curve: list[dict] = []

    # Day 0 초기 항목 (모든 P&L = 0)
    chart_data.append({"day": 0, "mtmPnL": 0, "cumulativeCarry": 0, "swapPnL": 0, "totalPnL": 0,
                        "swapThetaPnL": 0, "swapValuationPnL": 0})
    funding_curve.append(_funding_row(0, base_date, _factor(0)))

    prev_cal        = 0
    prev_short_mult = _short_factor(0)
    for current_date, cal_day, dt_cal in _bizday_schedule:
        t = cal_day
        multiplier = _factor(t)
        short_mult  = _short_factor(t)
        active_rate = calc_dynamic_funding_rate(funding_rate, funding_events, current_date)

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
            # 장기(1Y+):  IRS FM은 항상 linear ramp(factor=day/sim_days) 사용
            #              채권 커스텀 경로(_factor)와 독립적 → IRS 쇼크 커브 × ramp 증분
            _bok_event_bp  = sum(e["bp"] for e in _short_evts if prev_cal < e["day"] <= t)
            _irs_ramp_step = dt_cal / max(sim_days, 1)  # 영업일 기간 ramp 증분 (월요일=3/sim_days)
            _KRD_PAIRS = [
                ("1D", 1/365), ("3M", 0.25), ("6M", 0.5),  ("9M", 0.75),
                ("1Y", 1.0),   ("1.5Y", 1.5), ("2Y", 2.0), ("3Y", 3.0),
                ("4Y", 4.0),   ("5Y", 5.0),  ("7Y", 7.0),  ("10Y", 10.0),
            ]
            _irs_1p = _irs_3p = _irs_bp = _irs_lp = 0.0  # PVBP 합산
            _irs_1d = _irs_3d = _irs_bd = _irs_ld = 0.0  # P&L 합산
            # BOK 이벤트 당일 shocked par 커브 (IRS는 linear ramp)
            _fac_irs = t / max(sim_days, 1)
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
        if bok_breakdown:
            entry["bokBreakdown"] = bok_breakdown
        chart_data.append(entry)
        funding_curve.append(_funding_row(t, current_date, multiplier))

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

    return chart_data, summary, irs_settlement_events, irs_daily_recon, funding_curve


# ── s11 T3: 분포(퍼센타일 팬) 밴드 ────────────────────────────────────────────
# 확률 가정 (REPORT_s11.md §3에 상세 문서화):
#   - 불확실성은 커브 "평행 레벨"에 대해서만 건다 (테너/크레딧 스프레드는
#     시나리오 값에 고정). 오프셋 Δp = z_p · σ_daily · √(영업일수).
#   - σ_daily 기본 2.0bp/영업일 (KRW 3Y 일변동 근사; 요청으로 조정 불가 — 상수).
#   - 각 밴드는 "사용자 시나리오 + 만기 Δp까지 선형 램프되는 평행 충격"의 실제
#     엔진 런이다. 만기 시점 분위수는 정확하고, 중간 시점은 만기 불확실성의
#     선형 보간이다 (√t 브리지가 아님 — 엔진의 자체 램프 의미론에 맞춤).
#   - 분위수 매핑은 코모노톤 근사: P&L 분위수 ≈ 금리 분위수 경로의 P&L.
#     비단조 북 대비 일자별 정렬로 밴드 순서(p5≤…≤p95)를 강제한다.
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
) -> dict:
    """totalPnL의 퍼센타일 팬 밴드. z=0 런은 기본 시나리오와 입력이 동일하므로
    base_chart를 그대로 재사용한다(p50 ≡ 기존 궤적 — 중앙값 일관성 보장).
    나머지 4개 분위수는 skip_recon=True 엔진 런이다."""
    try:
        _bd = date.fromisoformat(base_date_str[:10])
    except Exception:
        _bd = date.today()
    ranks = qe.biz_day_ranks(_bd, sim_days)
    n_biz = int(ranks[-1]) if ranks[-1] > 0 else max(sim_days, 1)
    sigma_t = _DIST_SIGMA_BP_DAILY * float(np.sqrt(n_biz))

    days = [int(row.get("day", 0)) for row in base_chart]
    runs: dict[int, dict[int, float]] = {
        50: {int(r.get("day", 0)): float(r.get("totalPnL", 0)) for r in base_chart}
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
        chart_p, *_rest = build_chart_data(
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
        )
        runs[pct] = {int(r.get("day", 0)): float(r.get("totalPnL", 0)) for r in chart_p}

    bands: list[dict] = []
    for d in days:
        # 일자별 정렬 배정: 코모노톤(단조) 북에서는 항등이고, 비단조 북에서도
        # p5≤p25≤p50≤p75≤p95 순서가 깨지지 않게 한다.
        vals = sorted(runs[p].get(d, 0.0) for p in _DIST_PERCENTILES)
        bands.append({
            "day": d,
            "p5": vals[0], "p25": vals[1], "p50": vals[2], "p75": vals[3], "p95": vals[4],
        })

    return {
        "sigmaBpDaily": _DIST_SIGMA_BP_DAILY,
        "sigmaTerminalBp": round(sigma_t, 4),
        "percentiles": list(_DIST_PERCENTILES),
        "method": "quantile-scenario",
        "bands": bands,
    }


def build_pvbp_sensitivity(positions: list[FrontendPosition]) -> list[dict]:
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


# ── 엔드포인트 본문 (source main.py의 simulate()) ────────────────────────────

def run_simulation(
    positions: list[FrontendPosition],
    shock_curves: FrontendShockCurves | None,
    daily_shock_curves: FrontendShockCurves | None,
    funding_rate: float,
    funding_events: list[dict],
    sim_days: int,
    shock_type: str,
    shock_mode: str,
    base_shock_bp: float,
    base_date: str,
    irs_curves: list[dict],
    custom_path: list[dict],
) -> dict:
    """POST /api/simulate 한 건의 전체 계산. 원본 엔드포인트 본문의 순서 그대로:
    커브 만기일 보정 → IRS 쇼크커브 명시적 빌드 → IRS 프라이싱 주입(enrich) →
    chartData/summary/정산이벤트/일별대사 → pvbpSensitivity → bookDailyPnLs."""
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
        positions = enrich_irs_pvbp(positions, irs_curves, base_date)
    except Exception:
        logger.exception("[CRITICAL] enrich_irs_pvbp 실패")
        raise

    funding_events = funding_events or (shock_curves.fundingEvents if shock_curves else [])

    chart_data, summary, irs_settlement_events, irs_daily_recon, funding_curve = build_chart_data(
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
    )
    pvbp_sensitivity = build_pvbp_sensitivity(positions)
    # bookDailyPnL: 당일 실제 금리변동만 반영. dailyShockCurves 없으면 shockCurves로 fallback
    daily_curves = daily_shock_curves if daily_shock_curves is not None else shock_curves
    book_daily_pnls = build_book_daily_pnl(positions, daily_curves, funding_rate)

    # s11 T3 — 분포 밴드는 **추가** 필드다: 실패해도 기존 응답은 그대로 나간다.
    distribution = None
    try:
        distribution = build_distribution_bands(
            chart_data,
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
        )
    except Exception:
        logger.exception("[s11 T3] 분포 밴드 계산 실패 — distribution=null로 응답")

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
    }
