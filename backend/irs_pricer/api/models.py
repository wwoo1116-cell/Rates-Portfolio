"""Pydantic request/response models for all API routes."""

from __future__ import annotations

from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, Field

from ..core.market_data import MarketSnapshot, RateQuote

# Rates cross this boundary as DECIMALS (0.0305 = 3.05%). Feeding the percent
# form (3.05) reads as 305%, and the failure that follows is silent by
# construction: the par rate lands outside the brentq bracket [-0.10, 1.00] in
# quant_engine.bootstrap_zero_curve, the solver's failure is caught, and the
# node falls back to `r_T = -log(1e-12)/T` -- i.e. the discount factor is
# pinned to a 1e-12 floor from ~1.5Y out (measured: 10Y DF 0.667 -> 1e-12).
# Nothing raises. The long end is economically annihilated, the KRD there
# vanishes, and the caller gets a confident, wrong number back.
# These bounds exist to turn that silent corruption into a 422.
#
# The 0.30 (=30%) ceiling is deliberately far above any plausible KRW rate: it
# is here to catch a unit error, not to express a view on the market, so stress
# scenarios stay expressible. It does not catch a percent-typed value that
# happens to fall under 30% (0.25 meaning 25bp reads as a valid 25%) -- that
# ambiguity is unresolvable at this layer, but the realistic ~3.0 case is not.
# The floor allows genuinely negative rates without allowing -305%.
#
# NOT for percent-convention fields (BondCashflowIn.coupon_rate) or basis
# points (funding_spread_bp).
DecimalRate = Annotated[float, Field(ge=-0.10, le=0.30)]

# Same ceiling, but keeps an existing `gt=0` where a field already had one.
PositiveDecimalRate = Annotated[float, Field(gt=0, le=0.30)]


class RateQuoteIn(BaseModel):
    tenor_years: int = Field(gt=0)
    rate: DecimalRate
    tenor_months: int | None = Field(default=None, gt=0)


class SwapIn(BaseModel):
    tenor_years: int = Field(gt=0)
    notional: float = Field(gt=0)
    fixed_rate: DecimalRate
    pay_fixed: bool = True


class PriceRequest(BaseModel):
    valuation_date: date
    cd_rate: DecimalRate
    on_rate: DecimalRate | None = None
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
    fixed_rate: DecimalRate
    pay_fixed: bool = True
    float_spread: DecimalRate = 0.0


class MtmRequest(BaseModel):
    valuation_date: date
    cd_rate: DecimalRate
    on_rate: DecimalRate | None = None
    swap_quotes: list[RateQuoteIn]
    swap: MtmSwapIn


class MtmFairRateRequest(BaseModel):
    valuation_date: date
    cd_rate: DecimalRate
    on_rate: DecimalRate | None = None
    swap_quotes: list[RateQuoteIn]
    trade_date: date
    tenor_years: int = Field(gt=0)
    notional: float = Field(gt=0)
    float_spread: DecimalRate = 0.0


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
    # Dual-use: response model of GET /api/market-data/{valuation_date} AND
    # request body of POST /api/market-data/live. The DecimalRate bound
    # therefore also asserts the loaders never hand back percent-scaled rates
    # -- pinned at test time by test_api_robustness.py's real-workbook canary
    # so it surfaces there rather than as a runtime ResponseValidationError.
    valuation_date: date
    cd_rate: DecimalRate
    on_rate: DecimalRate | None = None
    swap_quotes: list[RateQuoteIn]


class CurveRequest(BaseModel):
    valuation_date: date
    cd_rate: DecimalRate
    on_rate: DecimalRate | None = None
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
    fixed_rate: DecimalRate
    pay_fixed: bool = True
    float_spread: DecimalRate = 0.0


class ParsedPositionOut(BaseModel):
    instrument_type: Literal["bond", "irs"]
    position_id: str
    sector: str
    book: str
    start_date: date | None = None
    maturity_date: date | None = None
    notional: float | None = None
    fixed_rate: float | None = None
    pay_fixed: bool | None = None
    float_spread: float | None = None
    evaluation_amount: float | None = None
    remaining_days: int | None = None
    tenor_bucket: str | None = None
    entry_yield: float | None = None
    mtm_yield: float | None = None
    duration: float | None = None
    pvbp: float | None = None
    # 채권 정적 파라미터. blotter-parser.ts가 이미 채워 두고 있고
    # /api/portfolio/allocation-history에는 보내던 값들이다(AllocationHistoryPositionIn
    # 참고). book-daily-pnl이 채권을 실제로 재평가하려면(= 세타를 구하려면) 쿠폰
    # 스케줄이 필요하고, 그러려면 이 값들이 있어야 한다.
    #
    # 전부 Optional: 스왑은 해당이 없고, 블로터에 발행일이 비어 오는 채권도 실제로
    # 있다. 없으면 build_book_daily_pnl이 해석적 폴백으로 내려갈 뿐 포지션이 손익에서
    # 사라지지는 않는다. Optional이라 이 필드를 안 보내는 기존 호출과도 하위호환.
    issue_date: date | None = None
    coupon_rate: float | None = None      # 퍼센트, e.g. 3.125 (표면이율)
    payment_frequency: int | None = None  # 2 (국고/통안) 또는 4 (크레딧)
    rating: str | None = None             # 국고채/통안채는 None


