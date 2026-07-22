"""
IRS / OIS 정밀 프라이싱 엔진 (Full Revaluation)
=================================================
방법론:
  1. Par Rate → Zero Rate 부트스트래핑 (Bootstrapping, ACT/365 연속복리)
  2. Forward Rate 계산
       IRS : 3M Simple Forward Rate  f(t1,t2) = (DF(t1)/DF(t2) - 1) / (t2-t1)
       OIS : DF 차분 공식  FloatPV = N * (DF(t_start) - DF(t_end))
  3. Full Revaluation NPV
       Fixed PV = Σ N * fixed_rate * freq * DF(t_i)
       Float PV = Σ N * f(t_{i-1}, t_i) * Δt * DF(t_i)
       NPV = direction * (Fixed PV - Float PV)
  4. PVBP 역산 (중앙차분법)
       PVBP = (NPV_down - NPV_up) / 2   [par_curve ±1bp 평행이동]
  5. KRD Map : 테너별 +1bp → ΔNPV
  6. Theta  : t+1일 NPV - t NPV  (커브 고정)

단위 규약:
  - couponRate, currentFloatRate : 퍼센트 (%) 단위  e.g. 3.50, 2.81
  - par_rates 입력              : 소수 (decimal) 단위  e.g. 0.035
  - PVBP / NPV 출력             : KRW 원화
"""

import numpy as np
from datetime import date as _date, timedelta
from typing import Callable, Optional
from scipy.optimize import brentq

try:
    import holidays as _hols_lib
    _KR_HOLIDAYS = _hols_lib.KR(years=range(2020, 2035))
except ImportError:
    _KR_HOLIDAYS = set()

# ── KRD 테너 정의 ─────────────────────────────────────────────────────────────
# 6Y/8Y/9Y 포함: par curve가 연 단위로 6Y~10Y 노드를 전부 개별로 갖고 있는 경우
# (이 프로젝트가 다루는 실제 파일들이 그렇다), 이 노드들을 건드리는 KRD 버킷이
# 없으면 그 구간 민감도가 통째로 누락되어 KRD 합계가 실제 평행이동 PVBP와
# 어긋난다(실측: 5~10Y 잔존 20종목에서 약 14%/340만원 차이, 6Y/8Y/9Y 추가 후
# 0.03% 이내로 일치). 5Y 미만 구간은 기존 그대로(1D/3M/6M/9M/1Y/1.5Y/2Y/3Y/4Y).
KRD_TENORS = [1 / 365, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0]
KRD_NAMES  = ["1D", "3M", "6M", "9M", "1Y", "1.5Y", "2Y", "3Y", "4Y", "5Y", "6Y", "7Y", "8Y", "9Y", "10Y"]

_SHORT_ANCHOR_TENORS = [1.0 / 365.0, 0.25]  # 1D, 3M


def _inject_short_anchors(
    par_rates: list[tuple[float, float]],
    short_rate: float,                   # decimal, e.g. 0.0281
) -> list[tuple[float, float]]:
    """
    irsCurves 앞단(1D, 3M) 앵커 노드 삽입.

    문제: irsCurves가 1Y부터 시작하면 0~1Y 구간 zero rate가 1Y로 flat 외삽됨.
         → 1D/3M KRD 버킷을 bump해도 1Y 노드와 동일한 커브를 bump하게 되어
           단기 리스크가 장기 버킷으로 bleed됨.
    해결: currentFloatRate를 1D·3M 앵커 금리로 삽입 →
         short-end를 별도 노드로 고정, KRD bleed 제거.

    중복 판정 허용오차(TOL_DUP): 실제 만기일 기반 커브 노드는 라벨(0.25 등)과
    최대 며칠(예: '3m' 노드가 91일=0.24932Y처럼 0.25Y 라벨과 약간 다름) 차이가 난다.
    예전에는 이 판정이 1e-6(사실상 0)이라 "거의 같은데 살짝 다른" 노드가 중복
    생성되었다: 예) 실제 3m 노드(0.24932)와 합성 3M 앵커(0.25)가 0.02Y도 안
    떨어진 채 둘 다 존재 → KRD 계산 시 "가장 가까운 노드" 로직이 합성 앵커를
    선택하는데, 합성 앵커가 실제 노드보다 살짝 뒤에 있어서 그 사이(예: 차기
    지급일 t1=0.2Y)의 현금흐름이 "3M" bump의 영향권 밖으로 밀려나 버리는
    버그가 있었다. 허용오차를 날짜 단위 괴리를 흡수할 만큼(0.02Y≈7일)
    넉넉하게 잡아 이미 존재하는 실제 노드를 재사용하도록 수정.
    """
    if not par_rates:
        return par_rates
    TOL_DUP = 0.02  # 약 7일 — 앵커 간격(0.25Y)보다 훨씬 작아 서로 다른 앵커를 합치지 않음
    # short_rate 미제공 시 가장 짧은 par rate 금리로 대체
    _r = short_rate if short_rate > 1e-6 else sorted(par_rates, key=lambda x: x[0])[0][1]
    existing_t = [p[0] for p in par_rates]
    result = list(par_rates)
    for anchor_t in _SHORT_ANCHOR_TENORS:
        if not any(abs(t - anchor_t) < TOL_DUP for t in existing_t):
            result.append((anchor_t, _r))
    return sorted(result, key=lambda x: x[0])


# ══════════════════════════════════════════════════════════════════════════════
# 0. 영업일 조정 헬퍼 (주말 전용 — 한국 공휴일 없음)
# ══════════════════════════════════════════════════════════════════════════════

def _is_kr_business_day(d: _date) -> bool:
    """d가 한국 영업일인지(주말 아님 + 공휴일 아님). _KR_HOLIDAYS는 모듈 로드 시
    2020~2034년치를 미리 만들어둔 것이라 매 호출마다 holidays.KR()을 새로 만드는
    비용이 없다 — 스케줄 생성 루프에서 대량 호출돼도 안전."""
    return d.weekday() < 5 and d not in _KR_HOLIDAYS


def _next_business_day(d: _date) -> _date:
    """d가 영업일(평일+한국 공휴일 아님)이 아니면 다음 영업일로 조정, 이미 영업일이면
    그대로. 스케줄 생성(ModFol)용 — '주말만 보는' 예전 버전은 실제 공휴일(추석/성탄절
    등)에 걸린 지급일을 못 미뤄서 실제 사내 스케줄과 하루 이상 어긋나는 문제가 있었다
    (실측 확인: 9/25가 추석인 트레이드에서 재현)."""
    nd = d
    while not _is_kr_business_day(nd):
        nd += timedelta(days=1)
    return nd


def _prev_business_day(d: _date) -> _date:
    """d가 영업일이 아니면 직전 영업일로 조정, 이미 영업일이면 그대로."""
    pd = d
    while not _is_kr_business_day(pd):
        pd -= timedelta(days=1)
    return pd


def biz_day_ranks(base_date: _date, n: int) -> np.ndarray:
    """base_date 기준 day=0..n 각 시점에서 '이미 지난 영업일 수(누적)'를 반환.

    시나리오 램프(예: 269일에 걸쳐 30bp)를 이 배열로 정규화하면, 주말/공휴일에는
    누적치가 늘지 않고 그대로 유지된다 — 캘린더 일수(day/N)로 나누면 주말에도
    금리가 계속 움직인 것처럼 계산되어, 월요일에 "토+일+월 3일치"가 한꺼번에
    반영되며 실제 P&L이 부풀어 보이는 문제가 있었다. 영업일 기준으로 나누면
    월요일도 "그냥 다음 영업일 하루치"만 반영되어 이 왜곡이 사라진다.
    """
    ranks = np.zeros(n + 1, dtype=np.int64)
    cnt = 0
    for day in range(1, n + 1):
        if _is_kr_business_day(base_date + timedelta(days=day)):
            cnt += 1
        ranks[day] = cnt
    return ranks


def next_kr_business_day(d: _date) -> _date:
    """d의 다음 한국 영업일(주말+공휴일 제외, d 자신은 제외) — '결제일(T+1)' 계산용.

    마켓 컨벤션: "N일자 NPV"를 요청받으면 실제로는 N일의 결제일(N의 다음
    영업일)을 평가일(val_date)로 잡아 재평가한 값을 "N일자 값"으로 보고한다
    (main.py의 next_kr_business_day와 동일 정의 — 여기 별도로 둔 이유는
    quant_engine.py가 simulate_irs_path_fm 내부 일별 루프에서 자체적으로
    이 변환을 적용해야 해서 main.py에 대한 의존성 없이 동작해야 하기 때문).
    """
    return _next_business_day(d + timedelta(days=1))


def _modfol_bd(d: _date) -> _date:
    """Modified Following 영업일 조정 (주말 전용).
    다음 영업일로 조정하되, 월경(Month-End Crossing)이면 직전 영업일로 조정.
    예: Feb 28(토) → Mar 2는 월경 → Feb 27(금) / May 31(일) → Jun 1은 월경 → May 29(금)
    """
    adj = _next_business_day(d)
    if adj.month != d.month:
        return _prev_business_day(d)
    return adj


def _bday_adj(t_years: float, sim_date: _date) -> float:
    """연수 t_years(sim_date 기준) → 영업일 조정 후 연수 반환"""
    cal = sim_date + timedelta(days=round(t_years * 365))
    adj = _next_business_day(cal)
    return (adj - sim_date).days / 365.0


def _subtract_months(d: _date, months: int) -> _date:
    """달력 개월 역산 (월말 초과분은 해당 월 말일로 클램프).
    예: Apr 13 - 3 → Jan 13  /  Mar 31 - 1 → Feb 28(29)
    timedelta(91) 근사(±1~2일 오차) 대비 정확한 분기 역산.
    """
    import calendar as _cal
    m = d.month - months
    y = d.year
    while m <= 0:
        m += 12
        y -= 1
    max_day = _cal.monthrange(y, m)[1]
    return _date(y, m, min(d.day, max_day))


# ══════════════════════════════════════════════════════════════════════════════
# 1. Zero Curve 부트스트래핑
# ══════════════════════════════════════════════════════════════════════════════

