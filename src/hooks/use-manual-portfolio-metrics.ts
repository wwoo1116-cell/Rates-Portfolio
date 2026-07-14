"use client";

/**
 * Home's Status/Heatmap data source, backed by useManualPortfolioValuation
 * (real POST /api/portfolio/price + /delta) instead of hand-rolled math.
 * Unlike a synchronous local computation, this is network-backed --
 * isLoading/isError are exposed so StatusView/RiskHeatmap can show a loading
 * state instead of flashing a stale/zero value while the first price/delta
 * round-trip resolves.
 */
import { useMemo } from "react";
import { useManualPortfolioValuation } from "@/hooks/use-manual-portfolio-valuation";
import { bucketDeltasByTenor, weightedDuration } from "@/lib/risk-buckets";
import { type TenorBucket } from "@/lib/constants";
import type { ManualPosition } from "@/stores/manual-positions-store";

export interface ManualPortfolioMetrics {
  positions: ManualPosition[];
  hasPositions: boolean;
  totalNotional: number;
  totalPnl: number;
  overallDuration: number;
  bucketDv01: Record<TenorBucket, number> | null;
  isLoading: boolean;
  isError: boolean;
}

export function useManualPortfolioMetrics(): ManualPortfolioMetrics {
  const { positions, hasPositions, priceQuery, deltaQuery, isLoading, isError } = useManualPortfolioValuation();

  const totalNotional = useMemo(() => positions.reduce((sum, p) => sum + p.notionalKrwEok, 0), [positions]);

  const bucketDv01 = useMemo(
    () => (deltaQuery.data ? bucketDeltasByTenor(deltaQuery.data.buckets) : null),
    [deltaQuery.data],
  );

  const overallDuration = useMemo(() => (bucketDv01 ? weightedDuration(bucketDv01) : 0), [bucketDv01]);

  return {
    positions,
    hasPositions,
    totalNotional,
    totalPnl: priceQuery.data?.net_npv ?? 0,
    overallDuration,
    bucketDv01,
    isLoading,
    isError,
  };
}
