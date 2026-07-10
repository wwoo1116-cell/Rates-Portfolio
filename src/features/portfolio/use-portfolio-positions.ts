"use client";

/**
 * Real IRS positions from the irs_pricer backend: GET /api/trades +
 * POST /api/portfolio/price (MIGRATION_PLAN.md Phase 3(b)). No other asset
 * class has a pricing engine yet (§3 gap table) and none are represented
 * here -- the grid legitimately renders empty rather than filling in
 * fabricated rows.
 */
import { differenceInCalendarMonths, parseISO } from "date-fns";
import { useMemo } from "react";
import type { TradeOut } from "@/lib/api-client";
import { useLatestMarketSnapshot, usePortfolioPriceQuery, useTrades } from "@/hooks/use-api";
import type { Book, Tenor } from "@/lib/constants";
import { buildPortfolioPriceRequest } from "@/lib/portfolio-request";
import type { Position } from "@/types/portfolio";

function formatTenorLabel(months: number): string {
  if (months < 12) return `${months}M`;
  if (months === 18) return "1.5Y";
  if (months % 12 === 0) return `${months / 12}Y`;
  return `${months}M`;
}

function tenorLabelFor(trade: TradeOut): string {
  const months =
    trade.tenor_months ?? differenceInCalendarMonths(parseISO(trade.maturity_date), parseISO(trade.start_date));
  return formatTenorLabel(Math.max(months, 0));
}

function tradeToPosition(trade: TradeOut, npv: number | undefined): Position {
  const tenor = tenorLabelFor(trade);
  return {
    id: String(trade.trade_id),
    assetClass: "IRS",
    // Real trades carry a freeform book/tenor that isn't guaranteed to match
    // the mock data's fixed Book/Tenor unions -- same escape hatch
    // constants.ts's own getTenorBucket() uses for an unrecognized tenor.
    book: (trade.book ?? "Unassigned") as Book,
    ticker: trade.ticker ?? `IRS ${tenor} KRW`,
    direction: trade.pay_fixed ? "Pay" : "Rec",
    tenor: tenor as Tenor,
    effectiveDate: trade.start_date,
    maturityDate: trade.maturity_date,
    notionalKrwEok: trade.notional / 100_000_000,
    fixedRate: trade.fixed_rate * 100,
    // Real risk/DV01 wiring is Phase 4 (engine/risk.py) -- 0 renders blank
    // via the grid's existing `value || ""` formatters, same as an absent value.
    dv01: 0,
    krd1y: 0,
    krd3y: 0,
    krd5y: 0,
    krd10y: 0,
    convexity: 0,
    npv,
  };
}

export interface PortfolioPositionsResult {
  positions: Position[];
  isLoading: boolean;
  isError: boolean;
}

export function usePortfolioPositions(): PortfolioPositionsResult {
  const tradesQuery = useTrades();
  const { snapshot, isLoading: snapshotLoading, isError: snapshotError } = useLatestMarketSnapshot();

  const trades = useMemo(() => tradesQuery.data ?? [], [tradesQuery.data]);
  const priceRequest = useMemo(() => buildPortfolioPriceRequest(trades, snapshot), [trades, snapshot]);
  const priceQuery = usePortfolioPriceQuery(priceRequest);

  const positions = useMemo(() => {
    const npvByPositionId = new Map(priceQuery.data?.position_results.map((r) => [r.position_id, r.clean_npv]) ?? []);
    return trades.map((t) => tradeToPosition(t, npvByPositionId.get(t.external_position_id)));
  }, [trades, priceQuery.data]);

  return {
    positions,
    isLoading: tradesQuery.isLoading || snapshotLoading,
    isError: tradesQuery.isError || snapshotError,
  };
}
