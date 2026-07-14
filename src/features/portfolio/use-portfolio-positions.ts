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
import { useManualPortfolioValuation } from "@/hooks/use-manual-portfolio-valuation";
import type { AssetClass, Book, Tenor } from "@/lib/constants";
import { buildPortfolioPriceRequest } from "@/lib/portfolio-request";
import type { Position } from "@/types/portfolio";
import type { ManualPosition } from "@/stores/manual-positions-store";
import { useBondPositionsStore, type BondPosition } from "@/stores/bond-positions-store";

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
    book: (trade.book ?? "Unassigned") as Book,
    ticker: trade.ticker ?? `IRS ${tenor} KRW`,
    direction: trade.pay_fixed ? "Pay" : "Rec",
    tenor: tenor as Tenor,
    effectiveDate: trade.start_date,
    maturityDate: trade.maturity_date,
    notionalKrwEok: trade.notional / 100_000_000,
    fixedRate: trade.fixed_rate * 100,
    dv01: 0,
    krd1y: 0,
    krd3y: 0,
    krd5y: 0,
    krd10y: 0,
    convexity: 0,
    npv,
  };
}

function manualPositionToPosition(
  position: ManualPosition,
  npv: number | undefined,
  dv01: number | undefined,
): Position {
  const months = differenceInCalendarMonths(parseISO(position.maturityDate), parseISO(position.startDate));
  return {
    id: position.id,
    assetClass: "IRS",
    book: (position.book || "Manual Entry") as Book,
    ticker: position.name,
    direction: position.payFixed ? "Pay" : "Rec",
    tenor: formatTenorLabel(Math.max(months, 0)) as Tenor,
    effectiveDate: position.startDate,
    maturityDate: position.maturityDate,
    notionalKrwEok: position.notionalKrwEok,
    fixedRate: position.fixedRate,
    dv01: dv01 ?? 0,
    krd1y: 0,
    krd3y: 0,
    krd5y: 0,
    krd10y: 0,
    convexity: 0,
    npv,
    isManual: true,
  };
}

function bondPositionToPosition(position: BondPosition): Position {
  return {
    id: position.id,
    // Classify by the real bond sector (국고채/통안채/은행채…) rather than a
    // generic "Bond" -- the grid's Asset column renders this directly.
    assetClass: position.sector as AssetClass,
    book: (position.book || "Imported") as Book,
    ticker: position.name,
    direction: "Buy", // Bonds are typically bought
    tenor: position.tenorBucket as Tenor,
    effectiveDate: position.issueDate,   // parsed from the blotter
    maturityDate: position.maturityDate, // parsed from the blotter
    notionalKrwEok: position.notionalKrwEok,
    // entryYield already arrives as a percent (e.g. 2.82 for 2.82%) --
    // irs_pricer/loaders/portfolio.py's bond parser never divides it by
    // 100, unlike IRS fixed_rate. Multiplying again here was the bug
    // (2.82 -> 282); the grid's FIXED/STRIKE % column formatter expects
    // percent units directly, same as it does for IRS rows.
    fixedRate: position.entryYield,
    dv01: position.pvbp || 0,
    krd1y: 0,
    krd3y: 0,
    krd5y: 0,
    krd10y: 0,
    convexity: 0,
    npv: position.evaluationAmountKrwEok, // Show evaluation amount as NPV
    isManual: true,
    isBond: true,
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
  const {
    positions: manualPositions,
    priceQuery: manualPriceQuery,
    deltaQuery: manualDeltaQuery,
  } = useManualPortfolioValuation();
  const bondPositions = useBondPositionsStore((state) => state.positions);

  const trades = useMemo(() => tradesQuery.data ?? [], [tradesQuery.data]);
  const priceRequest = useMemo(() => buildPortfolioPriceRequest(trades, snapshot), [trades, snapshot]);
  const priceQuery = usePortfolioPriceQuery(priceRequest);

  const positions = useMemo(() => {
    const npvByPositionId = new Map(priceQuery.data?.position_results.map((r) => [r.position_id, r.clean_npv]) ?? []);
    const manualNpvByPositionId = new Map(
      manualPriceQuery.data?.position_results.map((r) => [r.position_id, r.clean_npv]) ?? [],
    );
    const manualDv01ByPositionId = new Map(
      manualDeltaQuery.data?.position_deltas.map((d) => [d.position_id, d.total_delta]) ?? [],
    );
    const finalPositions = [
      ...trades.map((t) => tradeToPosition(t, npvByPositionId.get(t.external_position_id))),
      ...manualPositions.map((p) =>
        manualPositionToPosition(p, manualNpvByPositionId.get(p.id), manualDv01ByPositionId.get(p.id)),
      ),
      ...bondPositions.map((p) => bondPositionToPosition(p)),
    ];
    console.log("[DEBUG] usePortfolioPositions calculated:", finalPositions.length, "positions. Trades:", trades.length, "Manual:", manualPositions.length, "Bonds:", bondPositions.length);
    return finalPositions;
  }, [trades, priceQuery.data, manualPositions, manualPriceQuery.data, manualDeltaQuery.data, bondPositions]);

  return {
    positions,
    isLoading: snapshotLoading,
    isError: snapshotError,
  };
}