class TradeIn(BaseModel):
    """Explicit-date trade booking -- same shape as PortfolioPositionIn."""

    position_id: str
    start_date: date
    maturity_date: date
    notional: float = Field(gt=0)
    fixed_rate: PositiveDecimalRate
    pay_fixed: bool = True
    float_spread: DecimalRate = 0.0
    book: str | None = None
    ticker: str | None = None


class TradeByTenorIn(BaseModel):
    """Tenor-based trade booking -- start/maturity are derived server-side."""

    position_id: str
    trade_date: date
    tenor_months: int = Field(gt=0)
    notional: float = Field(gt=0)
    fixed_rate: PositiveDecimalRate
    pay_fixed: bool = True
    float_spread: DecimalRate = 0.0
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
    cd_rate: DecimalRate
    on_rate: DecimalRate | None = None
    swap_quotes: list[RateQuoteIn]
    positions: list[PortfolioPositionIn] = Field(min_length=1)
    # "true_data": already-reset periods use True Data's real historical
    # CD91D fixing. "ccp": the curve is an independent, user-typed payload
    # with no real fixing history behind it, so an already-reset period is
    # assumed to have fixed at cd_rate itself instead of querying True Data.
    data_source: Literal["true_data", "ccp"] = "true_data"


class PositionFairRateRequest(BaseModel):
    valuation_date: date
    cd_rate: DecimalRate
    on_rate: DecimalRate | None = None
    swap_quotes: list[RateQuoteIn]
    start_date: date
    maturity_date: date
    notional: float = Field(gt=0)
    float_spread: DecimalRate = 0.0
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


class BondCashflowIn(BaseModel):
    """One uploaded bond, hydrated frontend-side (blotter-parser.ts): coupon from
    the 표면이율 column, payment_frequency injected by sector convention. The
    backend does all CF/day-count/NPV math from these static fields."""

    asset_id: str
    asset_type: str                        # bond sector: 국고채/통안채/은행채/공사채/여전채/회사채…
    issue_date: date
    maturity_date: date
    coupon_rate: float                     # percent, e.g. 3.125
    payment_frequency: int = Field(gt=0)   # coupons per year (2 = semi-annual, 4 = quarterly)
    notional: float = Field(gt=0)          # raw KRW
    rating: str | None = None              # credit rating for the Credit Matrix yield; None for 국고채/통안채


class BondCashflowRequest(BaseModel):
    bonds: list[BondCashflowIn] = Field(min_length=1)
    valuation_date: date | None = None     # defaults to the latest Credit Matrix date


class BondResultOut(BaseModel):
    asset_id: str
    npv: float
    market_yield: float                    # decimal yield used to discount (from Credit Matrix)


class BondCashflowResponse(BaseModel):
    results: list[BondResultOut]
    # Reuses PortfolioCashFlowOut so the frontend renders bond CF in the same
    # Details-panel table as IRS (position_id carries the asset_id).
    cashflows: list[PortfolioCashFlowOut]


class AllocationHistoryPositionIn(BaseModel):
    """One uploaded bond for the allocation-history charts. Same static-field
    contract as BondCashflowIn (hydrated frontend-side by blotter-parser.ts),
    plus `book` for the RP Fund filter and `sector` in the blotter's own
    vocabulary (loaders/portfolio.py:_BOND_SECTOR_MAP).

    Deliberately a separate model from ParsedPositionOut rather than an
    extension of it: that type is mirrored in three places (models.py, the
    PositionData dataclass, and _to_position_data) and every added field has to
    land in all three. These charts are bond-only and need no IRS legs, so a
    dedicated model sidesteps the mirror entirely.
    """

    position_id: str
    book: str
    sector: str                            # 국고채/통안채/특은채/시은채/공사채/여전채/회사채/기타
    issue_date: date
    maturity_date: date
    coupon_rate: float                     # percent, e.g. 3.125
    payment_frequency: int = Field(gt=0)   # coupons per year (2 = semi-annual, 4 = quarterly)
    notional: float = Field(gt=0)          # raw KRW
    rating: str | None = None              # None for 국고채/통안채


class AllocationHistoryRequest(BaseModel):
    positions: list[AllocationHistoryPositionIn]
    book: str | None = None                # filter, e.g. "RP Fund"; None = all books
    as_of_date: date | None = None         # defaults to the latest available market date


