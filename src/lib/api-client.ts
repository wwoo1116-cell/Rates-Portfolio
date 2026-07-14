/**
 * Typed HTTP client for the IRS Pricer FastAPI backend (irs_pricer/api).
 * Modeled on IRS Pricer_Mock/web/src/lib/api.js's error-shape handling, ported
 * to TypeScript/Next.js conventions (NEXT_PUBLIC_ env var instead of Vite's).
 *
 * The frontend never knows or cares whether the backend resolved a request
 * against its MySQL database or fell back to the bundled Excel files --
 * that failover lives entirely server-side (see market_data_service) and
 * always produces the same JSON response shape either way.
 */
import type {
  BacktestSummaryOut,
  BondCashflowRequest,
  BondCashflowResponse,
  CreditSeriesRequest,
  CreditSeriesResponse,
  CurveRequest,
  CurveResponse,
  DateRangeResponse,
  DbConnectionIn,
  DbConnectionStatusOut,
  DbConnectionTestResult,
  DeltaResponse,
  HistoricalPnlByTradesRequest,
  HistoricalPnlRequest,
  HistoricalPnlResponse,
  HistoricalQuoteResponse,
  InstrumentTaxonomyOut,
  LegacyPositionImportRequest,
  MarketDataResponse,
  MarketDataUploadResponse,
  MtmFairRateRequest,
  MtmFairRateResponse,
  MtmRequest,
  MtmResponse,
  NonBusinessDaysResponse,
  NpvTraceRequest,
  NpvTraceResponse,
  PortfolioDeltaResponse,
  PortfolioPriceRequest,
  PortfolioPriceResponse,
  PositionFairRateRequest,
  PositionFairRateResponse,
  PriceRequest,
  PriceResponse,
  RateHistoryResponse,
  RateSpreadResponse,
  SpotDateResponse,
  SpreadBacktestResponse,
  TenorDateResponse,
  TradeByTenorIn,
  TradeIn,
  TradeOut,
} from "./api-types";

// In dev, default to the backend's standalone uvicorn port. Override via
// NEXT_PUBLIC_API_BASE_URL for any deployment where frontend/backend are on
// different origins (see .env.local.example).
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

const NETWORK_ERROR_MESSAGE = "Cannot reach the pricing server -- confirm it is running.";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// FastAPI's own request validation (422, before a route handler even runs)
// returns `detail` as an array of Pydantic error objects, not a string --
// every other error path (HTTPException) already returns a plain string.
// Without this, an array `detail` renders as "[object Object]"
// (Array.prototype.toString() on objects) instead of the actual per-field
// validation message.
function detailToMessage(detail: unknown, status: number): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((e) => (typeof e === "string" ? e : ((e as { msg?: string })?.msg ?? JSON.stringify(e))))
      .join(", ");
  }
  return `Request failed (HTTP ${status}).`;
}

async function handleResponse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(detailToMessage(body?.detail, res.status), res.status);
  }
  return body as T;
}

