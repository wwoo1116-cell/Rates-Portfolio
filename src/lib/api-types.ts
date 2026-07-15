/**
 * TypeScript mirrors of irs_pricer/api/models.py's Pydantic request/response
 * models. Hand-mirrored (no codegen tool exists on either side yet -- see
 * MIGRATION_PLAN.md §6.2) -- keep in sync manually when models.py changes.
 *
 * Dates cross the wire as FastAPI/Pydantic `date` -> JSON strings ("YYYY-MM-DD"),
 * so every `date` field here is typed `string`, not `Date`.
 */

export type DataSource = "true_data" | "ccp";

export interface RateQuoteIn {
  tenor_years: number;
  rate: number;
  tenor_months?: number | null;
}

export interface SwapIn {
  tenor_years: number;
  notional: number;
  fixed_rate: number;
  pay_fixed?: boolean;
}

export interface PriceRequest {
  valuation_date: string;
  cd_rate: number;
  on_rate?: number | null;
  swap_quotes: RateQuoteIn[];
  swap: SwapIn;
}

export interface PriceResponse {
  npv: number;
  fixed_leg_pv: number;
  float_leg_pv: number;
  par_rate: number;
  dv01: number;
}

export interface DeltaBucketOut {
  pillar: string;
  delta: number;
}

export interface DeltaResponse {
  total_delta: number;
  buckets: DeltaBucketOut[];
}

export interface MtmSwapIn {
  trade_date: string;
  tenor_years: number;
  notional: number;
  fixed_rate: number;
  pay_fixed?: boolean;
  float_spread?: number;
}

export interface MtmRequest {
  valuation_date: string;
  cd_rate: number;
  on_rate?: number | null;
  swap_quotes: RateQuoteIn[];
  swap: MtmSwapIn;
}

export interface MtmFairRateRequest {
  valuation_date: string;
  cd_rate: number;
  on_rate?: number | null;
  swap_quotes: RateQuoteIn[];
  trade_date: string;
  tenor_years: number;
  notional: number;
  float_spread?: number;
}

export interface MtmFairRateResponse {
  fair_rate: number;
  maturity_date: string;
}

export interface CashFlowDetailOut {
  accrual_start: string;
  accrual_end: string;
  payment_date: string;
  leg: "fixed" | "floating";
  rate: number | null;
  is_known: boolean;
  cashflow: number | null;
  pv: number;
}

export interface MtmResponse {
  clean_npv: number;
  dirty_npv: number;
  accrued_interest: number;
  pv_fixed_leg: number;
  pv_floating_leg: number;
  telescoping_used: boolean;
  telescoping_diverged: boolean;
  cashflows: CashFlowDetailOut[];
}

export interface MarketDataResponse {
  valuation_date: string;
  cd_rate: number;
  on_rate?: number | null;
  swap_quotes: RateQuoteIn[];
}

export interface CurveRequest {
  valuation_date: string;
  cd_rate: number;
  on_rate?: number | null;
  swap_quotes: RateQuoteIn[];
}

export interface CurvePointOut {
  tenor_years: number;
  zero_rate: number;
  discount_factor: number;
  is_knot: boolean;
}

export interface CurveResponse {
  valuation_date: string;
  points: CurvePointOut[];
}

export interface DateRangeResponse {
  min_date: string;
  max_date: string;
  available_dates: string[];
}

export interface NonBusinessDaysResponse {
  non_business_days: string[];
}

export interface TenorDateResponse {
  maturity_date: string;
}

export interface SpotDateResponse {
  spot_date: string;
}

export interface PortfolioPositionIn {
  position_id: string;
  start_date: string;
  maturity_date: string;
  notional: number;
  fixed_rate: number;
  pay_fixed?: boolean;
  float_spread?: number;
}

export interface TradeIn {
  position_id: string;
  start_date: string;
  maturity_date: string;
  notional: number;
  fixed_rate: number;
  pay_fixed?: boolean;
  float_spread?: number;
  book?: string | null;
  ticker?: string | null;
}

export interface TradeByTenorIn {
  position_id: string;
  trade_date: string;
  tenor_months: number;
  notional: number;
  fixed_rate: number;
  pay_fixed?: boolean;
  float_spread?: number;
  book?: string | null;
  ticker?: string | null;
}

export interface TradeOut {
  trade_id: number;
  external_position_id: string;
  trade_date: string;
  start_date: string;
  maturity_date: string;
  tenor_months: number | null;
  notional: number;
  fixed_rate: number;
  pay_fixed: boolean;
  float_spread: number;
  float_index: string;
  status: string;
  book: string | null;
  ticker: string | null;
}