def bootstrap_zero_curve(par_rates: list[tuple[float, float]]) -> np.ndarray:
    """
    Par Rate (decimal) → Continuously Compounded Zero Rate 부트스트래핑
    (QuantLib PiecewiseYieldCurve 스타일 — 실제 마디점 기반 순차적 해찾기)

    알고리즘:
      T ≤ 3M : 단순이자 DF(T) = 1/(1 + c*T) → r = -ln(DF)/T  (폐쇄형, 단일지급 상품)
      T > 3M : 실제 만기 T에서 역산(backward)한 분기 지급 스케줄로 par swap 항등식을 풀어 DF(T) 확정.
                 1 = DF(T)·(1 + c·0.25) + c·Σ(accrual_i · DF(t_i))
               스케줄은 T에서 0.25씩 역산하며 만들고, T가 0.25의 정확한 배수가 아니면
               첫 구간(가장 오래된 지급일)에만 남는 단수(stub) 일수를 흡수시킨다.
               → 마디점 T가 정확한 격자(0.25 배수)가 아니어도 스케줄 자체가 T에 정확히
                 맞춰 재생성되므로, 이전의 "고정 격자 t_step += 0.25" 방식에서 발생하던
                 마디점-격자 불일치(예: T=1.50411인데 루프는 1.25에서 끊김) 문제가 없다.
               이 방정식은 DF(T)에 대해 선형이므로 폐쇄형으로 직접 풀며(QuantLib의
               Brent 해찾기와 수학적으로 동일한 해 — 1e-8 정밀도까지 일치 확인,
               단 폐쇄형이 약 10배 빠름), DF(T)가 비정상(≤0)일 때만 brentq로 안전망 처리.
               이미 확정된 노드(0..i-1)들 사이는 기존과 동일하게 zero rate 선형 보간/외삽.

    입력 : [(T_years, par_rate_decimal), ...]  오름차순
    출력 : np.ndarray shape (N,2)  → col0=T, col1=zero_rate
    """
    if not par_rates:
        # 커브 없음 → flat 3.5% fallback
        return np.array([[0.001, 0.035], [30.0, 0.035]])

    pts = sorted(par_rates, key=lambda x: x[0])
    zero_t: list[float] = []
    zero_r: list[float] = []

    SHORT_THRESHOLD = 0.25 * 1.04  # 기존 0.26과 동일한 임계값의 일반화

    def _df_interp(t: float) -> float:
        """이미 확정된 노드(zero_t, zero_r)까지 zero rate를 선형 보간/외삽 후 DF 환산
        (기존 부트스트랩의 _interp_zero와 동일한 방식 — log-linear on DF로 바꾸면
        오히려 정확도가 크게 떨어짐이 실측으로 확인됨. df() 최종 조회 단계의 보간법과는
        의도적으로 분리되어 있음)."""
        if not zero_t:
            return float(np.exp(-pts[0][1] * max(t, 1e-12)))
        r = float(np.interp(t, zero_t, zero_r, left=zero_r[0], right=zero_r[-1]))
        return float(np.exp(-r * max(t, 1e-12)))

    for T, c in pts:
        if T <= SHORT_THRESHOLD + 1e-9:
            # 단기(≤3M): 단순이자 DF(T) = 1/(1+c*T)  →  r = -ln(DF)/T
            df_T = 1.0 / (1.0 + c * T) if T > 1e-9 else 1.0
            r_T = float(-np.log(df_T) / T) if T > 1e-9 else c
        else:
            # 실제 만기 T에서 역산한 분기 스케줄 (T가 0.25 배수가 아니면 첫 구간이 stub)
            periods: list[float] = []
            t_cursor = T
            while t_cursor > 0.25 + 1e-9:
                periods.append(t_cursor)
                t_cursor = round(t_cursor - 0.25, 10)
            periods.append(t_cursor)  # 첫 stub 지급일 (0 < t_cursor <= 0.25)
            periods.sort()
            interim = periods[:-1]  # T 이전 지급일들
            accruals = [interim[0]] + [0.25] * (len(interim) - 1) if interim else []

            pv_interim = sum(a * _df_interp(t) for a, t in zip(accruals, interim))
            df_T = (1.0 - c * pv_interim) / (1.0 + c * 0.25)

            if df_T > 0:
                r_T = float(-np.log(df_T) / T)
            else:
                # 비정상(음수/0) DF인 극단적 커브 형태에 대한 안전망 — brentq로 재탐색
                def swap_eq(r_guess: float) -> float:
                    df_T_guess = float(np.exp(-r_guess * T))
                    return df_T_guess * (1.0 + c * 0.25) + c * pv_interim - 1.0
                try:
                    r_T = brentq(swap_eq, -0.10, 1.00, xtol=1e-12)
                except ValueError:
                    r_T = float(-np.log(1e-12) / T)

        zero_t.append(T)
        zero_r.append(r_T)

    return np.column_stack([zero_t, zero_r])


def df(t: float, zc: np.ndarray) -> float:
    """Discount Factor: Log-linear 보간 (ln DF = -r·T 를 선형 보간 → DF 로그선형)"""
    if t <= 0:
        return 1.0
    if zc is None or len(zc) == 0:
        return float(np.exp(-0.035 * t))
    # 각 노드의 ln(DF) = -r*T 를 계산 후 선형 보간 → log-linear on DF
    log_dfs = -(zc[:, 1] * zc[:, 0])          # -r·T at each node
    log_df_t = float(np.interp(t, zc[:, 0], log_dfs,
                                left=float(log_dfs[0]),
                                right=float(log_dfs[-1])))
    return float(np.exp(log_df_t))


def df_linear_rate(t: float, zc: np.ndarray) -> float:
    """Discount Factor: zero rate를 선형보간(linear-on-rate) 후 DF 환산.

    df()의 log-linear-on-DF와 달리, T가 극단적으로 작은 노드(예: 1D 앙커
    T=1/365)에서도 ln(DF)=-r*T가 T→0으로 인해 소멸하지 않고 rate 자체의
    변화가 그대로 보간에 반영된다. KRD/PVBP 테너별 버킷 분해(compute_irs_krd_map)
    전용 — 단기 앙커 bump가 인접 현금흐름에 기여하는 몫이 log-linear-DF에서는
    T가 작을수록 사실상 0으로 씻겨나가(DF(T)->1 as T->0) 그 몫이 전부 다음
    버킷으로 넘어가버리는 문제를 해결하기 위해 도입. 전체 KRD 합계(=병렬 평행이동
    민감도)는 두 보간법 사이에 사실상 차이가 없음(실측 확인) — 버킷 간 "배분"만
    바뀐다. 절대 NPV(compute_irs_npv 기본 경로)에는 영향 없도록 별도 함수로 분리.
    """
    if t <= 0:
        return 1.0
    if zc is None or len(zc) == 0:
        return float(np.exp(-0.035 * t))
    r = float(np.interp(t, zc[:, 0], zc[:, 1], left=float(zc[0, 1]), right=float(zc[-1, 1])))
    return float(np.exp(-r * t))


def zero_rate(t: float, zc: np.ndarray) -> float:
    """Log-linear DF 보간에서 역산한 연속복리 제로금리 (보고/감사용)"""
    if zc is None or len(zc) == 0:
        return 0.035
    if t <= 1e-12:
        return float(zc[0, 1])
    return float(-np.log(max(df(t, zc), 1e-12)) / t)


def forward_rate_simple(
    t1: float, t2: float, zc: np.ndarray,
    df_fn: Callable[[float, np.ndarray], float] = df_linear_rate,
) -> float:
    """
    Simple Forward Rate for period [t1, t2]:
        f(t1, t2) = (DF(t1) / DF(t2) - 1) / (t2 - t1)

    의미: 미래 구간 [t1, t2]에서 예상되는 CD / IRS 픽싱 금리 (연율, decimal)
    """
    if t2 <= t1 + 1e-10:
        return zero_rate((t1 + t2) / 2, zc)
    df1 = df_fn(t1, zc)
    df2 = df_fn(t2, zc)
    if df2 < 1e-12:
        return 0.0
    return (df1 / df2 - 1.0) / (t2 - t1)


# ══════════════════════════════════════════════════════════════════════════════
# 2. IRS / OIS Full Revaluation NPV
# ══════════════════════════════════════════════════════════════════════════════

def _irs_npv_from_schedule(
    notional: float,
    fixed_rate: float,       # 소수 단위 (e.g. 0.035)
    direction: int,
    is_ois: bool,
    float_rate0: float,      # 소수 단위
    t_next: float,
    current_stub_accrual: float,
    future_pays: list[float],
    future_accruals: list[float],
    zc: np.ndarray,
    df_fn: Callable[[float, np.ndarray], float],
) -> float:
    """확정된 스케줄(t_next/current_stub_accrual/future_pays/future_accruals)로부터
    Fixed/Float Leg PV를 계산 — 스케줄을 어떻게 확정했는지(실제 스케줄 직접 사용 vs
    재구성 근사)와 무관하게 공유되는 순수 프라이싱 로직."""
    fixed_pv = 0.0
    fixed_pv += notional * fixed_rate * current_stub_accrual * df_fn(t_next, zc)
    for pay_t, accrual in zip(future_pays, future_accruals):
        fixed_pv += notional * fixed_rate * accrual * df_fn(pay_t, zc)

    float_pv = 0.0
    float_pv += notional * float_rate0 * current_stub_accrual * df_fn(t_next, zc)

    if is_ois:
        t_s = t_next
        for t_e in future_pays:
            float_pv += notional * (df_fn(t_s, zc) - df_fn(t_e, zc))
            t_s = t_e
    else:
        t_s = t_next
        for t_e in future_pays:
            fwd = forward_rate_simple(t_s, t_e, zc, df_fn=df_fn)
            dt  = t_e - t_s
            float_pv += notional * fwd * dt * df_fn(t_e, zc)
            t_s = t_e

    # direction: +1 = receive fixed  →  NPV = Fixed - Float
    #            -1 = pay   fixed  →  NPV = Float - Fixed
    return direction * (fixed_pv - float_pv)


