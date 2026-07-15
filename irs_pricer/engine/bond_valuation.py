"""
고정쿠폰 만기일시상환(bullet) 채권의 현금흐름 스케줄 + 현재가치.

quant_engine.py에는 채권 프라이싱 엔진이 없다(IRS/OIS 스왑 전용). 그래서 여기서
캘린더 로직을 복제하지 않고 quant_engine의 스케줄 프리미티브(_next_business_day /
_modfol_bd / 한국 공휴일 기반 Forward Generation + EOM + Modified Following +
ACT/365 어큐럴)를 재사용해 최소한의 채권 머신을 만든다. 불릿 채권은 사실상
"만기에 원금 상환이 추가된 고정금리 단일 레그 스왑"이며, 커브가 아니라 단일
시장수익률(민평/시장유통수익률, yield-to-price)로 할인한다. 이 수익률은 Credit
Matrix에서 조회한다(credit_curve_service.market_yield_for).

단위 규약:
  - coupon_rate  : 퍼센트(%) 단위, e.g. 3.125
  - market_yield : 소수(decimal) 단위, e.g. 0.0325
  - notional / cashflow / pv : 원화(KRW)
"""

from __future__ import annotations

import calendar as _cal
from dataclasses import dataclass
from datetime import date

from dateutil.relativedelta import relativedelta

from .mtm_valuation import CashFlowDetail
from .quant_engine import _modfol_bd, _next_business_day


@dataclass
class BondValuation:
    asset_id: str
    npv: float          # 잔여 현금흐름의 현재가치 합 (dirty / full price)
    market_yield: float  # 할인에 사용한 시장수익률 (decimal)
    cashflows: list[CashFlowDetail]


def generate_bond_schedule(
    issue_date: date,
    maturity_date: date,
    payment_frequency: int,
) -> tuple[list[date], list[float]]:
    """발행일→만기일 전체 쿠폰 지급 스케줄.

    규칙은 quant_engine.IRS_Trade._build_schedule와 동일: (영업일 보정한)
    발행일 기준 Forward Generation, EOM 고정, Modified Following 조정, 만기 스냅,
    ACT/365 어큐럴. payment_frequency는 연간 쿠폰 횟수(2=반기, 4=분기).
    """
    if payment_frequency <= 0:
        raise ValueError(f"payment_frequency must be positive, got {payment_frequency}")
    if maturity_date <= issue_date:
        raise ValueError("maturity_date must be after issue_date")

    start = _next_business_day(issue_date)
    freq_months = max(1, round(12 / payment_frequency))

    last_of_start = _cal.monthrange(start.year, start.month)[1]
    is_eom = (start.day == last_of_start)

    raw_dates: list[date] = []
    i = 1
    while True:
        raw = start + relativedelta(months=freq_months * i)
        if is_eom:
            last_of_raw = _cal.monthrange(raw.year, raw.month)[1]
            raw = date(raw.year, raw.month, last_of_raw)
        # 만기 직전(10일 이내)이면 스텁 없이 바로 만기로 스냅 -- accrual=0인 유령
        # 마지막 기간 방지 (IRS_Trade._build_schedule과 동일한 엣지케이스 처리).
        if raw >= maturity_date or (maturity_date - raw).days <= 10:
            raw_dates.append(maturity_date)
            break
        raw_dates.append(raw)
        i += 1

    adj_dates = [_modfol_bd(d) for d in raw_dates]

    prev = start
    accruals: list[float] = []
    for d in adj_dates:
        accruals.append((d - prev).days / 365.0)
        prev = d
    return adj_dates, accruals


def value_bond(
    asset_id: str,
    issue_date: date,
    maturity_date: date,
    coupon_rate: float,       # percent
    payment_frequency: int,
    notional: float,
    market_yield: float,      # decimal
    val_date: date,
) -> BondValuation:
    """고정쿠폰 불릿 채권의 현재가치. 잔여 쿠폰과 만기 원금을 모두 단일
    시장수익률로 할인한다(yield-to-price):

        pv_i = cf_i / (1 + y/f)^(f * t_i)      t_i = val_date→지급일 ACT/365 연수
        NPV  = Σ pv_i                          (dirty / full price)

    val_date 이전(<=) 쿠폰은 제외한다. 원금(= notional)은 마지막 지급일에
    최종 쿠폰과 함께 상환된다.
    """
    pay_dates, accruals = generate_bond_schedule(issue_date, maturity_date, payment_frequency)
    coupon = coupon_rate / 100.0
    f = float(payment_frequency)
    start = _next_business_day(issue_date)

    cashflows: list[CashFlowDetail] = []
    npv = 0.0
    last_i = len(pay_dates) - 1
    for i, pay in enumerate(pay_dates):
        if pay <= val_date:
            continue
        a_start = pay_dates[i - 1] if i > 0 else start
        t = (pay - val_date).days / 365.0
        disc = (1.0 + market_yield / f) ** (f * t)

        coupon_cf = notional * coupon * accruals[i]
        coupon_pv = coupon_cf / disc
        npv += coupon_pv
        cashflows.append(CashFlowDetail(a_start, pay, pay, "coupon", coupon, True, coupon_cf, coupon_pv))

        # 원금 상환은 만기 스냅으로 마지막 지급일이 만기일과 어긋날 수 있으므로
        # 날짜 비교가 아니라 마지막 인덱스로 판정.
        if i == last_i:
            principal_pv = notional / disc
            npv += principal_pv
            cashflows.append(
                CashFlowDetail(a_start, pay, pay, "principal", None, True, notional, principal_pv)
            )

    return BondValuation(asset_id=asset_id, npv=npv, market_yield=market_yield, cashflows=cashflows)
