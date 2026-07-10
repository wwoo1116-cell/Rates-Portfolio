"use client";

/**
 * Real IRS DV01-by-tenor-bucket for the current book -- the same
 * trades+snapshot+delta composition Home's risk heatmap introduced (Phase 4),
 * shared here since Backtest and Simulation need the identical baseline
 * instead of the deleted MOCK_POSITIONS dataset. KTB/CRS/KTBF have no pricing
 * engine yet (MIGRATION_PLAN.md §3 gap table) so this is IRS-only, same as
 * the heatmap.
 */
import { useMemo } from "react";
import { useLatestMarketSnapshot, usePortfolioDeltaQuery, useTrades } from "@/hooks/use-api";
import { TENOR_BUCKETS, type TenorBucket } from "@/lib/constants";
import { buildPortfolioPriceRequest } from "@/lib/portfolio-request";
import { bucketDeltasByTenor } from "@/lib/risk-buckets";

export interface PortfolioRiskBuckets {
  buckets: Record<TenorBucket, number> | null;
  totalDv01: number;
  totalNotional: number;
  hasPositions: boolean;
  isLoading: boolean;
  isError: boolean;
}

export function usePortfolioRiskBuckets(): PortfolioRiskBuckets {
  const tradesQuery = useTrades();
  const { snapshot, isLoading: snapshotLoading, isError: snapshotError } = useLatestMarketSnapshot();

  const trades = useMemo(() => tradesQuery.data ?? [], [tradesQuery.data]);
  const deltaRequest = useMemo(() => buildPortfolioPriceRequest(trades, snapshot), [trades, snapshot]);
  const deltaQuery = usePortfolioDeltaQuery(deltaRequest);

  const buckets = useMemo(
    () => (deltaQuery.data ? bucketDeltasByTenor(deltaQuery.data.buckets) : null),
    [deltaQuery.data],
  );

  const totalDv01 = deltaQuery.data?.total_delta ?? 0;
  const totalNotional = useMemo(
    () => trades.reduce((sum, t) => sum + t.notional / 100_000_000, 0),
    [trades],
  );

  return {
    buckets,
    totalDv01,
    totalNotional,
    hasPositions: trades.length > 0,
    isLoading: tradesQuery.isLoading || snapshotLoading || (Boolean(deltaRequest) && deltaQuery.isLoading),
    isError: tradesQuery.isError || snapshotError || deltaQuery.isError,
  };
}