export interface LegacyPositionImportRequest {
  positions: PortfolioPositionIn[];
}

export interface PortfolioPriceRequest {
  valuation_date: string;
  cd_rate: number;
  on_rate?: number | null;
  swap_quotes: RateQuoteIn[];
  positions: PortfolioPositionIn[];
  data_source?: DataSource;
}

export interface PositionFairRateRequest {
  valuation_date: string;
  cd_rate: number;
  on_rate?: number | null;
  swap_quotes: RateQuoteIn[];
  start_date: string;
  maturity_date: string;
  notional: number;
  float_spread?: number;
  data_source?: DataSource;
}

export interface PositionFairRateResponse {
  fair_rate: number;
}

export interface HistoricalQuoteResponse {
  historical_rate: number;
}

export interface PositionResultOut {
  position_id: string;
  clean_npv: number;
  dirty_npv: number;
  accrued_interest: number;
  pv_fixed_leg: number;
  pv_floating_leg: number;
  pay_fixed: boolean;
}

export interface PortfolioCashFlowOut {
  position_id: string;
  accrual_start: string;
  accrual_end: string;
  payment_date: string;
  leg: "fixed" | "floating";
  rate: number | null;
  is_known: boolean;
  cashflow: number | null;
  pv: number;
}

export interface PortfolioPriceResponse {
  net_npv: number;
  payer_npv: number;
  receiver_npv: number;
  position_results: PositionResultOut[];
  cashflows: PortfolioCashFlowOut[];
}

// ── Bond cash-flow generation (POST /api/portfolio/bond-cashflows) ──
// Hydrated frontend-side from the uploaded blotter (blotter-parser.ts): coupon
// from the 표면이율 column, payment_frequency injected by sector convention. The
// backend does all CF/day-count/NPV math (bond_valuation.py); yields come from
// the Credit Matrix.
export interface BondCashflowIn {
  asset_id: string;
  asset_type: string;         // bond sector: 국고채/통안채/은행채/공사채/여전채/회사채…
  issue_date: string;
  maturity_date: string;
  coupon_rate: number;        // percent, e.g. 3.125
  payment_frequency: number;  // coupons per year (2 = semi-annual, 4 = quarterly)
  notional: number;           // raw KRW
  rating?: string | null;     // credit rating for the Credit Matrix yield; null for 국고채/통안채
}

export interface BondCashflowRequest {
  bonds: BondCashflowIn[];
  valuation_date?: string | null; // defaults server-side to the latest Credit Matrix date
}

export interface BondResultOut {
  asset_id: string;
  npv: number;
  market_yield: number;
}

export interface BondCashflowResponse {
  results: BondResultOut[];
  // Reuses PortfolioCashFlowOut so the Details-panel table renders bonds like
  // IRS. For bonds `leg` is "coupon" | "principal" and `position_id` = asset_id.
  cashflows: PortfolioCashFlowOut[];
}

export interface PositionDeltaOut {
  position_id: string;
  total_delta: number;
  buckets: DeltaBucketOut[];
}

export interface PortfolioDeltaResponse {
  total_delta: number;
  buckets: DeltaBucketOut[];
  position_deltas: PositionDeltaOut[];
}

export interface RateHistoryPointOut {
  valuation_date: string;
  cd_rate: number;
  on_rate?: number | null;
  base_rate?: number | null;
  tenor_rates: Record<string, number>;
}

export interface RateHistoryResponse {
  points: RateHistoryPointOut[];
}

export interface SpreadPointOut {
  valuation_date: string;
  spread_bp: number;
}

export interface RateSpreadResponse {
  short: string;
  long: string;
  points: SpreadPointOut[];
}

// --- Credit-curve taxonomy / RV selector ---------------------------------

export interface TaxonomySectorOut {
  sector: string;
  ratings: string[]; // empty for unrated sectors (국고채) and IRS
  tenors: string[];
}

export interface InstrumentTaxonomyOut {
  sectors: TaxonomySectorOut[];
}

export interface CreditSeriesLegIn {
  sector: string;
  rating?: string | null;
  tenor: string;
}

export interface CreditSeriesRequest {
  legs: CreditSeriesLegIn[];
  start_date?: string | null;
  end_date?: string | null;
}

export interface CreditSeriesPointOut {
  valuation_date: string;
  value: number;
}

