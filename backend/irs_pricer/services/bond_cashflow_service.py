"""
채권 현금흐름 서비스: 업로드된 각 채권에 대해 (수학적으로 엄밀한) 쿠폰+원금상환
스케줄과 현재가치를 생성한다. 할인율은 Credit Matrix의 시장유통수익률을 채권의
잔존만기에서 보간해 사용한다(credit_curve_service.market_yield_for).

engine.bond_valuation이 스케줄/할인 수학을 담당하고, 이 서비스는 portfolio_service
.price_portfolio와 동일하게 자산별 결과를 모아 asset_id 태깅한 통합 현금흐름을 낸다.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Iterable, Protocol

from ..config import DATA_DIR
from ..engine.bond_valuation import value_bond
from ..engine.mtm_valuation import CashFlowDetail
from ..loaders import credit_matrix
from . import credit_curve_service


class _BondLike(Protocol):
    asset_id: str
    asset_type: str
    issue_date: date
    maturity_date: date
    coupon_rate: float
    payment_frequency: int
    notional: float
    rating: str | None


@dataclass
class BondCashFlow:
    asset_id: str
    detail: CashFlowDetail


@dataclass
class BondResult:
    asset_id: str
    npv: float
    market_yield: float


@dataclass
class BondPortfolioResult:
    results: list[BondResult]
    cashflows: list[BondCashFlow]


def _resolve_valuation_date(valuation_date: date | None) -> date:
    """미지정 시 Credit Matrix의 최신 평가일을 사용(할인 커브가 존재하는 날짜)."""
    if valuation_date is not None:
        return valuation_date
    dates = credit_matrix.common_dates_xlsx(DATA_DIR)
    return dates[-1]


def price_bonds(bonds: Iterable[_BondLike], valuation_date: date | None = None) -> BondPortfolioResult:
    val_date = _resolve_valuation_date(valuation_date)

    results: list[BondResult] = []
    cashflows: list[BondCashFlow] = []
    for b in bonds:
        remaining_years = max((b.maturity_date - val_date).days / 365.0, 0.0)
        market_yield = credit_curve_service.market_yield_for(
            b.asset_type, b.rating, remaining_years, val_date
        )
        valuation = value_bond(
            asset_id=b.asset_id,
            issue_date=b.issue_date,
            maturity_date=b.maturity_date,
            coupon_rate=b.coupon_rate,
            payment_frequency=b.payment_frequency,
            notional=b.notional,
            market_yield=market_yield,
            val_date=val_date,
        )
        results.append(BondResult(b.asset_id, valuation.npv, market_yield))
        cashflows.extend(BondCashFlow(b.asset_id, c) for c in valuation.cashflows)

    cashflows.sort(key=lambda bcf: bcf.detail.payment_date)
    return BondPortfolioResult(results=results, cashflows=cashflows)
