"use client";

/**
 * Period PnL (WTD / MTD / YTD) for the Daily P&L panel's comparison ribbon.
 * Backed by POST /api/portfolio/period-pnl.
 *
 * METHODOLOGY WARNING (mirrors the allocation charts): the figures are the
 * CURRENT book revalued at each baseline's market data -- hypothetical period
 * PnL, not realized P&L, because this deployment has no position history. The
 * consumer must render the same revaluation caveat the charts carry.
 *
 * Shares the request contract, schedulability filter, and fingerprint strategy
 * with use-allocation-history.ts -- both endpoints revalue the same bonds off
 * the same payload. Sends NO book filter: the response carries per-book rows
 * plus "Total", matching the book-spanning Daily P&L table it sits beside.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { portfolioAnalyticsApi } from "@/lib/api-client";
import { requestFingerprint } from "@/lib/request-fingerprint";
import { useBondPositionsStore } from "@/stores/bond-positions-store";
import { schedulableBonds, toRevaluationRequest } from "@/hooks/use-allocation-history";

export function usePeriodPnl() {
  const bondPositions = useBondPositionsStore((state) => state.positions);

  const request = useMemo(
    () => toRevaluationRequest(schedulableBonds(bondPositions)),
    [bondPositions],
  );

  // Content fingerprint, not the request object, for the same reason as
  // use-allocation-history: TanStack re-hashes the whole key every render.
  const requestFp = useMemo(
    () => (request ? requestFingerprint(request) : undefined),
    [request],
  );

  const query = useQuery({
    queryKey: ["portfolio-analytics", "period-pnl", request?.positions.length, requestFp],
    queryFn: () => portfolioAnalyticsApi.periodPnl(request!),
    enabled: Boolean(request),
  });

  return {
    periodPnl: query.data,
    periodPnlLoading: Boolean(request) && query.isLoading,
    periodPnlError: query.isError,
  };
}
