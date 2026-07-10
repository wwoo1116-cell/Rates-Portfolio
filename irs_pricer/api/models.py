"""Pydantic request/response models for all API routes."""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

from ..core.market_data import MarketSnapshot, RateQuote


class RateQuoteIn(BaseModel):
    tenor_years: int = Field(gt=0)
    rate: float
    tenor_months: int | None = Field(default=None, gt=0)


class SwapIn(BaseModel):
    tenor_years: int = Field(gt=0)
    notional: float = Field(gt=0)
    fixed_rate: float
    pay_fixed: bool = True


class PriceRequest(BaseModel):
    valuation_date: date
    cd_rate: float
    on_rate: float | None = None
    swap_quotes: list[RateQuoteIn]
    swap: SwapIn


class PriceResponse(BaseModel):
    npv: float
    fixed_leg_pv: float
    float_leg_pv: float
    par_rate: float
    dv01: float


class DeltaBucketOut(BaseModel):
    pillar: str
    delta: float


class DeltaResponse(BaseModel):
    total_delta: float
    buckets: list[DeltaBucketOut]


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
    on_rate: float | None = None
    swap_quotes: list[RateQuoteIn]
    swap: MtmSwapIn


class MtmFairRateRequest(BaseModel):
    valuation_date: date
    cd_rate: float
    on_rate: float | None = None
    swap_quotes: list[RateQuoteIn]
    trade_date: date
    tenor_years: int = Field(gt=0)
    notional: float = Field(gt=0)
    float_spread: float = 0.0


class MtmFairRateResponse(BaseModel):
    fair_rate: float
    maturity_date: date


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


class MarketDataResponse(BaseModel):
    valuation_date: date
    cd_rate: float
    on_rate: float | None = None
    swap_quotes: list[RateQuoteIn]


class CurveRequest(BaseModel):
    valuation_date: date
    cd_rate: float
    on_rate: float | None = None
    swap_quotes: list[RateQuoteIn]


class CurvePointOut(BaseModel):
    tenor_years: float
    zero_rate: float
    discount_factor: float
    is_knot: bool  # tenor carries a real market quote, vs. purely interpolated


class CurveResponse(BaseModel):
    valuation_date: date
    points: list[CurvePointOut]


class DateRangeResponse(BaseModel):
    min_date: date
    max_date: date
    available_dates: list[date]


class NonBusinessDaysResponse(BaseModel):
    non_business_days: list[date]


class TenorDateResponse(BaseModel):
    maturity_date: date


class SpotDateResponse(BaseModel):
    spot_date: date


class PortfolioPositionIn(BaseModel):
    position_id: str
    start_date: date
    maturity_date: date
    notional: float = Field(gt=0)
    fixed_rate: float
    pay_fixed: bool = True
    float_spread: float = 0.0


class TradeIn(BaseModel):
    """Explicit-date trade booking -- same shape as PortfolioPositionIn."""

    position_id: str
    start_date: date
    maturity_date: date
    notional: float = Field(gt=0)
    fixed_rate: float = Field(gt=0)
    pay_fixed: bool = True
    float_spread: float = 0.0
    book: str | None = None
    ticker: str | None = None


class TradeByTenorIn(BaseModel):
    """Tenor-based trade booking -- start/maturity are derived server-side."""

    position_id: str
    trade_date: date
    tenor_months: int = Field(gt=0)
    notional: float = Field(gt=0)
    fixed_rate: float = Field(gt=0)
    pay_fixed: bool = True
    float_spread: float = 0.0
    book: str | None = None
    ticker: str | None = None


class TradeOut(BaseModel):
    trade_id: int
    external_position_id: str
    trade_date: date
    start_date: date
    maturity_date: date
    tenor_months: int | None
    notional: float
    fixed_rate: float
    pay_fixed: bool
    float_spread: float
    float_index: str
    status: str
    book: str | None = None
    ticker: str | None = None


class LegacyPositionImportRequest(BaseModel):
    positions: list[PortfolioPositionIn]


class PortfolioPriceRequest(BaseModel):
    valuation_date: date
    cd_rate: float
    on_rate: float | None = None
    swap_quotes: list[RateQuoteIn]
    positions: list[PortfolioPositionIn] = Field(min_length=1)
    # "true_data": already-reset periods use True Data's real historical
    # CD91D fixing. "ccp": the curve is an independent, user-typed payload
    # with no real fixing history behind it, so an already-reset period is
    # assumed to have fixed at cd_rate itself instead of querying True Data.
    data_source: Literal["true_data", "ccp"] = "true_data"


class PositionFairRateRequest(BaseModel):
    valuation_date: date
    cd_rate: float
    on_rate: float | None = None
    swap_quotes: list[RateQuoteIn]
    start_date: date
    maturity_date: date
    notional: float = Field(gt=0)
    float_spread: float = 0.0
    data_source: Literal["true_data", "ccp"] = "true_data"


class PositionFairRateResponse(BaseModel):
    fair_rate: float


class HistoricalQuoteResponse(BaseModel):
    historical_rate: float


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