export interface CreditSeriesResultOut {
  sector: string;
  rating?: string | null;
  tenor: string;
  points: CreditSeriesPointOut[];
  error?: string | null;
}

export interface CreditSeriesResponse {
  results: CreditSeriesResultOut[];
}

export interface BacktestPointOut {
  valuation_date: string;
  spread_bp: number;
  z_score: number | null;
  position: number;
  daily_pnl: number;
  cumulative_pnl: number;
}

export interface BacktestTradeOut {
  entry_date: string;
  exit_date: string;
  direction: number;
  entry_z: number;
  exit_z: number;
  entry_spread_bp: number;
  exit_spread_bp: number;
  pnl: number;
  exit_reason: string;
}

export interface BacktestSummaryOut {
  total_pnl: number;
  max_drawdown: number;
  win_rate: number | null;
  sharpe_ratio: number | null;
  num_trades: number;
}

export interface SpreadBacktestResponse {
  short: string;
  long: string;
  lookback: number;
  entry_z: number;
  exit_z: number;
  stop_z: number;
  cost_bp: number;
  notional: number;
  points: BacktestPointOut[];
  trades: BacktestTradeOut[];
  summary: BacktestSummaryOut;
}

export interface HistoricalPnlRequest {
  positions: PortfolioPositionIn[];
  start_date: string;
  end_date: string;
  baseline_date?: string | null;
}

export interface HistoricalPnlByTradesRequest {
  trade_ids: number[];
  start_date: string;
  end_date: string;
  baseline_date?: string | null;
}

export interface PnlPointOut {
  valuation_date: string;
  net_npv: number;
  payer_npv: number;
  receiver_npv: number;
  active_position_ids: string[];
  cumulative_pnl: number;
}

export interface HistoricalPnlResponse {
  baseline_date: string;
  baseline_net_npv: number;
  points: PnlPointOut[];
  skipped_dates: string[];
}

export interface NpvTraceSwapIn {
  trade_date: string;
  tenor_years: number;
  maturity_date?: string;
  notional: number;
  fixed_rate: number;
  pay_fixed?: boolean;
  float_spread?: number;
}

export interface NpvTraceRequest {
  swap: NpvTraceSwapIn;
  start_date: string;
  end_date: string;
}

export interface NpvTracePointOut {
  valuation_date: string;
  clean_npv: number;
  dirty_npv: number;
  daily_pnl: number;
  cumulative_pnl: number;
  delta: number;
}

export interface NpvTraceResponse {
  trade_date: string;
  maturity_date: string;
  entry_npv: number;
  points: NpvTracePointOut[];
  skipped_dates: string[];
}

export interface DbConnectionIn {
  host: string;
  port?: number;
  user: string;
  password: string;
  database: string;
}

export interface DbConnectionStatusOut {
  configured: boolean;
  host?: string | null;
  port?: number | null;
  user?: string | null;
  database?: string | null;
}