def compute_irs_npv(
    notional: float,
    fixed_rate_pct: float,          # % 단위  e.g. 3.50
    direction: int,                  # +1 = receive fixed,  -1 = pay fixed
    t_maturity: float,               # 만기까지 연수 (ACT/365)
    t_next_payment: float,           # 다음 변동 레그 지급까지 연수
    current_float_rate_pct: float,   # 현재 구간 확정 변동금리 (% 단위)
    sector: str,                     # 'IRS' | 'OIS'
    zc: np.ndarray,
    fixed_freq: float = 0.25,        # 고정 쿠폰 지급 주기 (분기 = 0.25년)
    float_freq: float = 0.25,        # 변동 레그 리셋 주기
    sim_date: Optional[_date] = None, # 영업일 조정용 기준일 (None이면 조정 생략)
    prev_pay_date: Optional[_date] = None, # 직전 실제 지급일 (Continuity 보장용)
    df_fn: Callable[[float, np.ndarray], float] = df_linear_rate,  # 할인 보간법 (기본: linear-on-rate)
    pay_dates: Optional[list[_date]] = None,   # 실제 전체 지급일 스케줄 (IRS_Trade.pay_dates)
    accruals: Optional[list[float]] = None,    # 실제 전체 ACT/365 어큐럴 (IRS_Trade.accruals)
    as_of_date: Optional[_date] = None,        # 현금흐름 포함여부 판정 기준일 (기본값: sim_date)
) -> float:
    """
    Full Revaluation NPV

    Fixed Leg PV = Σ N * (fixedRate/100) * fixed_freq * DF(t_i)
    Float Leg PV (IRS) :
        현재 구간  → N * (currentFloat/100) * float_freq * DF(t_next)  [확정 픽싱]
                     └ accrual_tau = float_freq (고정),  할인만 t_next 사용
        미래 구간  → Σ N * f_simple(t_start, t_end) * Δt * DF(t_end)  [포워드 픽싱]
    Float Leg PV (OIS) :
        현재 구간  → N * (currentFloat/100) * float_freq * DF(t_next)
        미래 구간  → Σ N * (DF(t_start) - DF(t_end))                  [DF 차분 공식]

    NPV = direction * (Fixed PV - Float PV)

    pay_dates/accruals (선택):
      호출측이 실제 ISDA 스케줄(IRS_Trade.pay_dates/accruals — Forward Generation +
      EOM + Modified Following + 만기 스냅 전부 반영된 정답)을 이미 알고 있다면
      전달할 것. 전달 시 아래의 t_maturity/t_next_payment 기반 날짜 "재구성"을
      완전히 건너뛰고 이 실제 스케줄을 그대로 사용하므로 드리프트가 원천적으로
      없다 (IRS_Trade.compute_npv과 동일 결과). 재구성 로직은 실제 시작일을 모를 때
      (예: t_maturity/t_next_payment 두 float만 있는 프론트엔드 포지션)의 근사치일
      뿐이며, 시작일의 day-of-month가 만기일과 다르면(예: 매달 16일 지급인데 만기가
      18일인 경우) 마지막 구간 스텁을 잘못 복원할 수 있다.

    as_of_date (선택, 주의 — 함부로 sim_date와 다르게 주지 말 것):
      "이 현금흐름이 아직 안 지나갔는가"를 판정하는 기준일. 미지정 시 sim_date와
      동일하게 동작(기본/권장). 처음에는 "sim_date를 결제일(T+1)로 늦추면
      평가일-결제일 사이에 걸리는 이자교환일이 pd > sim_date에서 등호로 걸려
      누락되니, as_of_date=평가일로 따로 줘서 살려야 한다"고 생각했는데 —
      이건 틀렸다. KRX IRS 청산제도 설명자료(2019) 35p "일일정산차금" 항목에
      "결제일이 이자교환일인 경우: 결제일 기준 PV산출시 해당일의 이자교환액은
      제외(이자락 조치)하고 PV 및 NPV산출"이라고 명시되어 있다 — 즉 결제일에
      정확히 걸리는 이자교환액은 (평가일 기준에서 "당일 걸리면 제외"하는 것과
      동일한 원칙으로) 의도적으로 제외해야 하는 것이 맞다. as_of_date를 sim_date와
      다르게 주면 이 규정과 어긋나는 결과가 나오므로, 정말 다른 판정 기준일이
      필요한 별개의 상황이 아니라면 이 파라미터는 건드리지 말 것.
    """
    fixed_rate  = fixed_rate_pct  / 100.0
    float_rate0 = current_float_rate_pct / 100.0
    is_ois      = (sector == "OIS")
    _cutoff     = as_of_date if as_of_date is not None else sim_date

    if pay_dates is not None and accruals is not None and sim_date is not None:
        # ── 실제 스케줄 직접 사용 (IRS_Trade.compute_npv과 동일 필터링) ──────────
        # 날짜 재구성을 완전히 건너뛰므로, 시작일 day-of-month가 만기일과 달라
        # 마지막 구간이 스텁인 경우(예: 매달 16일 지급, 만기는 18일)도 정확하다.
        rem = [i for i, pd in enumerate(pay_dates) if pd > _cutoff]
        if not rem:
            return 0.0
        first_i = rem[0]
        t_next = max((pay_dates[first_i] - sim_date).days / 365.0, 1 / 365)
        current_stub_accrual = accruals[first_i]
        future_pays = [(pay_dates[i] - sim_date).days / 365.0 for i in rem[1:]]
        future_accruals = [accruals[i] for i in rem[1:]]
        return _irs_npv_from_schedule(
            notional, fixed_rate, direction, is_ois, float_rate0,
            t_next, current_stub_accrual, future_pays, future_accruals, zc, df_fn,
        )

    t_next = max(t_next_payment, 1 / 365)  # 최소 1일

    if sim_date is not None:
        # ── 지급 스케줄 생성 (실제 달력 개월 기준 역산) ─────────────────────────
        # ① 차기지급일 달력 날짜 (nextFixingDate 기준, 이미 영업일 적용됨)
        next_pay_adj = _next_business_day(
            sim_date + timedelta(days=round(t_next * 365))
        )
        # ② 이전지급일 추정: 차기지급일에서 freq_months 개월 정확히 역산 → 영업일 조정
        #    timedelta(91일) 근사(±1~2일 오차) 대신 달력 개월 역산으로 정확도 향상
        #    예: Apr 13 - 3개월 = Jan 13 (정확), Apr 13 - 91일 = Jan 12 (±1일 오차)
        freq_months = max(1, round(float_freq * 12))   # 0.25Y → 3개월
        if prev_pay_date is not None:
            # Continuity 보장: simulate_irs_path_fm이 추적한 실제 달력 지급일 직접 사용.
            # _subtract_months 역산은 forward schedule의 영업일 조정과 달라
            # current_stub 어큐럴이 매번 재계산될 때 2일 오차가 발생하므로 금지.
            prev_pay_adj = prev_pay_date
        else:
            # sim_date 없이 단독 호출 시 폴백 (외부 호출, KRD 계산 등)
            prev_pay_adj = _modfol_bd(
                _subtract_months(next_pay_adj, freq_months)
            )
        current_stub_accrual = (next_pay_adj - prev_pay_adj).days / 365.0

        # ③ 미래 지급일: 만기일을 "단 한 번만" 날짜로 환산한 뒤, 거기서부터 실제
        #    달력 개월(freq_months) 단위로 역산하며 생성 (IRS_Trade._build_schedule과
        #    동일한 원리의 backward 버전).
        #    기존 방식(t_maturity에서 명목상 fixed_freq=0.25년씩 반복 차감 후 날짜로
        #    재환산)은 실제 분기 길이가 91.25일이 아니라 89~92일 사이로 들쭉날쭉하기
        #    때문에, 차감을 반복할수록 소수점 오차가 누적되어 반올림 시 종종 하루가
        #    밀리는 버그가 있었다 (검증: 410종목 중 337건, 전체 지급일의 52.6%가
        #    실제 스케줄과 하루 어긋남). 만기일 환산은 1회만 일어나므로 드리프트가
        #    없고, 그 이후는 전부 실제 달력 개월 연산이라 정확하다.
        fixed_freq_months = max(1, round(fixed_freq * 12))
        maturity_date_actual = sim_date + timedelta(days=round(t_maturity * 365))

        raw_dates: list[_date] = [maturity_date_actual]
        k = 1
        while True:
            cand = _subtract_months(maturity_date_actual, fixed_freq_months * k)
            if cand <= next_pay_adj:
                break
            raw_dates.append(cand)
            k += 1
        raw_dates.reverse()  # 오름차순(가장 이른 지급일부터) 정렬

        pay_dates_adj = [_modfol_bd(d) for d in raw_dates]
        future_pays = [(d - sim_date).days / 365.0 for d in pay_dates_adj]

        # ④ 미래 쿠폰 실제 적립 일수: 인접 지급일 간 달력 일수 / 365
        prev_date = next_pay_adj
        future_accruals: list[float] = []
        for adj_date in pay_dates_adj:
            future_accruals.append((adj_date - prev_date).days / 365.0)
            prev_date = adj_date
    else:
        # sim_date 없음: 달력 정보가 없어 명목상 fixed_freq 균등 스텝으로 폴백
        n_periods = round((t_maturity - t_next) / fixed_freq)
        future_pays      = [round(t_maturity - k * fixed_freq, 10)
                            for k in range(n_periods - 1, -1, -1)]
        current_stub_accrual = float_freq
        future_accruals  = [fixed_freq] * len(future_pays)

    return _irs_npv_from_schedule(
        notional, fixed_rate, direction, is_ois, float_rate0,
        t_next, current_stub_accrual, future_pays, future_accruals, zc, df_fn,
    )


# ══════════════════════════════════════════════════════════════════════════════
# 3. PVBP 역산 (중앙차분법, Central Difference)
# ══════════════════════════════════════════════════════════════════════════════

def resolve_current_float_rate(
    pay_dates: list[_date],
    start_date: _date,
    val_date: _date,
    settle_date: _date,
    cutoff_date: _date,
    par_rates: list[tuple[float, float]],
    file_float_rate_pct: float,
) -> float:
    """결제일/평가일 기준 NPV 계산 시 실제 사용할 current_float_rate_pct 결정.

    "현재 스텁"(cutoff_date 이후 첫 지급일) 판정 규칙(pd > cutoff_date)에 따라,
    그 스텁의 리셋일(직전 지급일, 없으면 시작일 — 여기선 pay_dates가 이미 미래
    지급일만 필터링되어 들어온다고 가정하지 않고 전체 스케줄을 받아 자체 필터링)이
    [평가일, 결제일] 구간에 걸리면, 그 구간은 오늘/내일 사이에 새로 픽싱된 것이다.

    파일/프론트에서 넘어오는 '변동쿠폰'은 조회 시점 기준 '아직 결제 안 된 직전
    구간'의 확정값이므로, 리셋이 막 지나간 새 구간에는 옛 금리가 아니라 리셋일
    기준 3M par rate(직전 영업일 CD91 픽싱에 해당)를 써야 한다. KRX IRS 청산제도
    설명자료(2019) 35p "일일정산차금 — 결제일이 이자교환일인 경우 이자락 처리"
    규정과 결합해서 발견된 문제 — 이 리픽싱을 안 하면 해당 종목 NPV가 사내 대비
    최대 2%p 이상 벌어짐(실측, 419 포트폴리오 중 6/22·6/24 지급 5종목에서 확인).
    """
    rem = [pd for pd in pay_dates if pd > cutoff_date]
    if not rem:
        return file_float_rate_pct
    first_pay = rem[0]
    idx = pay_dates.index(first_pay)
    reset_date = pay_dates[idx - 1] if idx > 0 else start_date
    if val_date <= reset_date <= settle_date:
        closest = min(par_rates, key=lambda tr: abs(tr[0] - 0.25))
        return closest[1] * 100.0
    return file_float_rate_pct


