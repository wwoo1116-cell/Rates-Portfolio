"use client";

/**
 * Shared valuation hook for manual-positions-store.ts, replacing the old
 * hand-rolled aggregateManualPositions/computePositionPnl math with real
 * backend calls -- same trades+snapshot->price/delta composition
 * use-portfolio-risk.ts already established for real trades. Consumed by
 * use-portfolio-positions.ts (grid NPV/DV01 columns), use-manual-portfolio-
 * metrics.ts (Home's Status/Heatmap), and details-panel.tsx (per-position
 * cashflows/MTM) -- three independent call sites building the identical
 * request object; TanStack Query dedupes them by queryKey content hash, the
 * same reliance use-portfolio-positions.ts and use-portfolio-risk.ts already
 * have on each other for real trades.
 */
import { useMemo } from "react";
import { useLatestMarketSnapshot, usePortfolioDeltaQuery, usePortfolioPriceQuery } from "@/hooks/use-api";
import { buildManualPortfolioPriceRequest } from "@/lib/manual-portfolio-request";
import { useManualPositionsStore, type ManualPosition } from "@/stores/manual-positions-store";

export interface ManualPortfolioValuation {
  positions: ManualPosition[];
  hasPositions: boolean;
  priceQuery: ReturnType<typeof usePortfolioPriceQuery>;
  deltaQuery: ReturnType<typeof usePortfolioDeltaQuery>;
  isLoading: boolean;
  isError: boolean;
}

export function useManualPortfolioValuation(): ManualPortfolioValuation {
  const positions = useManualPositionsStore((state) => state.positions);
  const { snapshot, isLoading: snapshotLoading, isError: snapshotError } = useLatestMarketSnapshot();

  const request = useMemo(() => buildManualPortfolioPriceRequest(positions, snapshot), [positions, snapshot]);
  const priceQuery = usePortfolioPriceQuery(request);
  const deltaQuery = usePortfolioDeltaQuery(request);

  return {
    positions,
    hasPositions: positions.length > 0,
    priceQuery,
    deltaQuery,
    isLoading: snapshotLoading || (Boolean(request) && (priceQuery.isLoading || deltaQuery.isLoading)),
    isError: snapshotError || priceQuery.isError || deltaQuery.isError,
  };
}