class PeriodPnlFigureOut(BaseModel):
    """한 (북, 기간)의 재평가 기간 손익.

    `pnl=None`은 0이 아니라 **모름/해당없음**이다: 기준일이 데이터 범위 밖이거나
    (그때 `baseline_date`도 None), 두 시점 모두 가격산출 가능한 채권이 하나도
    없다는 뜻. 0으로 채우면 "재평가했더니 안 움직였다"는 거짓 주장이 된다 --
    book-daily-pnl의 mtm=None 규약과 동일하게 화면에는 "—"로 나가야 한다.

    합계는 populated rows만 합산한다: excluded_not_held(기준일 당시 미발행/이미
    만기 -- 방법론상 예상되는 제외)와 excluded_unpriceable(커브 부재 -- 데이터
    결함, complete=False)은 pnl에 0으로도 안 들어간다. 자세한 규약은
    portfolio_analytics_service._period_figure docstring.
    """
    baseline_date: date | None
    pnl: float | None
    included_positions: int
    excluded_not_held: int
    excluded_unpriceable: int
    complete: bool


class PeriodPnlRowOut(BaseModel):
    book: str                # 북 이름, 마지막 행은 "Total"
    wtd: PeriodPnlFigureOut  # vs lastWeekEnd  (지난주 마지막 영업일)
    mtd: PeriodPnlFigureOut  # vs lastMonthEnd (지난달 마지막 영업일)
    ytd: PeriodPnlFigureOut  # vs lastYearEnd  (작년 마지막 영업일)


class PeriodPnlResponse(BaseModel):
    """POST /api/portfolio/period-pnl. 현재 북을 과거 기준일로 재평가한
    **가상** 기간 손익 -- 실현 손익이 아니다. UI는 배분 차트와 같은 재평가
    캐비앳을 반드시 달아야 한다."""
    as_of: date
    rows: list[PeriodPnlRowOut]


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


# --- Credit-curve taxonomy / RV selector ---------------------------------

class TaxonomySectorOut(BaseModel):
    sector: str
    ratings: list[str]  # empty for unrated sectors (국고채) and IRS
    tenors: list[str]


class InstrumentTaxonomyOut(BaseModel):
    sectors: list[TaxonomySectorOut]


class CreditSeriesLegIn(BaseModel):
    sector: str
    rating: str | None = None  # None/omitted for unrated sectors
    tenor: str


class CreditSeriesRequest(BaseModel):
    legs: list[CreditSeriesLegIn]
    start_date: date | None = None
    end_date: date | None = None


class CreditSeriesPointOut(BaseModel):
    valuation_date: date
    value: float


class CreditSeriesResultOut(BaseModel):
    sector: str
    rating: str | None = None
    tenor: str
    points: list[CreditSeriesPointOut]
    error: str | None = None  # set (with empty points) if this leg couldn't resolve


class CreditSeriesResponse(BaseModel):
    results: list[CreditSeriesResultOut]


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
    fixed_rate: DecimalRate
    pay_fixed: bool = True
    float_spread: DecimalRate = 0.0


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
    # SIM2-7 (additive) — historical funding basis at this date and the
    # cumulative funding cost (negative) accrued on notional; see
    # services/funding_basis.py.
    funding_rate: float = 0.0
    cumulative_funding: float = 0.0


class FixingWarningOut(BaseModel):
    """A CD-fixing data-quality event (engine/fixings.py): a period whose
    fixing date F(R) is a Seoul business day had no exact print in the store,
    so the last available fixing <= F(R) was substituted (ffill), or nothing
    was available at all (resolved_date/rate = null -> forward fallback)."""

    reset_date: date
    fixing_date: date
    resolved_date: date | None = None
    rate: float | None = None


class NpvTraceResponse(BaseModel):
    trade_date: date
    maturity_date: date
    entry_npv: float
    points: list[NpvTracePointOut]
    skipped_dates: list[date]
    # Empty on a healthy fixing store; additive, so older clients ignore it.
    fixing_warnings: list[FixingWarningOut] = []


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


class FileUploadResult(BaseModel):
    status: Literal["ready", "error"]
    message: str | None = None
    rows: int | None = None
    min_date: date | None = None
    max_date: date | None = None


class MarketDataUploadResponse(BaseModel):
    success: bool
    irs_data: FileUploadResult
    credit_matrix: FileUploadResult
    bok_base_rate: FileUploadResult
    portfolio: FileUploadResult
    # Parsed from the portfolio file on success, empty otherwise. Not
    # persisted server-side (no DB in this deployment) -- the frontend loads
    # these into its own client-side manual-positions-store.ts.
    positions: list[ParsedPositionOut] = Field(default_factory=list)


def _to_snapshot(request) -> MarketSnapshot:
    """Build a MarketSnapshot from any request carrying valuation_date/cd_rate/swap_quotes."""
    return MarketSnapshot(
        valuation_date=request.valuation_date,
        cd_rate=request.cd_rate,
        swap_quotes=[RateQuote(q.tenor_years, q.rate, q.tenor_months) for q in request.swap_quotes],
        on_rate=getattr(request, "on_rate", None),
    )
