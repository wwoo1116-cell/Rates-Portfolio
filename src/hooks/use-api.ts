/**
 * TanStack Query hooks wrapping api-client.ts. Thin by design: components
 * pick the pieces they need rather than a single monolithic "portfolio data"
 * hook, since different tabs (Portfolio Management vs. Home's heatmap vs.
 * Backtest) each need a different subset/cadence of this data.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  calendarApi,
  creditCurveApi,
  marketDataApi,
  mtmApi,
  portfolioAnalyticsApi,
  portfolioApi,
  rateHistoryApi,
  spreadBacktestApi,
  tradesApi,
  type CreditSeriesLegIn,
  type HistoricalPnlRequest,
  type NpvTraceRequest,
  type PortfolioPriceRequest,
  type PositionFairRateRequest,
  type SpreadBacktestParams,
  type TradeByTenorIn,
  type TradeIn,
} from "@/lib/api-client";

const queryKeys = {
  trades: (asOfDate?: string) => ["trades", asOfDate ?? "active"] as const,
  marketDataRange: () => ["market-data", "range"] as const,
  marketDataSnapshot: (valuationDate: string) => ["market-data", "snapshot", valuationDate] as const,
  spotDate: (valuationDate: string) => ["calendar", "spot-date", valuationDate] as const,
  portfolioPrice: (req: PortfolioPriceRequest | undefined) => ["portfolio", "price", req] as const,
  portfolioDelta: (req: PortfolioPriceRequest | undefined) => ["portfolio", "delta", req] as const,
  historicalPnl: (req: HistoricalPnlRequest | undefined) => ["portfolio", "historical-pnl", req] as const,
  rateHistory: (start: string, end: string) => ["rate-history", start, end] as const,
  positionMtmHistory: (req: NpvTraceRequest | null) => ["mtm", "npv-trace", req] as const,
  creditTaxonomy: () => ["credit-curve", "taxonomy"] as const,
  creditSeries: (legs: CreditSeriesLegIn[], start: string, end: string) =>
    ["credit-curve", "series", legs, start, end] as const,
  spreadBacktest: (params: SpreadBacktestParams) => ["spread-backtest", params] as const,
};

/**
 * DB-trades source toggle (owner decision, Session 5 / DIAGNOSIS_REPORT Open
 * Question 4). The `trade_specification` table doesn't exist in the running
 * MySQL (alembic migrations unapplied), so GET /api/trades 500s twice per
 * Portfolio load while contributing zero rows. Until the DB decision lands,
 * the source is off by default and the ledger is the two client stores.
 *
 * Re-enable: apply the migrations (`alembic upgrade head` in IRS Pricer_Mock),
 * then set NEXT_PUBLIC_TRADES_SOURCE_ENABLED=true in .env.local and restart
 * the dev server. The backend route and migrations are intentionally intact.
 */
export const TRADES_SOURCE_ENABLED =
  process.env.NEXT_PUBLIC_TRADES_SOURCE_ENABLED === "true";

export function useTrades(asOfDate?: string) {
  return useQuery({
    queryKey: queryKeys.trades(asOfDate),
    queryFn: () => tradesApi.list(asOfDate),
    // Disabled ≙ today's failure mode minus the noise: data stays undefined,
    // both consumers coalesce to [] (zero DB rows), isLoading/isError false.
    enabled: TRADES_SOURCE_ENABLED,
  });
}

export function useBookTrade() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: TradeIn) => tradesApi.book(req),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["trades"] }),
  });
}

export function useBookTradeByTenor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: TradeByTenorIn) => tradesApi.bookByTenor(req),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["trades"] }),
  });
}

export function useCancelTrade() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tradeId: number) => tradesApi.cancel(tradeId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["trades"] }),
  });
}

export function useMarketDataRange() {
  return useQuery({
    queryKey: queryKeys.marketDataRange(),
    queryFn: () => marketDataApi.dateRange(),
    staleTime: 5 * 60_000,
  });
}

/** Funding base rate — the manually-maintained policy constant, served by the
 * backend as the single source (iv4 T5). NOT the repo's BOK series: that
 * series lags MPC decisions, and deriving funding from it put Home 25bp off
 * the Simulation tab on decision day. */
export function useFundingRate() {
  return useQuery({
    queryKey: ["portfolio", "funding-rate"] as const,
    queryFn: () => portfolioAnalyticsApi.fundingRate(),
    staleTime: 5 * 60_000,
  });
}

export function useMarketDataSnapshot(valuationDate: string | undefined) {
  return useQuery({
    queryKey: queryKeys.marketDataSnapshot(valuationDate ?? ""),
    queryFn: () => marketDataApi.snapshot(valuationDate as string),
    enabled: Boolean(valuationDate),
  });
}

/** Composition every "live" view needs before it can price/risk anything: the
 * most recent date the backend has market data for, plus that date's full
 * snapshot (cd_rate/on_rate/swap_quotes). Shared by Portfolio Management
 * (Phase 3) and Home's status view/risk heatmap (Phase 4/5) so each doesn't
 * re-wire the same range->snapshot lookup independently. */
export function useLatestMarketSnapshot() {
  const rangeQuery = useMarketDataRange();
  const latestDate = rangeQuery.data?.max_date;
  const snapshotQuery = useMarketDataSnapshot(latestDate);
  return {
    snapshot: snapshotQuery.data,
    isLoading: rangeQuery.isLoading || snapshotQuery.isLoading,
    isError: rangeQuery.isError || snapshotQuery.isError,
  };
}

export function useSpotDate(valuationDate: string | undefined) {
  return useQuery({
    queryKey: queryKeys.spotDate(valuationDate ?? ""),
    queryFn: () => calendarApi.spotDate(valuationDate as string),
    enabled: Boolean(valuationDate),
    staleTime: 5 * 60_000,
  });
}