def compute_irs_pvbp(
    par_rates: list[tuple[float, float]],
    notional: float,
    fixed_rate_pct: float,
    direction: int,
    t_maturity: float,
    t_next_payment: float,
    current_float_rate_pct: float,
    sector: str,
    fixed_freq: float = 0.25,
    float_freq: float = 0.25,
    sim_date: Optional[_date] = None,
    prev_pay_date: Optional[_date] = None,
    df_fn: Callable[[float, np.ndarray], float] = df_linear_rate,
    pay_dates: Optional[list[_date]] = None,
    accruals: Optional[list[float]] = None,
) -> float:
    """
    PVBP = NPV(curve + 1bp) − NPV(base_curve)

    전진차분(Forward Difference) 방식:
      direction은 compute_irs_npv 내부에서 단 1회만 적용됨 (이중반전 없음).

    Float 픽싱 무결성:
      첫 번째 변동 현금흐름 금액(notional * currentFloat * Δt)은 커브와 무관하게 고정.
      커브 범프 시 DF(t_next)만 변하고 픽싱 금액은 불변 → 할인 리스크만 포안.

    부호 규약 (DV01 현업 관행):
      Receive-Fixed → 양수  (Long Bond과 동일)
      Pay-Fixed     → 음수  (Short Bond과 동일)

    시뮬레이션 공식:  MTM += pvbp * (-shock_bp)  (main.py)

    sim_date/prev_pay_date/df_fn/pay_dates/accruals (선택):
      compute_irs_krd_map과 동일한 파라미터 — 결제일(T+1) 기준 할인 + linear-on-rate
      보간("병행" 방법론) 및 실제 스케줄 직접 사용을 PVBP 총합 계산에도 동일하게
      적용하고 싶을 때 전달. 미전달 시 기존 동작(평가일 기준, log-linear-DF, 날짜
      재구성)과 100% 동일.
    """
    SHIFT = 0.0001  # 1bp = 0.01%

    # 단기 앙커(1D, 3M) 삽입 — KRD bleed 방지 및 short-end 할인 리스크 정확화
    short_r      = current_float_rate_pct / 100.0
    par_anchored = _inject_short_anchors(par_rates, short_r)

    # Base NPV (원본 커브)
    zc_base  = bootstrap_zero_curve(par_anchored)
    npv_base = compute_irs_npv(
        notional, fixed_rate_pct, direction, t_maturity,
        t_next_payment, current_float_rate_pct, sector, zc_base,
        fixed_freq, float_freq, sim_date=sim_date, prev_pay_date=prev_pay_date,
        df_fn=df_fn, pay_dates=pay_dates, accruals=accruals,
    )

    # +1bp 시프틸 NPV — 앙커 노드 포함 전체 평행이동
    par_up  = [(t, r + SHIFT) for t, r in par_anchored]
    zc_up   = bootstrap_zero_curve(par_up)
    npv_up  = compute_irs_npv(
        notional, fixed_rate_pct, direction, t_maturity,
        t_next_payment, current_float_rate_pct, sector, zc_up,
        fixed_freq, float_freq, sim_date=sim_date, prev_pay_date=prev_pay_date,
        df_fn=df_fn, pay_dates=pay_dates, accruals=accruals,
    )

    # DV01 = -(ΔNPV per +1bp)  현업 관행
    # Receive-Fixed: npv_up < npv_base → -(음수) = 양수 ✓ (Long Bond)
    # Pay-Fixed    : npv_up > npv_base → -(양수) = 음수 ✓ (Short Bond)
    return -(npv_up - npv_base)


# ══════════════════════════════════════════════════════════════════════════════
# 4. KRD Map (테너별 1bp 이동 → ΔNPV)
# ══════════════════════════════════════════════════════════════════════════════

def compute_irs_krd_map(
    par_rates: list[tuple[float, float]],
    notional: float,
    fixed_rate_pct: float,
    direction: int,
    t_maturity: float,
    t_next_payment: float,
    current_float_rate_pct: float,
    sector: str,
    fixed_freq: float = 0.25,
    float_freq: float = 0.25,
    sim_date: Optional[_date] = None,
    prev_pay_date: Optional[_date] = None,
    pay_dates: Optional[list[_date]] = None,
    accruals: Optional[list[float]] = None,
) -> dict[str, float]:
    """
    각 KRD 테너 노드: 해당 par rate +1bp 이동 → ΔNPV (재부트스트래핑 후 재평가)

    단기 앙커 포함 Bumping:
      1D KRD → 1/365년 앙커 노드를 1bp bump → DF(t_next) 변화 →
               첫 픽싱 현금흐름의 할인리스크를 1D 버킷에 정확 포안.
      3M KRD → 0.25년 앙커 노드를 1bp bump → 3M~6M 구간 할인리스크.
      앙커 없이 bump 시 단기 리스크가 더 련 장기 버킷으로 bleed → 해결됨.

    유효 상한 (effective_upper):
      t_maturity 이상의 첫 번째 par rate 노드까지만 KRD 산출.
      예) t_maturity=4.98Y, 5Y 노드 존재 → z(4.75)/z(4.98)이 z(5Y)에 보간 의존
          → 5Y KRD 포함.

    prev_pay_date (선택):
      현재 스텁 구간의 실제 이전 지급일(=거래 시작일 또는 그 이전 지급일).
      미전달 시 compute_irs_npv 내부에서 "차기지급일에서 3개월 역산"으로 근사하는데,
      이 근사는 거래의 첫 쿠폰 구간(시작일이 정확히 3개월 전이 아닌 경우)에서
      실제 스텁 일수와 어긋나 accrual이 틀릴 수 있다. 호출측이 실제 시작일/이전
      지급일을 알고 있다면 반드시 전달할 것.

    pay_dates/accruals (선택, 가장 정확):
      IRS_Trade.pay_dates/accruals(실제 ISDA 스케줄)을 그대로 전달하면
      compute_irs_npv가 날짜 재구성을 완전히 건너뛴다 — prev_pay_date로도 못 잡는
      "만기 근처 마지막 구간 스텁"(시작일 day-of-month ≠ 만기일 day-of-month)까지
      정확해진다. 가능하면 prev_pay_date 대신 이쪽을 우선 사용할 것.
    """
    short_r      = current_float_rate_pct / 100.0
    par_anchored = _inject_short_anchors(par_rates, short_r)

    zc_base  = bootstrap_zero_curve(par_anchored)
    npv_base = compute_irs_npv(
        notional, fixed_rate_pct, direction, t_maturity,
        t_next_payment, current_float_rate_pct, sector, zc_base,
        fixed_freq, float_freq, sim_date=sim_date, prev_pay_date=prev_pay_date,
        df_fn=df_linear_rate, pay_dates=pay_dates, accruals=accruals,
    )

    par_arr = sorted(par_anchored, key=lambda x: x[0])
    avail_t = [p[0] for p in par_arr]
    krd: dict[str, float] = {name: 0.0 for name in KRD_NAMES}

    if not avail_t:
        return krd

    # 유효 상한: t_maturity 이상의 첫 번째 par rate 노드 (앙커 포함)
    effective_upper = next(
        (t for t in avail_t if t >= t_maturity - 1e-9),
        avail_t[-1] if avail_t else t_maturity,
    )

    # KRD_TENORS는 이상적 라벨(0.25/0.5/0.75/1.0/1.5/…)인 반면, effective_upper는
    # 실제 만기일 기반 커브 노드(예: '1y' 노드가 364일=0.99726Y)일 수 있어 최대 며칠
    # 정도 어긋난다. 허용오차를 1e-9(사실상 0)로 두면 라벨=1.0인 KRD 버킷이
    # effective_upper=0.99726보다 "크다"고 판정되어 통째로 스킵되고, 그 여파로
    # 그 뒤의 모든 장기 버킷까지 연쇄적으로 스킵되는 회귀가 발생한다. 실제 날짜와
    # 라벨 사이에 벌어질 수 있는 최대 간극(최대 몇 영업일 수준)보다 넉넉하고,
    # KRD_TENORS 최소 간격(0.25Y)보다는 작은 허용오차로 교체.
    BUCKET_TOL = 0.05  # 약 18일 — 실제 날짜/라벨 괴리를 흡수하되 인접 버킷과는 안 겹침
    for t_key, name in zip(KRD_TENORS, KRD_NAMES):
        if t_key > effective_upper + BUCKET_TOL:
            continue  # effective_upper 초과: 만기 내 zero curve에 무관
        # 가장 가까운 par rate 노드 선택
        # (1D/3M 앙커 포함으로 단기 KRD가 정확하게 해당 버킷에 포안됨)
        closest = min(avail_t, key=lambda x: abs(x - t_key))
        shifted = [(t, r + 0.0001 if abs(t - closest) < 1e-9 else r) for t, r in par_arr]
        zc_s    = bootstrap_zero_curve(shifted)
        npv_s   = compute_irs_npv(
            notional, fixed_rate_pct, direction, t_maturity,
            t_next_payment, current_float_rate_pct, sector, zc_s,
            fixed_freq, float_freq, sim_date=sim_date, prev_pay_date=prev_pay_date,
            df_fn=df_linear_rate, pay_dates=pay_dates, accruals=accruals,
        )
        krd[name] = -(npv_s - npv_base)  # DV01 관행

    return krd


# ══════════════════════════════════════════════════════════════════════════════
# 4b. 일별 KRD 최적화 — 배치 DF LUT + 포트폴리오 합산
# ══════════════════════════════════════════════════════════════════════════════

def build_bumped_curves(
    par_anchored: list[tuple[float, float]],
) -> list[np.ndarray]:
    """
    KRD_TENORS(len(KRD_TENORS)개)에 대응하는 +1bp 범프 제로 커브를 사전 빌드.
    일당 1회 호출 → 종목 루프 내 재부트스트래핑 완전 제거.
    Returns list[np.ndarray] len=len(KRD_TENORS), 각 원소 shape (N,2).
    """
    par_arr = sorted(par_anchored, key=lambda x: x[0])
    avail_t = [p[0] for p in par_arr]
    result: list[np.ndarray] = []
    for t_key in KRD_TENORS:
        closest = min(avail_t, key=lambda x: abs(x - t_key))
        shifted = [(t, r + 0.0001 if abs(t - closest) < 1e-9 else r) for t, r in par_arr]
        result.append(bootstrap_zero_curve(shifted))
    return result