// fetch() throws a generic TypeError only for network-level failures --
// server not running, refused connection, CORS, DNS, etc. HTTP error
// responses (4xx/5xx) resolve normally and are handled in handleResponse()
// with the backend's own detail message. Distinguishing the two means the
// UI never shows a bare, unexplained "Failed to fetch".
async function apiGet<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`);
  } catch {
    throw new ApiError(NETWORK_ERROR_MESSAGE, 0);
  }
  return handleResponse<T>(res);
}

async function apiPost<T>(path: string, payload: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new ApiError(NETWORK_ERROR_MESSAGE, 0);
  }
  return handleResponse<T>(res);
}

// Multipart form POST -- deliberately does not set Content-Type, so the
// browser fills in the multipart boundary itself (setting it manually
// produces a malformed request the server can't parse).
async function apiPostForm<T>(path: string, form: FormData): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { method: "POST", body: form });
  } catch {
    throw new ApiError(NETWORK_ERROR_MESSAGE, 0);
  }
  return handleResponse<T>(res);
}

async function apiDelete<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { method: "DELETE" });
  } catch {
    throw new ApiError(NETWORK_ERROR_MESSAGE, 0);
  }
  return handleResponse<T>(res);
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

// ---------------------------------------------------------------------------
// Pricing / curve (hypothetical, not-yet-booked swaps)
// ---------------------------------------------------------------------------

export const pricingApi = {
  curve: (req: CurveRequest) => apiPost<CurveResponse>("/api/curve", req),
  price: (req: PriceRequest) => apiPost<PriceResponse>("/api/price", req),
  delta: (req: PriceRequest) => apiPost<DeltaResponse>("/api/delta", req),
};

// ---------------------------------------------------------------------------
// MTM (single historically-booked swap, ad hoc -- not persisted)
// ---------------------------------------------------------------------------

export const mtmApi = {
  fairRate: (req: MtmFairRateRequest) => apiPost<MtmFairRateResponse>("/api/mtm/fair-rate", req),
  value: (req: MtmRequest) => apiPost<MtmResponse>("/api/mtm", req),
  npvTrace: (req: NpvTraceRequest) => apiPost<NpvTraceResponse>("/api/mtm/npv-trace", req),
  npvTraceForTrade: (tradeId: number, startDate: string, endDate: string) =>
    apiGet<NpvTraceResponse>(`/api/mtm/npv-trace/${tradeId}${qs({ start_date: startDate, end_date: endDate })}`),
};

// ---------------------------------------------------------------------------
// Market data
// ---------------------------------------------------------------------------

export const marketDataApi = {
  dateRange: () => apiGet<DateRangeResponse>("/api/market-data/range"),
  snapshot: (valuationDate: string) => apiGet<MarketDataResponse>(`/api/market-data/${valuationDate}`),
  pushLive: (snapshot: MarketDataResponse) => apiPost<MarketDataResponse>("/api/market-data/live", snapshot),
};

// ---------------------------------------------------------------------------
// Portfolio (N booked swaps against one shared curve)
// ---------------------------------------------------------------------------

export const portfolioApi = {
  fairRate: (req: PositionFairRateRequest) =>
    apiPost<PositionFairRateResponse>("/api/portfolio/fair-rate", req),
  historicalQuote: (startDate: string, maturityDate: string, notional: number, floatSpread = 0) =>
    apiGet<HistoricalQuoteResponse>(
      `/api/portfolio/historical-quote${qs({
        start_date: startDate,
        maturity_date: maturityDate,
        notional,
        float_spread: floatSpread,
      })}`,
    ),
  price: (req: PortfolioPriceRequest) => apiPost<PortfolioPriceResponse>("/api/portfolio/price", req),
  delta: (req: PortfolioPriceRequest) => apiPost<PortfolioDeltaResponse>("/api/portfolio/delta", req),
  historicalPnl: (req: HistoricalPnlRequest) =>
    apiPost<HistoricalPnlResponse>("/api/portfolio/historical-pnl", req),
  historicalPnlByTrades: (req: HistoricalPnlByTradesRequest) =>
    apiPost<HistoricalPnlResponse>("/api/portfolio/historical-pnl/by-trades", req),
};

// ---------------------------------------------------------------------------
// Portfolio Analytics (Aggregated summaries by book/sector)
// ---------------------------------------------------------------------------

export const portfolioAnalyticsApi = {
  pvbpSensitivity: (req: any) => apiPost<any[]>("/api/portfolio/pvbp-sensitivity", req),
  bookDailyPnl: (req: any) => apiPost<any[]>("/api/portfolio/book-daily-pnl", req),
  bookSummary: (req: any) => apiPost<any[]>("/api/portfolio/book-summary", req),
};

// ---------------------------------------------------------------------------
// Trades (persisted trade_specification rows)
// ---------------------------------------------------------------------------

export const tradesApi = {
  list: (asOfDate?: string) => apiGet<TradeOut[]>(`/api/trades${qs({ as_of_date: asOfDate })}`),
  book: (req: TradeIn) => apiPost<TradeOut>("/api/trades", req),
  bookByTenor: (req: TradeByTenorIn) => apiPost<TradeOut>("/api/trades/by-tenor", req),
  cancel: (tradeId: number) => apiDelete<TradeOut>(`/api/trades/${tradeId}`),
  importLegacy: (req: LegacyPositionImportRequest) => apiPost<TradeOut[]>("/api/trades/import-legacy", req),
};

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export const calendarApi = {
  businessDays: (start: string, end: string) =>
    apiGet<NonBusinessDaysResponse>(`/api/calendar/business-days${qs({ start, end })}`),
  tenorDate: (startDate: string, months: number) =>
    apiGet<TenorDateResponse>(`/api/calendar/tenor-date${qs({ start_date: startDate, months })}`),
  spotDate: (valuationDate: string) =>
    apiGet<SpotDateResponse>(`/api/calendar/spot-date${qs({ valuation_date: valuationDate })}`),
};

// ---------------------------------------------------------------------------
// Rate history / spread
// ---------------------------------------------------------------------------

export const rateHistoryApi = {
  history: (start: string, end: string) => apiGet<RateHistoryResponse>(`/api/rate-history${qs({ start, end })}`),
  spread: (start: string, end: string, short: string, long: string) =>
    apiGet<RateSpreadResponse>(`/api/rate-history/spread${qs({ start, end, short, long })}`),
};

// ---------------------------------------------------------------------------
// Credit-curve taxonomy / RV instrument selector
// ---------------------------------------------------------------------------

export const creditCurveApi = {
  taxonomy: () => apiGet<InstrumentTaxonomyOut>("/api/credit-curve/taxonomy"),
  series: (req: CreditSeriesRequest) => apiPost<CreditSeriesResponse>("/api/credit-curve/series", req),
};

// ---------------------------------------------------------------------------
// Bond cash-flow generation (uploaded blotter -> CF schedule + NPV)
// ---------------------------------------------------------------------------

export const bondApi = {
  cashflows: (req: BondCashflowRequest) =>
    apiPost<BondCashflowResponse>("/api/portfolio/bond-cashflows", req),
};

// ---------------------------------------------------------------------------
// Spread backtest (z-score mean reversion, orphaned feature -- no UI consumer
// yet, see MIGRATION_PLAN.md §3/§6.8)
// ---------------------------------------------------------------------------

export interface SpreadBacktestParams {
  start: string;
  end: string;
  short: string;
  long: string;
  lookback?: number;
  entryZ?: number;
  exitZ?: number;
  stopZ?: number;
  costBp?: number;
  notional?: number;
}

export const spreadBacktestApi = {
  run: (p: SpreadBacktestParams) =>
    apiGet<SpreadBacktestResponse>(
      `/api/spread-backtest${qs({
        start: p.start,
        end: p.end,
        short: p.short,
        long: p.long,
        lookback: p.lookback,
        entry_z: p.entryZ,
        exit_z: p.exitZ,
        stop_z: p.stopZ,
        cost_bp: p.costBp,
        notional: p.notional,
      })}`,
    ),
};
export type { BacktestSummaryOut };

// ---------------------------------------------------------------------------
// DB connection settings
// ---------------------------------------------------------------------------

export const dbSettingsApi = {
  status: () => apiGet<DbConnectionStatusOut>("/api/db-settings"),
  test: (req: DbConnectionIn) => apiPost<DbConnectionTestResult>("/api/db-settings/test", req),
  save: (req: DbConnectionIn) => apiPost<DbConnectionStatusOut>("/api/db-settings", req),
};

// ---------------------------------------------------------------------------
// Market data / portfolio upload (mandatory gate before the dashboard)
// ---------------------------------------------------------------------------

export const uploadApi = {
  marketData: async (files: { irsData: File; creditMatrix: File; bokBaseRate: File; portfolioData: File }) => {
    const form = new FormData();
    form.set("irs_data", files.irsData);
    form.set("credit_matrix", files.creditMatrix);
    form.set("bok_base_rate", files.bokBaseRate);
    form.set("portfolio", files.portfolioData);
    
    // Bypass Next.js proxy specifically for large multipart uploads to avoid ECONNRESET / socket hang ups.
    // Use window.location.hostname to ensure the request is routed to the correct server IP
    // without triggering Chrome's Private Network Access block (which happens if we hardcode 127.0.0.1).
    const baseUrl = typeof window !== "undefined" ? `http://${window.location.hostname}:8000` : "http://127.0.0.1:8000";
    const res = await fetch(`${baseUrl}/api/upload/market-data`, {
      method: "POST",
      body: form,
    }).catch(() => {
      throw new ApiError(NETWORK_ERROR_MESSAGE, 0);
    });

    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new ApiError(detailToMessage(body?.detail, res.status), res.status);
    }
    return body as MarketDataUploadResponse;
  },
};

export * from "./api-types";
