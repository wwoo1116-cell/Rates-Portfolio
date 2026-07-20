"""KR business-day / tenor-maturity date logic — moved verbatim from
simulation_service.py (R3a).

NOTE (SPLIT_PLAN H2): `next_kr_business_day` here is the service-local
definition; a DIFFERENT function of the same name exists in
engine/quant_engine.py. The simulate family resolves THIS one — do not
"unify" them.

NOTE (SPLIT_PLAN H5): the guarded `holidays` import is kept structurally
identical to the original — on ImportError, `_hols_lib` stays undefined and
the functions' inner `try` blocks fall back to `_KR_HOLIDAYS = set()` via
their `except Exception` (NameError included), exactly as before.
"""

from __future__ import annotations

from datetime import date, timedelta

try:
    import holidays as _hols_lib
    _KR_HOLIDAYS = _hols_lib.KR(years=range(2020, 2035))
except ImportError:
    _KR_HOLIDAYS = set()


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