class PositionDeltaOut(BaseModel):
    position_id: str
    total_delta: float
    buckets: list[DeltaBucketOut]


class PortfolioDeltaResponse(BaseModel):
    total_delta: float
    buckets: list[DeltaBucketOut]
    position_deltas: list[PositionDeltaOut]


class RateHistoryPointOut(BaseModel):
    valuation_date: date
    cd_rate: float
    on_rate: float | None = None
    base_rate: float | None = None
    tenor_rates: dict[str, float]


class RateHistoryResponse(BaseModel):
    points: list[RateHistoryPointOut]


class SpreadPointOut(BaseModel):
    valuation_date: date
    spread_bp: float


class RateSpreadResponse(BaseModel):
    short: str
    long: str
    points: list[SpreadPointOut]


class BacktestPointOut(BaseModel):
    valuation_date: date
    spread_bp: float
    z_score: float | None = None
    position: int
    daily_pnl: float
    cumulative_pnl: float


class BacktestTradeOut(BaseModel):
    entry_date: date
    exit_date: date
    direction: int
    entry_z: float
    exit_z: float
    entry_spread_bp: float
    exit_spread_bp: float
    pnl: float
    exit_reason: str


class BacktestSummaryOut(BaseModel):
    total_pnl: float
    max_drawdown: float
    win_rate: float | None = None
    sharpe_ratio: float | None = None
    num_trades: int


class SpreadBacktestResponse(BaseModel):
    short: str
    long: str
    lookback: int
    entry_z: float
    exit_z: float
    stop_z: float
    cost_bp: float
    notional: float
    points: list[BacktestPointOut]
    trades: list[BacktestTradeOut]
    summary: BacktestSummaryOut


class HistoricalPnlRequest(BaseModel):
    positions: list[PortfolioPositionIn] = Field(min_length=1)
    start_date: date
    end_date: date
    baseline_date: date | None = None
    # Unlike other requests, no valuation_date/cd_rate/swap_quotes here --
    # market data is resolved per-date server-side (see historical_pnl_service).


class HistoricalPnlByTradesRequest(BaseModel):
    """Cached variant of HistoricalPnlRequest -- references booked
    trade_specification rows by ID instead of carrying full position specs
    inline (see historical_pnl_service.compute_historical_pnl_for_trades)."""

    trade_ids: list[int] = Field(min_length=1)
    start_date: date
    end_date: date
    baseline_date: date | None = None


class PnlPointOut(BaseModel):
    valuation_date: date
    net_npv: float
    payer_npv: float
    receiver_npv: float
    active_position_ids: list[str]
    cumulative_pnl: float


class HistoricalPnlResponse(BaseModel):
    baseline_date: date
    baseline_net_npv: float
    points: list[PnlPointOut]
    skipped_dates: list[date]


class NpvTraceSwapIn(BaseModel):
    trade_date: date
    # Accept float so the frontend can pass exact day-count fractional tenors
    # (e.g. 3.0137 years).  The router rounds to the nearest whole year only
    # when maturity_date is not supplied; when maturity_date IS supplied it
    # overrides tenor_years entirely in the VanillaSwap schedule.
    tenor_years: float = Field(gt=0)
    # Optional exact maturity date from the user's date picker.  Preferred over
    # deriving maturity from tenor_years + relativedelta rounding.
    maturity_date: date | None = None
    notional: float = Field(gt=0)
    fixed_rate: float
    pay_fixed: bool = True
    float_spread: float = 0.0


class NpvTraceRequest(BaseModel):
    swap: NpvTraceSwapIn
    start_date: date
    end_date: date
    # No valuation_date/cd_rate/swap_quotes -- market data is resolved
    # per-date server-side (see npv_trace_service), same convention as
    # HistoricalPnlRequest.


class NpvTracePointOut(BaseModel):
    valuation_date: date
    clean_npv: float
    dirty_npv: float
    daily_pnl: float
    cumulative_pnl: float
    delta: float = 0.0


class NpvTraceResponse(BaseModel):
    trade_date: date
    maturity_date: date
    entry_npv: float
    points: list[NpvTracePointOut]
    skipped_dates: list[date]


class DbConnectionIn(BaseModel):
    host: str
    port: int = 3306
    user: str
    password: str
    database: str


class DbConnectionStatusOut(BaseModel):
    configured: bool
    host: str | None = None
    port: int | None = None
    user: str | None = None
    database: str | None = None
    # Password is never round-tripped back to the frontend -- the settings
    # form always requires it be retyped to change, never displays it.


class DbConnectionTestResult(BaseModel):
    ok: bool
    message: str


def _to_snapshot(request) -> MarketSnapshot:
    """Build a MarketSnapshot from any request carrying valuation_date/cd_rate/swap_quotes."""
    return MarketSnapshot(
        valuation_date=request.valuation_date,
        cd_rate=request.cd_rate,
        swap_quotes=[RateQuote(q.tenor_years, q.rate, q.tenor_months) for q in request.swap_quotes],
        on_rate=getattr(request, "on_rate", None),
    )
