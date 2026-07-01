"""Pydantic request/response models for all API routes."""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

from ..core.market_data import MarketSnapshot, RateQuote

# Keep in sync with irs_pricer.interpolation.VALID_INTERPOLATION_METHODS.
InterpolationMethod = Literal["flat", "linear", "cubic"]


class RateQuoteIn(BaseModel):
    tenor_years: int = Field(gt=0)
    rate: float


class SwapIn(BaseModel):
    tenor_years: int = Field(gt=0)
    notional: float = Field(gt=0)
    fixed_rate: float
    pay_fixed: bool = True


class PriceRequest(BaseModel):
    valuation_date: date
    cd_rate: float
    swap_quotes: list[RateQuoteIn]
    swap: SwapIn
    interpolation_method: InterpolationMethod = "flat"


class PriceResponse(BaseModel):
    npv: float
    fixed_leg_pv: float
    float_leg_pv: float
    par_rate: float
    dv01: float
    interpolation_method: InterpolationMethod


class MtmSwapIn(BaseModel):
    trade_date: date
    tenor_years: int = Field(gt=0)
    notional: float = Field(gt=0)
    fixed_rate: float
    pay_fixed: bool = True
    float_spread: float = 0.0


class MtmRequest(BaseModel):
    valuation_date: date
    cd_rate: float
    swap_quotes: list[RateQuoteIn]
    swap: MtmSwapIn
    interpolation_method: InterpolationMethod = "flat"


class CashFlowDetailOut(BaseModel):
    accrual_start: date
    accrual_end: date
    payment_date: date
    leg: str
    rate: float | None
    is_known: bool
    cashflow: float | None
    pv: float


class MtmResponse(BaseModel):
    clean_npv: float
    dirty_npv: float
    accrued_interest: float
    pv_fixed_leg: float
    pv_floating_leg: float
    telescoping_used: bool
    telescoping_diverged: bool
    cashflows: list[CashFlowDetailOut]
    interpolation_method: InterpolationMethod


class MarketDataResponse(BaseModel):
    valuation_date: date
    cd_rate: float
    swap_quotes: list[RateQuoteIn]


class CurveRequest(BaseModel):
    valuation_date: date
    cd_rate: float
    swap_quotes: list[RateQuoteIn]
    interpolation_method: InterpolationMethod = "flat"


class CurvePointOut(BaseModel):
    tenor_years: float
    zero_rate: float
    discount_factor: float
    is_knot: bool  # tenor carries a real market quote, vs. purely interpolated


class CurveResponse(BaseModel):
    valuation_date: date
    interpolation_method: InterpolationMethod
    points: list[CurvePointOut]


class DateRangeResponse(BaseModel):
    min_date: date
    max_date: date
    available_dates: list[date]


class PortfolioPositionIn(BaseModel):
    position_id: str
    start_date: date
    maturity_date: date
    notional: float = Field(gt=0)
    fixed_rate: float
    pay_fixed: bool = True
    float_spread: float = 0.0


class PortfolioPriceRequest(BaseModel):
    valuation_date: date
    cd_rate: float
    swap_quotes: list[RateQuoteIn]
    positions: list[PortfolioPositionIn] = Field(min_length=1)
    interpolation_method: InterpolationMethod = "flat"


class PositionResultOut(BaseModel):
    position_id: str
    clean_npv: float
    dirty_npv: float
    accrued_interest: float
    pv_fixed_leg: float
    pv_floating_leg: float
    pay_fixed: bool


class PortfolioCashFlowOut(BaseModel):
    position_id: str
    accrual_start: date
    accrual_end: date
    payment_date: date
    leg: str
    rate: float | None
    is_known: bool
    cashflow: float | None
    pv: float


class PortfolioPriceResponse(BaseModel):
    net_npv: float
    payer_npv: float
    receiver_npv: float
    position_results: list[PositionResultOut]
    cashflows: list[PortfolioCashFlowOut]
    interpolation_method: InterpolationMethod


def _to_snapshot(request) -> MarketSnapshot:
    """Build a MarketSnapshot from any request carrying valuation_date/cd_rate/swap_quotes."""
    return MarketSnapshot(
        valuation_date=request.valuation_date,
        cd_rate=request.cd_rate,
        swap_quotes=[RateQuote(q.tenor_years, q.rate) for q in request.swap_quotes],
    )