def portfolio_krd_day(
    pos_trades: "list[tuple[IRS_Trade, float]]",
    val_date: _date,
    zc_base: np.ndarray,
    zc_bumped: "list[np.ndarray]",
) -> "dict[str, float]":
    """
    포트폴리오 전체 당일 KRD 합산.

    최적화 전략:
      1. 모든 활성 포지션의 지급일을 한 번에 수집 → 고유 t_payment 집합
      2. base + len(KRD_TENORS) bumped 커브의 DF를 numpy 배치로 일괄 계산
      3. 종목당 df_matrix 슬라이싱 → fixed_pv = N·fr·(acc @ df_mat.T) 벡터화
         forward_pv도 행렬 연산으로 전체 커브 동시 처리
         → Python 루프를 종목 루프 1단계만 남김 (np.interp 완전 제거)
    """
    _DT = 1.0 / 365.0
    _N_CURVES = 1 + len(zc_bumped)  # base + KRD_TENORS 개수만큼의 bumped 커브

    # ── Step 1: 활성 포지션 필터링 + 고유 지급일 수집 ──────────────────────────
    _unique_t: set[float] = set()
    _active: list[tuple[IRS_Trade, list[int], np.ndarray, float]] = []
    for trade, flt in pos_trades:
        if trade is None or val_date >= trade.maturity_date:
            continue
        rem_idx = [i for i, pd in enumerate(trade.pay_dates) if pd > val_date]
        if not rem_idx:
            continue
        t_vals = np.array([(trade.pay_dates[i] - val_date).days / 365.0 for i in rem_idx])
        _unique_t.update(t_vals.tolist())
        _active.append((trade, rem_idx, t_vals, flt))

    if not _active:
        return {name: 0.0 for name in KRD_NAMES}

    t_sorted = np.array(sorted(_unique_t), dtype=float)
    _U = len(t_sorted)

    # ── Step 2: 13개 커브 × U 고유 날짜의 DF 행렬 배치 계산 ─────────────────
    # df_mat shape: (13, U) — 행: 커브, 열: 고유 t_payment
    # linear-on-rate 보간(df_linear_rate와 동일) 사용: log-linear-on-DF는
    # 1D 앙커(T=1/365)처럼 극단적으로 짧은 노드에서 ln(DF)=-r*T가 T→0으로
    # 소멸해 그 노드의 bump가 인접 현금흐름에 거의 반영되지 않는 문제가 있다
    # (KRD 버킷 배분이 다음 버킷으로 씻겨나감). compute_irs_krd_map과 동일한
    # 보간법으로 맞춰 단발 계산/일별 배치 계산 간 KRD 배분이 일관되도록 함.
    def _r_vec(zc: np.ndarray) -> np.ndarray:
        return np.interp(t_sorted, zc[:, 0], zc[:, 1],
                          left=float(zc[0, 1]), right=float(zc[-1, 1]))

    r_rows = np.empty((_N_CURVES, _U), dtype=float)
    r_rows[0] = _r_vec(zc_base)
    for k, zc in enumerate(zc_bumped):
        r_rows[k + 1] = _r_vec(zc)
    df_mat = np.exp(-r_rows * t_sorted[np.newaxis, :])   # shape (13, U)

    # t → col index (정렬된 배열에서 np.searchsorted로 O(log U))
    def _col_idx(t_vals_arr: np.ndarray) -> np.ndarray:
        return np.searchsorted(t_sorted, t_vals_arr)

    # ── Step 3: 종목별 NPV 벡터화 (전체 커브 동시 처리) → KRD 차분 합산 ────────
    krd_arr = np.zeros(len(KRD_NAMES), dtype=float)   # 포트폴리오 KRD 누적

    for trade, rem_idx, t_vals, flt in _active:
        n = len(rem_idx)
        cols = _col_idx(t_vals)                        # 각 지급일의 df_mat 열 인덱스
        df_sub = df_mat[:, cols]                       # shape (13, n)

        accruals = np.array([trade.accruals[i] for i in rem_idx])  # shape (n,)
        fr   = trade.fixed_rate_pct / 100.0
        flt0 = flt / 100.0
        N    = trade.notional

        # Fixed PV: N·fr·(acc · df_sub.T) → acc: (n,), df_sub.T: (n,13) → (13,)
        fixed_pvs = N * fr * (accruals @ df_sub.T)    # shape (13,)

        # Float PV — 스텁: N·flt·acc[0]·df[:,0]
        float_pvs = N * flt0 * accruals[0] * df_sub[:, 0]  # shape (13,)

        # Float PV — 포워드 기간: 행렬 연산
        if n > 1:
            df_s = df_sub[:, :-1]                      # (13, n-1) — t_{j-1}
            df_e = df_sub[:, 1:]                       # (13, n-1) — t_j
            dts  = np.maximum(t_vals[1:] - t_vals[:-1], _DT)  # (n-1,)
            # fwd[k,j] = (df_s[k,j] / df_e[k,j] - 1) / dt[j]  → shape (13, n-1)
            fwd_mat = (df_s / np.maximum(df_e, 1e-12) - 1.0) / dts
            float_pvs += N * (fwd_mat * accruals[1:] * df_e).sum(axis=1)  # (13,)

        # direction 부호 적용
        npv_vec = float(trade.direction) * (fixed_pvs - float_pvs)  # shape (13,)

        # KRD[k] = -(npv_bump[k] - npv_base)  →  krd_arr = -(npv_vec[1:] - npv_vec[0])
        krd_arr -= (npv_vec[1:] - npv_vec[0])

    return {name: float(krd_arr[k]) for k, name in enumerate(KRD_NAMES)}


# ══════════════════════════════════════════════════════════════════════════════
# 5. Theta (시간가치) 계산
# ══════════════════════════════════════════════════════════════════════════════

def compute_irs_theta(
    par_rates: list[tuple[float, float]],
    notional: float,
    fixed_rate_pct: float,
    direction: int,
    t_maturity: float,
    t_next_payment: float,
    current_float_rate_pct: float,
    sector: str,
    fixed_freq: float = 0.25,
    float_freq: float = 0.25,
    base_date: Optional[_date] = None,
    df_fn: Callable[[float, np.ndarray], float] = df_linear_rate,
    pay_dates: Optional[list[_date]] = None,
    accruals: Optional[list[float]] = None,
) -> float:
    """
    Spot Theta = NPV(t+1일) − NPV(t)   [커브 고정, 시간만 경과]

    시간 경과로 인한 순수 NPV 변화량:
      '할인율 언와인딩(Carry)' + '커브 롤다운(Roll-down)' 포함

    base_date를 전달하면 ACT/365 실일수 기준 스텁 계산 (simulate_irs_path_fm과 일치).

    df_fn 기본값을 df_linear_rate로 변경(기존 log-linear-DF에서). KRX 원화 IRS
    청산제도 설명자료(2019)의 "일별 무이표금리는 3개월 노드 사이 단순 선형보간"
    규정과 일치시키기 위함 — log-linear-DF는 1D처럼 극단적으로 짧은 노드의 영향이
    ln(DF)=-r·T가 T→0으로 소멸해 구조적으로 씻겨나가므로, 그 노드 근처 현금흐름의
    롤다운/세타가 실제보다 작게 계산되는 문제가 있었다(실측: 차기지급일이 8~9일
    남은 종목에서 세타가 약 21% 과소계상).

    pay_dates/accruals(선택): 실제 스케줄을 알면 t_maturity/t_next_payment의
    수동 1일 차감(DT) 없이 sim_date만 하루 미뤄서 정확하게 재평가한다(재구성
    근사 없이 실제 지급일 기준 그대로 필터링되므로 더 정확함).
    """
    short_r      = current_float_rate_pct / 100.0
    par_anchored = _inject_short_anchors(par_rates, short_r)
    zc = bootstrap_zero_curve(par_anchored)

    tomorrow: Optional[_date] = base_date + timedelta(days=1) if base_date else None

    # 마켓 컨벤션: "N일자 NPV"는 N의 결제일(다음 영업일) 기준으로 재평가한 값 —
    # 세타 = NPV(t+1의 결제일) - NPV(t의 결제일), 커브는 동일하게 고정.
    if pay_dates is not None and accruals is not None and base_date is not None:
        npv_today = compute_irs_npv(
            notional, fixed_rate_pct, direction, t_maturity,
            t_next_payment, current_float_rate_pct, sector, zc,
            fixed_freq, float_freq, sim_date=next_kr_business_day(base_date), df_fn=df_fn,
            pay_dates=pay_dates, accruals=accruals,
        )
        npv_tomorrow = compute_irs_npv(
            notional, fixed_rate_pct, direction, t_maturity,
            t_next_payment, current_float_rate_pct, sector, zc,
            fixed_freq, float_freq, sim_date=next_kr_business_day(tomorrow), df_fn=df_fn,
            pay_dates=pay_dates, accruals=accruals,
        )
        return npv_tomorrow - npv_today

    DT = 1.0 / 365.0
    npv_today = compute_irs_npv(
        notional, fixed_rate_pct, direction, t_maturity,
        t_next_payment, current_float_rate_pct, sector, zc,
        fixed_freq, float_freq,
        sim_date=(next_kr_business_day(base_date) if base_date else None), df_fn=df_fn,
    )
    # 내일: 만기/지급일 각 1일 앞당김
    npv_tomorrow = compute_irs_npv(
        notional, fixed_rate_pct, direction,
        max(t_maturity - DT, 0.0),
        max(t_next_payment - DT, DT),   # 최소 1일 잔존
        current_float_rate_pct, sector, zc,
        fixed_freq, float_freq,
        sim_date=(next_kr_business_day(tomorrow) if tomorrow else None), df_fn=df_fn,
    )
    theta = npv_tomorrow - npv_today
    return theta


# ══════════════════════════════════════════════════════════════════════════════
# 6. IRS_Trade — ISDA 표준 스케줄 기반 트레이드 객체
# ══════════════════════════════════════════════════════════════════════════════

class IRS_Trade:
    """ISDA 표준 IRS 트레이드 객체.

    초기화 시 start_date → maturity_date의 전체 지급 스케줄을 Forward Generation 방식으로
    영구 확정한다. 과거 임의 날짜로의 타임머신 재평가 및 백테스팅에 필요한 연속성을 보장.

    스케줄 생성 규칙 (ISDA 표준):
      1. Forward Generation : start_date + N × freq_months (dateutil.relativedelta 사용)
      2. EOM 룰             : start_date가 월말이면 이후 지급일도 해당 월 말일로 고정
      3. Modified Following : 주말이면 다음 영업일, 월경(Month-End Crossing) 시 직전 영업일
      4. Maturity Snap      : 생성 날짜 ≥ maturity_date이면 maturity_date로 대체 후 종료
    """

    __slots__ = (
        "notional", "fixed_rate_pct", "direction", "sector",
        "start_date", "maturity_date", "fixed_freq", "float_freq",
        "pay_dates", "accruals", "_pay_date_set",
    )

    def __init__(
        self,
        start_date: _date,
        maturity_date: _date,
        fixed_rate_pct: float,
        direction: int,
        notional: float,
        sector: str = "IRS",
        fixed_freq: float = 0.25,
        float_freq: float = 0.25,
    ) -> None:
        # start_date를 영업일로 보정(_next_business_day는 이미 영업일이면 그대로 반환하는
        # idempotent 함수라 안전하다). 호출측이 "최초거래일+1(캘린더일)"처럼 순수 T+1을
        # 앵커로 넘길 때, 그 T+1이 하필 공휴일(예: 성탄절 다음날 거래 → T+1=성탄절)이면
        # 실제 효력발생일은 그다음 영업일로 밀려야 한다 — 실측 확인: 이 보정이 없으면
        # 이후 전체 지급일이 하루씩 밀려서 실제 파일의 "차기지급일자"와 어긋난다.
        self.start_date     = _next_business_day(start_date)
        self.maturity_date  = maturity_date
        self.fixed_rate_pct = fixed_rate_pct
        self.direction      = direction
        self.notional       = notional
        self.sector         = sector
        self.fixed_freq     = fixed_freq
        self.float_freq     = float_freq
        self.pay_dates, self.accruals = self._build_schedule()
        self._pay_date_set: set[_date] = set(self.pay_dates)

    def _build_schedule(self) -> tuple[list[_date], list[float]]:
        """ISDA Forward Generation 스케줄 확정.

        Returns:
            pay_dates : Modified Following 조정 지급일 목록
            accruals  : 각 기간의 ACT/365 어큐럴 (전기간 지급일 → 당기간 지급일)
        """
        from dateutil.relativedelta import relativedelta as _rd
        import calendar as _cal

        freq_months = max(1, round(self.float_freq * 12))
        last_of_start = _cal.monthrange(self.start_date.year, self.start_date.month)[1]
        is_eom = (self.start_date.day == last_of_start)

        raw_dates: list[_date] = []
        i = 1
        while True:
            raw = self.start_date + _rd(months=freq_months * i)
            if is_eom:
                last_of_raw = _cal.monthrange(raw.year, raw.month)[1]
                raw = _date(raw.year, raw.month, last_of_raw)
            # maturity_date 직전(10일 이내)이면 별도 스텁을 만들지 않고 바로 만기로 스냅
            # → ModFol 조정 후 두 날짜가 동일해져 accrual=0인 유령 마지막 기간이
            #   생기는 것을 방지 (raw >= maturity_date 조건만으로는 걸러지지 않는 엣지케이스)
            if raw >= self.maturity_date or (self.maturity_date - raw).days <= 10:
                raw_dates.append(self.maturity_date)
                break
            raw_dates.append(raw)
            i += 1

        adj_dates = [_modfol_bd(d) for d in raw_dates]

        prev = self.start_date
        accruals: list[float] = []
        for d in adj_dates:
            accruals.append((d - prev).days / 365.0)
            prev = d

        return adj_dates, accruals

    def compute_npv(
        self,
        val_date: _date,
        zc: np.ndarray,
        current_float_rate_pct: float,
        df_fn: Callable[[float, np.ndarray], float] = df_linear_rate,
    ) -> float:
        """val_date 기준 Full Revaluation NPV.

        확정된 스케줄에서 val_date 이후(strictly greater) 잔여 지급일만 필터링.
          Fixed Leg  : Σ N × fixed_rate × accrual_i × DF(t_i)   (사전확정 어큐럴 사용)
          Float Leg
            현재 스텁: N × current_float × cur_accrual × DF(t_next)   (확정 픽싱)
            미래 스텁: N × fwd(t_s, t_e) × accrual_i × DF(t_e)        (포워드 투영)

        df_fn 기본값 df_linear_rate(linear-on-rate): KRW CD IRS 전 구간의 공식
        보간법을 linear-on-rate로 통일하기로 한 결정에 따름(KRX 청산제도
        설명자료 2019 — "일별 무이표금리는 3개월 노드 사이 단순 선형보간").
        이전에는 df()(log-linear-on-DF)가 하드코딩되어 있어, 이 메서드를 쓰는
        simulate_irs_path_fm/대시보드 시나리오 시뮬레이션 경로만 나머지 엔진
        (compute_irs_pvbp/krd_map/theta)과 다른 보간법을 쓰는 불일치가 있었다.
        """
        fixed_rate  = self.fixed_rate_pct / 100.0
        float_rate0 = current_float_rate_pct / 100.0
        is_ois      = (self.sector == "OIS")

        rem: list[int] = [i for i, pd in enumerate(self.pay_dates) if pd > val_date]
        if not rem:
            return 0.0

        first_i     = rem[0]
        t_next      = max((self.pay_dates[first_i] - val_date).days / 365.0, 1.0 / 365.0)
        cur_accrual = self.accruals[first_i]

        fixed_pv = 0.0
        for i in rem:
            t_pay    = (self.pay_dates[i] - val_date).days / 365.0
            fixed_pv += self.notional * fixed_rate * self.accruals[i] * df_fn(t_pay, zc)

        float_pv = self.notional * float_rate0 * cur_accrual * df_fn(t_next, zc)

        if is_ois:
            t_s = t_next
            for i in rem[1:]:
                t_e       = (self.pay_dates[i] - val_date).days / 365.0
                float_pv += self.notional * (df_fn(t_s, zc) - df_fn(t_e, zc))
                t_s       = t_e
        else:
            t_s = t_next
            for i in rem[1:]:
                t_e       = (self.pay_dates[i] - val_date).days / 365.0
                fwd       = forward_rate_simple(t_s, t_e, zc, df_fn=df_fn)
                float_pv += self.notional * fwd * self.accruals[i] * df_fn(t_e, zc)
                t_s       = t_e

        return self.direction * (fixed_pv - float_pv)