/** Portfolio price/delta are mutations, not queries: the request body (curve
 * snapshot + full position list + data_source) is assembled fresh by the
 * caller on every valuation-date/fixings change, not cached by a stable key. */
export function usePortfolioPrice() {
  return useMutation({
    mutationFn: (req: PortfolioPriceRequest) => portfolioApi.price(req),
  });
}

export function usePortfolioDelta() {
  return useMutation({
    mutationFn: (req: PortfolioPriceRequest) => portfolioApi.delta(req),
  });
}

/** Read form of portfolioApi.price, for views that derive NPV straight from
 * current trades + market data rather than an explicit user action (e.g. the
 * Portfolio Management grid's NPV column, Phase 3). `req` is undefined until
 * both the trade list and a market snapshot have loaded -- the query stays
 * disabled until then. */
export function usePortfolioPriceQuery(req: PortfolioPriceRequest | undefined) {
  return useQuery({
    queryKey: queryKeys.portfolioPrice(req),
    queryFn: () => portfolioApi.price(req as PortfolioPriceRequest),
    enabled: Boolean(req),
  });
}

/** Read form of portfolioApi.delta, for Home's Tenor x DV01 risk heatmap
 * (Phase 4) -- same derive-from-current-state rationale as usePortfolioPriceQuery. */
export function usePortfolioDeltaQuery(req: PortfolioPriceRequest | undefined) {
  return useQuery({
    queryKey: queryKeys.portfolioDelta(req),
    queryFn: () => portfolioApi.delta(req as PortfolioPriceRequest),
    enabled: Boolean(req),
  });
}

/** Read form of portfolioApi.historicalPnl, for Home's minimal status view (Phase 5). */
export function useHistoricalPnlQuery(req: HistoricalPnlRequest | undefined) {
  return useQuery({
    queryKey: queryKeys.historicalPnl(req),
    queryFn: () => portfolioApi.historicalPnl(req as HistoricalPnlRequest),
    enabled: Boolean(req),
  });
}

/** Daily CD91D/O-N/BOK-base/IRS-tenor rate series for Home's rate-history
 * chart -- the same backend endpoint the old IRS Pricer_Mock/web app's
 * Overview RV dashboard used, ported here as its first real frontend
 * consumer in this app. */
export function useRateHistory(start: string, end: string) {
  return useQuery({
    queryKey: queryKeys.rateHistory(start, end),
    queryFn: () => rateHistoryApi.history(start, end),
    enabled: Boolean(start && end),
  });
}

/** Static instrument taxonomy (sector -> ratings -> tenors) for the RV
 * selector dropdowns. Fetched once; the tree never changes at runtime. */
export function useCreditCurveTaxonomy() {
  return useQuery({
    queryKey: queryKeys.creditTaxonomy(),
    queryFn: () => creditCurveApi.taxonomy(),
    staleTime: Infinity,
  });
}

/** Batch time-series fetch for the selected credit_matrix-backed legs
 * (국고채 + the four rated sectors). IRS legs are NOT sent here -- they're
 * resolved client-side from useRateHistory's full-curve data. Re-fetches
 * whenever the leg list or date range changes; disabled when there are no
 * credit legs to fetch. */
export function useCreditCurveSeries(legs: CreditSeriesLegIn[], start: string, end: string) {
  return useQuery({
    queryKey: queryKeys.creditSeries(legs, start, end),
    queryFn: () => creditCurveApi.series({ legs, start_date: start, end_date: end }),
    enabled: legs.length > 0 && Boolean(start && end),
  });
}

/** Hypothetical-swap PnL trace from trade_date to end_date (services/
 * npv_trace_service.py) -- a mutation since it's triggered by an explicit
 * "trace this hypothetical trade" user action (Home's rate-history chart
 * date-click interaction), not derived from ambient state. */
export function useNpvTrace() {
  return useMutation({
    mutationFn: (req: NpvTraceRequest) => mtmApi.npvTrace(req),
  });
}

/** Real historical MTM (clean_npv) trace for an already-booked position --
 * unlike useNpvTrace() above (a mutation for an ad hoc hypothetical trade),
 * this is derived from ambient state (whichever position is selected in the
 * Portfolio grid), so it's a query: re-fetches automatically when the
 * request (i.e. the selected position) changes. `req: null` means "no
 * position selected" or "this position can't be priced" (bonds have no
 * pricing engine) -- disables the query rather than firing a bad request. */
export function usePositionMtmHistory(req: NpvTraceRequest | null) {
  return useQuery({
    queryKey: queryKeys.positionMtmHistory(req),
    queryFn: () => mtmApi.npvTrace(req as NpvTraceRequest),
    enabled: req !== null,
  });
}

export function usePositionFairRate() {
  return useMutation({
    mutationFn: (req: PositionFairRateRequest) => portfolioApi.fairRate(req),
  });
}

/** Mean-reversion z-score backtest of an IRS curve spread (short vs long
 * tenor) -- services/spread_backtest_service.py via GET /api/spread-backtest.
 * The first UI consumer of this previously-orphaned endpoint (Entry Signals
 * tab). Deterministic per parameter set, so cache it aggressively; `enabled`
 * is left to the caller (only fire for a valid IRS spread + date range). */
export function useSpreadBacktest(params: SpreadBacktestParams | null) {
  return useQuery({
    queryKey: queryKeys.spreadBacktest(params as SpreadBacktestParams),
    queryFn: () => spreadBacktestApi.run(params as SpreadBacktestParams),
    enabled: params !== null && Boolean(params.start && params.end && params.short && params.long),
    staleTime: 5 * 60_000,
  });
}