export interface DbConnectionTestResult {
  ok: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Market data / portfolio upload
// ---------------------------------------------------------------------------

export interface FileUploadResult {
  status: "ready" | "error";
  message?: string | null;
  rows?: number | null;
  min_date?: string | null;
  max_date?: string | null;
}

export interface ParsedPositionOut {
  instrument_type: "bond" | "irs";
  position_id: string;
  sector: string;
  book: string;
  start_date: string | null;
  maturity_date: string | null;
  notional: number | null;
  fixed_rate: number | null;
  pay_fixed: boolean | null;
  float_spread: number | null;
  evaluation_amount: number | null;
  remaining_days: number | null;
  tenor_bucket: string | null;
  entry_yield: number | null;
  mtm_yield: number | null;
  duration: number | null;
  pvbp: number | null;
  // Static bond params. Needed for the backend to build a coupon schedule and
  // therefore to revalue a bond at a rolled valuation date (= compute theta).
  // Null for swaps, and null for bonds whose blotter row had no issue date --
  // the backend falls back to an analytic split for those rather than
  // dropping them.
  issue_date: string | null;
  coupon_rate: number | null;
  payment_frequency: number | null;
  rating: string | null;
}

/** Freshness of one quote source. Swaps price off IRS/CD, bonds off the Credit
 * Matrix, and the two have genuinely different coverage — so "is the market
 * open?" has no single answer and the UI shows each source's own state. */
export interface QuoteSource {
  source: string;
  /** Latest date this source has any data for. Null if unreadable. */
  latest: string | null;
  /** Whether this source has data for `as_of` specifically. */
  has_as_of: boolean;
}

export interface DailyPnlFigures {
  theta: number;
  /** Null means NOT KNOWN — this row's source has no quotes for `as_of` yet.
   * It is never 0-for-unknown: 0 would assert "quotes arrived, nothing moved",
   * a different and false claim. Render null as an em-dash, never as a number. */
  mtm: number | null;
  /** theta + whatever mtm is known. Equals mtm + theta exactly when
   * `mtm_complete`; otherwise it's a PARTIAL figure and must be marked as such
   * rather than shown as a finished total. */
  total: number;
  /** Funding is deliberately outside `total`: it's a financing cost, not a
   * change in NPV. */
  funding: number;
  /** False when any constituent position's MtM is still unknown. */
  mtm_complete: boolean;
}

export interface DailyPnlBookRow extends DailyPnlFigures {
  book: string;
}

/** POST /api/portfolio/book-daily-pnl.
 *
 * An envelope rather than a bare row list because `as_of`/`quote_sources` are
 * properties of the calculation, not of any one row.
 *
 * This is the seam for the future live-quote feed: when a source starts
 * supplying `as_of` data, its `has_as_of` flips and the corresponding `mtm`
 * values fill in — no change needed on this side. */
export interface BookDailyPnlResponse {
  as_of: string;
  quote_sources: QuoteSource[];
  daily_pnl: Omit<DailyPnlFigures, "funding">;
  by_book: DailyPnlBookRow[];
}

export interface MarketDataUploadResponse {
  success: boolean;
  irs_data: FileUploadResult;
  credit_matrix: FileUploadResult;
  bok_base_rate: FileUploadResult;
  portfolio: FileUploadResult;
  positions: ParsedPositionOut[];
}

export interface PortfolioAnalyticsRequest {
  valuation_date: string;
  cd_rate: number;
  on_rate?: number | null;
  swap_quotes: RateQuoteIn[];
  positions: ParsedPositionOut[];
}

export interface PriorSnapshotRequest extends PortfolioAnalyticsRequest {
  prior_valuation_date: string;
  prior_cd_rate: number;
  prior_on_rate?: number | null;
  prior_swap_quotes: RateQuoteIn[];
}

export interface BookSummaryRequest extends PortfolioAnalyticsRequest {
  daily_pnl_by_book: any[]; // generic dict list
}

// ---------------------------------------------------------------------------
// Allocation history (POST /api/portfolio/allocation-history)
// ---------------------------------------------------------------------------

/** One bond, with the static params blotter-parser.ts hydrates. Carries no
 *  curve: unlike the other analytics endpoints, this one loads each snapshot's
 *  market data server-side. */
export interface AllocationHistoryPositionIn {
  position_id: string;
  book: string;
  sector: string;
  issue_date: string; // "YYYY-MM-DD"
  maturity_date: string;
  coupon_rate: number; // percent, e.g. 3.125
  payment_frequency: number; // coupons per year
  notional: number; // raw KRW
  rating: string | null;
}

export interface AllocationHistoryRequest {
  positions: AllocationHistoryPositionIn[];
  book?: string | null; // e.g. "RP Fund"; omit for all books
  as_of_date?: string | null; // defaults to the latest available market date
}

export type AllocationAnchorKey =
  | "lastYearEnd"
  | "lastMonthEnd"
  | "lastWeekEnd"
  | "prevDay"
  | "current";

/** One x-axis column. Series shares live alongside the metadata under their own
 *  (Korean) names -- they can't collide with the English metadata keys. Read
 *  them via the sibling `keys` array; values are percentages summing to 100
 *  (0 for an unresolved column). */
export interface AllocationRow {
  key: AllocationAnchorKey;
  label: string;
  /** null when the anchor predates all available market data. */
  valuationDate: string | null;
  /** Bonds this column is actually over. Older columns are legitimately
   *  smaller -- holdings bought since then did not exist yet. */
  positionCount: number;
  [series: string]: string | number | null;
}

export interface AllocationSeries {
  /** Stable stack/colour order, led by the current column's share. */
  keys: string[];
  rows: AllocationRow[];
}

export interface AllocationHistoryResponse {
  asOfDate: string;
  totalPositions: number;
  /** Bonds excluded from every column because their sector/rating has no credit
   *  curve. Distinct from a column's positionCount. */
  unpriceablePositions: number;
  /** Share of portfolio PVBP (risk), not 평가금액 -- value share barely moves
   *  over a constant book. */
  sector: AllocationSeries;
  /** Share of 평가금액, bucketed by remaining maturity at each column's date. */
  maturity: AllocationSeries;
}