# ══════════════════════════════════════════════════════════════════════════════
# 7. FM 시뮬레이션 (Full Revaluation Path — NumPy 벡터화)
# ══════════════════════════════════════════════════════════════════════════════

def simulate_irs_path_fm(
    par_rates: list[tuple[float, float]],
    notional: float,
    fixed_rate_pct: float,
    direction: int,
    t_maturity: float,
    t_next_payment: float,
    current_float_rate_pct: float,
    sector: str,
    shock_curve: list[tuple[float, float]],
    days_to_simulate: int = 180,
    fixed_freq: float = 0.25,
    float_freq: float = 0.25,
    shock_type: str = "step",           # 'step': Day 1부터 100% 즉시 / 'ramp': 매일 d/D 비율 증가
    base_date_str: str = "",            # 기준일 ISO 문자열 (e.g. '2026-03-24') — 영업일 조정용
    audit: bool = False,               # True 시 Day 0~10 감사 로그를 CSV로 저장
    start_date_str: str = "",          # [NEW] 계약 시작일 (ISDA Forward Schedule 생성용)
    funding_events: "list | None" = None,  # BOK 이벤트 목록 (계단식 1D/3M 충격용)
    # SIM2-4 (추가 전용 — 이 파라미터 외 본 함수/파일 불변 룰 유지): 호출자가
    # 설계한 일별 충격 팩터 경로. 길이 days_to_simulate+1, 유한값. None이면
    # 종전 step/ramp 동작과 바이트 동일. 값이 있으면 매일의 커브 충격 스케일이
    # 이 배열을 따른다(BOK 계단 브랜치의 ramp 성분 포함) — 스왑 MTM 궤적이
    # 채권 쪽 _factor(커스텀 경로)와 같은 경로를 타게 하는 정합 파라미터.
    path_factor: "np.ndarray | list | None" = None,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, dict, list]:
    """
    True Path-Dependent FM: IRS_Trade 기반 ISDA 표준 스케줄 적용.

    [OOP 경로] start_date_str 또는 base_date_str 제공 시 IRS_Trade를 생성하여
               달력 정확 일치(set lookup)로 리픽싱을 감지하고, 사전확정 어큐럴로
               정산 CF를 계산 → Ghost Jump = 0 완벽 보장.
    [레거시]   base_date_str 없이 호출되는 극단적 폴백만 남김 (실사용 없음).

    Returns:
        mtm_pnl    : shape (days_to_simulate+1,) — 일별 Shocked NPV − Base NPV  [KRW]
        daily_pvbp : shape (days_to_simulate+1,) — 일별 PVBP [KRW/bp, DV01 관행]
        daily_carry: shape (days_to_simulate+1,) — 일별 정산 보정 캐리 [KRW]
        audit_rows : list[dict] — audit=True일 때 일별 감사 데이터
    """
    SHIFT    = 1e-4
    DT       = 1.0 / 365.0
    par_anch = _inject_short_anchors(par_rates, current_float_rate_pct / 100.0)

    if shock_curve:
        _sc_t  = np.array([t for t, _ in shock_curve], dtype=float)
        _sc_bp = np.array([b for _, b in shock_curve], dtype=float)
    else:
        _sc_t  = np.array([0.0, 30.0])
        _sc_bp = np.array([0.0,  0.0])

    # ── BOK 이벤트 파싱 (1D/3M 계단식 충격용) ────────────────────────────────
    _bok_evts_fm: list[dict] = []
    if funding_events and base_date_str:
        try:
            _bd_fm = _date.fromisoformat(base_date_str[:10])
            _bok_evts_fm = sorted(
                [{"day": (_date.fromisoformat(ev["date"]) - _bd_fm).days,
                  "bp":  float(ev.get("shiftBp", 0))}
                 for ev in funding_events
                 if ev.get("date")
                 and 0 <= (_date.fromisoformat(ev["date"]) - _bd_fm).days <= days_to_simulate],
                key=lambda x: x["day"],
            )
        except Exception:
            _bok_evts_fm = []

    def _cum_bok_fm(day: int) -> float:
        return sum(e["bp"] for e in _bok_evts_fm if e["day"] <= day)

    def _zc(factor: float) -> np.ndarray:
        return bootstrap_zero_curve(
            [(t, r + float(np.interp(t, _sc_t, _sc_bp)) * factor * SHIFT)
             for t, r in par_anch]
        )

    D           = days_to_simulate + 1
    mtm_pnl     = np.zeros(D)
    daily_pvbp  = np.zeros(D)
    daily_carry = np.zeros(D)

    # SIM2-4 — 경로 팩터 검증 (길이 D, 전부 유한). None = 레거시 경로 그대로.
    _path_factor: Optional[np.ndarray] = None
    if path_factor is not None:
        _path_factor = np.asarray(path_factor, dtype=float)
        if _path_factor.shape != (D,):
            raise ValueError(
                f"path_factor 길이 {_path_factor.shape[0] if _path_factor.ndim == 1 else _path_factor.shape}"
                f" != days_to_simulate+1 ({D})"
            )
        if not np.all(np.isfinite(_path_factor)):
            raise ValueError("path_factor에 비유한(NaN/Inf) 값이 있습니다")

    zc_base = _zc(0.0)

    # ── 기준일 파싱 ───────────────────────────────────────────────────────────
    _base_date: Optional[_date] = None
    if base_date_str:
        try:
            _base_date = _date.fromisoformat(base_date_str[:10])
        except Exception:
            pass

    # 램프 충격을 영업일 기준으로 정규화(주말 skip) — biz_day_ranks 참고
    _biz_ranks: Optional[np.ndarray] = biz_day_ranks(_base_date, days_to_simulate) if _base_date else None
    _biz_total = int(_biz_ranks[-1]) if _biz_ranks is not None and _biz_ranks[-1] > 0 else max(days_to_simulate, 1)

    def _ramp_factor(day: int) -> float:
        if _biz_ranks is not None:
            return float(_biz_ranks[min(day, len(_biz_ranks) - 1)]) / _biz_total
        return day / max(days_to_simulate, 1)

    if current_float_rate_pct <= 0.0:
        current_float_rate_pct = forward_rate_simple(0.0, float_freq, zc_base) * 100.0

    _zc_full   = _zc(1.0)
    _zc_full1b = bootstrap_zero_curve(
        [(t, r + float(np.interp(t, _sc_t, _sc_bp)) * SHIFT + SHIFT)
         for t, r in par_anch]
    )

    # ── [OOP] IRS_Trade 생성 — ISDA Forward Schedule 영구 확정 ───────────────
    # start_date_str 없으면 nextFixingDate 기준 1기간 역산 → 현재 스텁 시작일을 virtual start로 사용.
    # Virtual start여도 forward generation이 이후 모든 지급일을 정확히 재현한다.
    _trade: Optional[IRS_Trade] = None
    if _base_date is not None:
        _mat_dt  = _modfol_bd(_base_date + timedelta(days=round(t_maturity * 365)))
        _freq_m  = max(1, round(float_freq * 12))
        _start_dt: Optional[_date] = None
        if start_date_str:
            try:
                _start_dt = _date.fromisoformat(start_date_str[:10])
            except Exception:
                pass
        if _start_dt is None:
            _nxt_raw  = _base_date + timedelta(days=max(round(t_next_payment * 365), 1))
            _nxt_adj  = _next_business_day(_nxt_raw)
            _start_dt = _modfol_bd(_subtract_months(_nxt_adj, _freq_m))
        _trade = IRS_Trade(
            start_date     = _start_dt,
            maturity_date  = _mat_dt,
            fixed_rate_pct = fixed_rate_pct,
            direction      = direction,
            notional       = notional,
            sector         = sector,
            fixed_freq     = fixed_freq,
            float_freq     = float_freq,
        )

    # ── Day 0 PVBP 및 기준 NPV ────────────────────────────────────────────────
    # 마켓 컨벤션: "N일자 NPV"는 N의 결제일(다음 영업일) 기준으로 재평가한 값을
    # 보고한다 — 실제 평가에 쓰이는 val_date는 base_date 그대로가 아니라
    # next_kr_business_day(base_date)로 한 번 밀어야 한다.
    if _trade is not None and _base_date is not None:
        _settle0 = next_kr_business_day(_base_date)
        # base_date와 settle0 사이에 실제 지급일(리픽싱)이 끼어 있으면, 그 구간의 변동금리는
        # 파일에 박힌 옛 확정금리가 아니라 포워드금리로 롤오버해야 한다(일별 루프의 리픽싱
        # 감지와 동일 원칙). 안 그러면 그 지급일과 settle0이 겹치는 종목에서 Day0→Day1 사이에
        # 시장변동 없이도 "옛 확정금리 → 포워드금리"로 전환되며 인위적인 Ghost Jump가 생긴다
        # (실측: 3/25에 지급일이 걸리는 종목에서 시장변동 0인데도 NPV가 약 7,370만원 점프).
        _rolled_pd0 = [pd for pd in _trade.pay_dates if _base_date < pd <= _settle0]
        _flt0_base = current_float_rate_pct
        _flt0_full = current_float_rate_pct
        if _rolled_pd0:
            _rem0 = [pd for pd in _trade.pay_dates if pd > _settle0]
            if _rem0:
                _t_nn0 = max((_rem0[0] - _settle0).days / 365.0, DT)
                _flt0_base = forward_rate_simple(0.0, _t_nn0, zc_base) * 100.0
                _flt0_full = forward_rate_simple(0.0, _t_nn0, _zc_full) * 100.0
        daily_pvbp[0] = -(
            _trade.compute_npv(_settle0, _zc_full, _flt0_full)
            - _trade.compute_npv(_settle0, zc_base, _flt0_base)
        )
        npv_b_prev = _trade.compute_npv(_settle0, zc_base, _flt0_base)
    else:
        _t0 = max(t_next_payment, DT)
        daily_pvbp[0] = -(
            compute_irs_npv(notional, fixed_rate_pct, direction, t_maturity, _t0,
                            current_float_rate_pct, sector, _zc_full, fixed_freq, float_freq)
            - compute_irs_npv(notional, fixed_rate_pct, direction, t_maturity, _t0,
                              current_float_rate_pct, sector, zc_base, fixed_freq, float_freq)
        )
        npv_b_prev = compute_irs_npv(notional, fixed_rate_pct, direction, t_maturity, _t0,
                                      current_float_rate_pct, sector, zc_base, fixed_freq, float_freq)

    npv_s_initial = npv_b_prev
    if _trade is not None and _base_date is not None:
        # 루프 진입 시 flt_s/flt_b는 Day0 베이스라인이 실제로 사용한(롤오버 여부 반영된)
        # 금리와 일치해야 한다 — 안 그러면 Day0→Day1 사이에 "베이스라인은 롤오버된 금리,
        # 루프 첫 스텝은 옛 금리"로 어긋나며 또 다른 Ghost Jump가 생긴다.
        # 단, 반드시 zc_base 기준(_flt0_base)으로만 통일할 것 — _flt0_full은 daily_pvbp[0]
        # 전용(완전충격 커브 _zc_full=factor 1.0 기준)이라, 이걸 flt_s에 쓰면 "커브는 day1의
        # 아주 작은 램프(factor≈day/N)로 할인하면서 금리는 완전충격 상태"라는 모순이 생겨
        # 시나리오 충격이 미미해도 거액의 유령 손익이 발생한다(실측 확인: 400억 종목에서
        # 0.16bp 충격에 약 3천만원 튐 — flt_s를 _flt0_base로 통일 후 정상 크기로 복귀).
        # day0/settle0 시점엔 shocked/base 시나리오가 아직 갈라지지 않았으므로(factor≈0)
        # 둘 다 동일한 unshocked 기준 금리에서 출발하는 게 맞다.
        flt_s = flt_b = _flt0_base
        _prev_settle_d: Optional[_date] = _settle0
    else:
        flt_s = flt_b = current_float_rate_pct
        _prev_settle_d = None
    cum_cf_s = cum_cf_b = 0.0
    _is_pay  = (direction == -1)

    daily_npv_s = np.zeros(D);  daily_npv_b = np.zeros(D)
    daily_scf_b = np.zeros(D);  daily_scf_s = np.zeros(D)
    daily_npv_b[0] = daily_npv_s[0] = npv_b_prev

    # ── 레거시 경로 전용 상태 변수 (IRS_Trade 없을 때만 사용) ────────────────
    t_mat_s = t_mat_b = t_maturity
    _t0_leg  = max(t_next_payment, DT)
    t_nxt_s  = t_nxt_b = _t0_leg
    _sch_prev_dt: Optional[_date] = None
    _sch_next_dt: Optional[_date] = None
    if _trade is None and _base_date is not None:
        _nfd_dt   = _base_date + timedelta(days=max(round(_t0_leg * 365), 1))
        _nfd_adj  = _next_business_day(_nfd_dt)
        _fmth     = max(1, round(float_freq * 12))
        _prev_adj = _modfol_bd(_subtract_months(_nfd_adj, _fmth))
        _sch_prev_dt = _prev_adj
        _sch_next_dt = _nfd_adj
        _first_stub  = (_nfd_adj - _prev_adj).days / 365.0
    else:
        _first_stub  = float_freq
    next_accrual_s = next_accrual_b = _first_stub

    # ── Audit 준비 ─────────────────────────────────────────────────────────────
    if audit:
        def _fmt_tenor(t_yr: float) -> str:
            d = t_yr * 365.0
            if d < 25:   return f"{int(round(d))}D"
            if d < 350:  return f"{int(round(d / 30.4375))}M"
            yr = round(t_yr, 2)
            return f"{int(yr)}Y" if yr == int(yr) else f"{yr}Y"
        curve_tenors: list[tuple[str, float]] = [(_fmt_tenor(t), t) for t, _ in par_anch]

    audit_rows: list[dict] = []

    # ── 메인 시뮬레이션 루프: Day 1 ~ sim_days ────────────────────────────────
    for day in range(1, D):
        try:
            val_date     = (_base_date + timedelta(days=day)) if _base_date else None
            settled_cf_s = settled_cf_b = 0.0
            flt_s_old    = flt_s
            flt_b_old    = flt_b

            # SIM2-4: 경로 팩터가 있으면 step/ramp 대신 그 날의 설계 팩터를 쓴다.
            factor = (
                float(_path_factor[day])
                if _path_factor is not None
                else (_ramp_factor(day) if shock_type == "ramp" else 1.0)
            )
            if _bok_evts_fm:
                # BOK 계단식: t≤3M=100%, 3M<t<1Y=선형 소멸, t≥1Y=IRS ramp만
                _bok_cum = _cum_bok_fm(day)
                def _day_shock(t: float) -> float:
                    _ramp = float(np.interp(t, _sc_t, _sc_bp)) * factor
                    if t <= 0.25:
                        return _bok_cum
                    elif t < 1.0:
                        w = (t - 0.25) / 0.75
                        return _bok_cum * (1.0 - w) + _ramp * w
                    else:
                        return _ramp
                _shocked_par = [(t, r + _day_shock(t) * SHIFT) for t, r in par_anch]
                zc_s  = bootstrap_zero_curve(_shocked_par)
                zc_s1 = bootstrap_zero_curve([(t, r + SHIFT) for t, r in _shocked_par])
            elif shock_type == "step" and _path_factor is None:
                zc_s  = _zc_full
                zc_s1 = _zc_full1b
            else:
                zc_s  = _zc(factor)
                zc_s1 = bootstrap_zero_curve(
                    [(t, r + float(np.interp(t, _sc_t, _sc_bp)) * factor * SHIFT + SHIFT)
                     for t, r in par_anch]
                )

            # ━━━ [OOP 경로] IRS_Trade 스케줄 기반 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            if _trade is not None and val_date is not None:
                # NPV 재평가는 그날의 결제일(다음 영업일)로 한 번 밀어서 계산한다(마켓
                # 컨벤션). 리픽싱/정산 판정도 반드시 "같은 결제일 기준"으로 해야 한다 —
                # 판정 기준일(val_date)과 평가 기준일(_settle_d)이 다르면, 지급일이 그
                # 사이(val_date, _settle_d]에 낀 날 그 현금흐름이 NPV 적분에서는 빠지는데
                # cum_cf엔 아직 안 잡히는 "1일 공백"이 생겨 시장변동 없이도 거액이 사라졌다
                # 나타나는 Ghost Jump가 발생한다(실측 확인). 그래서 직전 결제일
                # (_prev_settle_d)부터 이번 결제일(_settle_d)까지의 구간으로 지급일을
                # 판정해 정산과 포워드금리 롤오버를 동시에 처리한다.
                _settle_d = next_kr_business_day(val_date)
                _due_pd = [pd for pd in _trade.pay_dates if _prev_settle_d < pd <= _settle_d]
                for _pd in _due_pd:
                    _pay_idx    = _trade.pay_dates.index(_pd)
                    _settle_acc = _trade.accruals[_pay_idx]   # 사전확정 기간 어큐럴

                    _net_s        = (flt_s_old - fixed_rate_pct) if _is_pay else (fixed_rate_pct - flt_s_old)
                    settled_cf_s += notional * (_net_s / 100.0) * _settle_acc

                    _net_b        = (flt_b_old - fixed_rate_pct) if _is_pay else (fixed_rate_pct - flt_b_old)
                    settled_cf_b += notional * (_net_b / 100.0) * _settle_acc

                    # 다음 기간 포워드금리 픽싱(남은 지급일이 있을 때만) — 평가 기준일인
                    # _settle_d를 "지금"으로 두고 그 시점 기준 포워드금리를 뽑는다.
                    _rem_after = [pd for pd in _trade.pay_dates if pd > _settle_d]
                    if _rem_after:
                        _t_nn  = max((_rem_after[0] - _settle_d).days / 365.0, DT)
                        flt_s  = forward_rate_simple(0.0, _t_nn, zc_s)   * 100.0
                        flt_b  = forward_rate_simple(0.0, _t_nn, zc_base) * 100.0
                cum_cf_s += settled_cf_s
                cum_cf_b += settled_cf_b

                # 만기 도래: 결제일이 마지막 지급일(= 만기) 이상이면 종료
                if _settle_d >= _trade.pay_dates[-1]:
                    mtm_pnl[day:]    = (0.0 - npv_s_initial) + cum_cf_s
                    daily_pvbp[day]  = daily_carry[day] = 0.0
                    daily_npv_s[day] = daily_npv_b[day] = 0.0
                    daily_scf_s[day] = settled_cf_s
                    daily_scf_b[day] = settled_cf_b
                    if audit:
                        _arow: dict = {
                            "Day": day, "Aging_Days": day, "Shock_Type": shock_type,
                            "Ramp_Factor_pct": round(factor * 100, 1),
                            "Float_Shocked_pct": round(flt_s, 4), "Float_Base_pct": round(flt_b, 4),
                            "t_nxt_s_yr": 0.0,
                        }
                        for lbl, t_yr in curve_tenors:
                            _arow[f"Shock_{lbl}_bp"]      = round(float(np.interp(t_yr, _sc_t, _sc_bp)) * factor, 2)
                            _arow[f"ZeroCurve_{lbl}_pct"] = round(float(np.interp(t_yr, zc_s[:, 0], zc_s[:, 1])) * 100, 4)
                        _arow.update({"NPV_Shocked": 0, "NPV_Base": 0,
                                      "Settled_CF_Base": round(settled_cf_b), "Settled_CF_Shock": round(settled_cf_s),
                                      "Cum_CF_Diff": round(cum_cf_s - cum_cf_b),
                                      "Daily_FM_Carry": 0, "Daily_Clean_MTM": round(float(mtm_pnl[day]))})
                        audit_rows.append(_arow)
                    break

                # Full Revaluation (만기 전)
                npv_s  = _trade.compute_npv(_settle_d, zc_s,    flt_s)
                npv_b  = _trade.compute_npv(_settle_d, zc_base, flt_b)
                npv_s1 = _trade.compute_npv(_settle_d, zc_s1,   flt_s)
                _prev_settle_d = _settle_d

            # ━━━ [레거시 경로] t_nxt 롤오프 기반 (극단적 폴백) ━━━━━━━━━━━━━━
            else:
                t_mat_s -= DT;  t_mat_b -= DT
                t_nxt_s -= DT;  t_nxt_b -= DT
                refixed_s = refixed_b = False

                if t_nxt_s <= DT * 0.5:
                    refixed_s = True
                    _n_rem_s  = max(round(t_mat_s / float_freq), 1)
                    t_nxt_s   = t_mat_s - (_n_rem_s - 1) * float_freq
                    flt_s     = forward_rate_simple(0.0, max(t_nxt_s, DT), zc_s) * 100.0
                if t_nxt_b <= DT * 0.5:
                    refixed_b = True
                    _n_rem_b  = max(round(t_mat_b / float_freq), 1)
                    t_nxt_b   = t_mat_b - (_n_rem_b - 1) * float_freq
                    flt_b     = forward_rate_simple(0.0, max(t_nxt_b, DT), zc_base) * 100.0

                if refixed_s:
                    _net_s       = (flt_s_old - fixed_rate_pct) if _is_pay else (fixed_rate_pct - flt_s_old)
                    settled_cf_s = notional * (_net_s / 100.0) * next_accrual_s
                    cum_cf_s    += settled_cf_s
                    if _base_date is not None:
                        _sch_prev_dt = _sch_next_dt
                        _sch_next_dt = _modfol_bd(
                            (_base_date + timedelta(days=day)) + timedelta(days=round(t_nxt_s * 365))
                        )
                        next_accrual_s = (_sch_next_dt - _sch_prev_dt).days / 365.0  # type: ignore[operator]
                    else:
                        next_accrual_s = t_nxt_s
                if refixed_b:
                    _net_b       = (flt_b_old - fixed_rate_pct) if _is_pay else (fixed_rate_pct - flt_b_old)
                    settled_cf_b = notional * (_net_b / 100.0) * next_accrual_b
                    cum_cf_b    += settled_cf_b
                    next_accrual_b = next_accrual_s

                if t_mat_s <= DT * 0.5:
                    if not refixed_s:
                        _a_s = max(t_nxt_s + DT, DT)
                        _n_s = (flt_s_old - fixed_rate_pct) if _is_pay else (fixed_rate_pct - flt_s_old)
                        settled_cf_s = notional * (_n_s / 100.0) * _a_s
                        cum_cf_s += settled_cf_s
                    if not refixed_b:
                        _a_b = max(t_nxt_b + DT, DT)
                        _n_b = (flt_b_old - fixed_rate_pct) if _is_pay else (fixed_rate_pct - flt_b_old)
                        settled_cf_b = notional * (_n_b / 100.0) * _a_b
                        cum_cf_b += settled_cf_b
                    mtm_pnl[day:]    = (0.0 - npv_s_initial) + cum_cf_s
                    daily_pvbp[day]  = daily_carry[day] = 0.0
                    daily_npv_s[day] = daily_npv_b[day] = 0.0
                    daily_scf_s[day] = settled_cf_s
                    daily_scf_b[day] = settled_cf_b
                    if audit:
                        _arow = {
                            "Day": day, "Aging_Days": day, "Shock_Type": shock_type,
                            "Ramp_Factor_pct": round(factor * 100, 1),
                            "Float_Shocked_pct": round(flt_s, 4), "Float_Base_pct": round(flt_b, 4),
                            "t_nxt_s_yr": round(t_nxt_s, 4),
                        }
                        for lbl, t_yr in curve_tenors:
                            _arow[f"Shock_{lbl}_bp"]      = round(float(np.interp(t_yr, _sc_t, _sc_bp)) * factor, 2)
                            _arow[f"ZeroCurve_{lbl}_pct"] = round(float(np.interp(t_yr, zc_s[:, 0], zc_s[:, 1])) * 100, 4)
                        _arow.update({"NPV_Shocked": 0, "NPV_Base": 0,
                                      "Settled_CF_Base": round(settled_cf_b), "Settled_CF_Shock": round(settled_cf_s),
                                      "Cum_CF_Diff": round(cum_cf_s - cum_cf_b),
                                      "Daily_FM_Carry": 0, "Daily_Clean_MTM": round(float(mtm_pnl[day]))})
                        audit_rows.append(_arow)
                    break

                _sim_date = (_base_date + timedelta(days=day)) if _base_date else None
                npv_s  = compute_irs_npv(notional, fixed_rate_pct, direction,
                                          t_mat_s, t_nxt_s, flt_s, sector, zc_s,
                                          fixed_freq, float_freq, sim_date=_sim_date,
                                          prev_pay_date=_sch_prev_dt)
                npv_b  = compute_irs_npv(notional, fixed_rate_pct, direction,
                                          t_mat_b, t_nxt_b, flt_b, sector, zc_base,
                                          fixed_freq, float_freq, sim_date=_sim_date,
                                          prev_pay_date=_sch_prev_dt)
                npv_s1 = compute_irs_npv(notional, fixed_rate_pct, direction,
                                          t_mat_s, t_nxt_s, flt_s, sector, zc_s1,
                                          fixed_freq, float_freq, sim_date=_sim_date,
                                          prev_pay_date=_sch_prev_dt)

            # ━━━ 공통 MTM 기록 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            mtm_pnl[day]     = (npv_s - npv_s_initial) + cum_cf_s
            daily_pvbp[day]  = -(npv_s1 - npv_s)
            daily_carry[day] = 0.0
            daily_npv_s[day] = npv_s
            daily_npv_b[day] = npv_b
            daily_scf_s[day] = settled_cf_s
            daily_scf_b[day] = settled_cf_b
            npv_b_prev       = npv_b

            if not np.isfinite(mtm_pnl[day]):
                print(f"\n[NaN/Inf] Day {day}: mtm_pnl={mtm_pnl[day]!r} | npv_s={npv_s:.2f} | flt_s={flt_s:.4f}%")
                raise ValueError(f"Day {day} mtm_pnl 오염: {mtm_pnl[day]!r}")
            if not np.isfinite(daily_pvbp[day]):
                print(f"\n[NaN/Inf] Day {day}: daily_pvbp={daily_pvbp[day]!r}")
                raise ValueError(f"Day {day} daily_pvbp 오염: {daily_pvbp[day]!r}")

            if audit:
                if _trade is not None and val_date is not None:
                    _fwd_pays = [pd for pd in _trade.pay_dates if pd > val_date]
                    _t_nxt_yr = (_fwd_pays[0] - val_date).days / 365.0 if _fwd_pays else 0.0
                else:
                    _t_nxt_yr = t_nxt_s
                _arow = {
                    "Day": day, "Aging_Days": day, "Shock_Type": shock_type,
                    "Ramp_Factor_pct": round(factor * 100, 1),
                    "Float_Shocked_pct": round(flt_s, 4), "Float_Base_pct": round(flt_b, 4),
                    "t_nxt_s_yr": round(_t_nxt_yr, 4),
                }
                for lbl, t_yr in curve_tenors:
                    _arow[f"Shock_{lbl}_bp"]      = round(float(np.interp(t_yr, _sc_t, _sc_bp)) * factor, 2)
                    _arow[f"ZeroCurve_{lbl}_pct"] = round(float(np.interp(t_yr, zc_s[:, 0], zc_s[:, 1])) * 100, 4)
                _arow.update({"NPV_Shocked": round(npv_s), "NPV_Base": round(npv_b),
                              "Settled_CF_Base": round(settled_cf_b), "Settled_CF_Shock": round(settled_cf_s),
                              "Cum_CF_Diff": round(cum_cf_s - cum_cf_b),
                              "Daily_FM_Carry": round(float(daily_carry[day])),
                              "Daily_Clean_MTM": round(float(mtm_pnl[day]))})
                audit_rows.append(_arow)

        except Exception as _err:
            import traceback as _tb
            print(f"\n[CRITICAL ERROR] ══════════════════════════════════════════════════")
            print(f"[CRITICAL ERROR] Day {day} 연산 중 뻗음: {_err}")
            print(f"[CRITICAL ERROR] 상세:\n{_tb.format_exc()}")
            print(f"[CRITICAL ERROR] ══════════════════════════════════════════════════\n")
            raise

    if audit and audit_rows:
        print(f"[AUDIT] {len(audit_rows)} 행 수집 완료")

    daily_metrics = {
        "npv_s": daily_npv_s,
        "npv_b": daily_npv_b,
        "scf_b": daily_scf_b,
        "scf_s": daily_scf_s,
    }
    return mtm_pnl, daily_pvbp, daily_carry, daily_metrics, audit_rows


# ══════════════════════════════════════════════════════════════════════════════
# 8. 편의 함수: dict 형태 irsCurves → par_rates tuple list 변환
# ══════════════════════════════════════════════════════════════════════════════

def parse_irs_curves(
    irs_curves: list[dict],
    base_date: "_date | None" = None,
) -> list[tuple[float, float]]:
    """
    프론트엔드 전송 형식 [{t: float, rate: float, maturityDate?: str}, ...]  (rate = decimal)
    →  [(T_years, par_rate_decimal), ...]  오름차순 정렬

    base_date가 주어지고 항목에 maturityDate(ISO 문자열, 실제 달력 만기일 — 휴일이면
    다음 영업일로 이월된 값이 이미 반영됨)가 있으면
        T = (maturityDate - base_date).days / 365.0
    로 실제 만기 기준 T를 사용한다 (bootstrap_zero_curve가 이 T로 정확한 분기
    스케줄을 역산하므로, 라벨(0.25/0.5/1.5/…) 대신 실제 날짜를 쓰면 더 정확함).
    maturityDate가 없거나 파싱 실패 시 기존처럼 라벨 T(item['t'])로 폴백 — 하위 호환.
    """
    result = []
    for item in irs_curves:
        rate = float(item.get("rate", 0))
        t: float | None = None
        mat_str = item.get("maturityDate")
        if base_date is not None and mat_str:
            try:
                t = (_date.fromisoformat(str(mat_str)[:10]) - base_date).days / 365.0
            except Exception:
                t = None
        if t is None:
            t = float(item.get("t", 0))
        if t > 0:
            result.append((t, rate))
    return sorted(result, key=lambda x: x[0])
