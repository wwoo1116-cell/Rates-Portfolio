"use client";

/**
 * RP Fund's sector-risk and maturity profile across five calendar-anchored
 * snapshots, for Home's Portfolio Overview panel.
 * Backed by POST /api/portfolio/allocation-history.
 *
 * Bond-only, and snapshot-free: the backend loads each column's market data
 * itself, so unlike use-portfolio-analytics.ts this sends no curve and doesn't
 * wait on useLatestMarketSnapshot.
 *
 * NOTE: the request carries issueDate/maturityDate/couponRate/paymentFrequency/
 * rating -- the five static params blotter-parser.ts hydrates and that
 * use-portfolio-analytics.ts's ParsedPositionOut mapping drops on the floor.
 * Without them the backend can't build a coupon schedule, so it can't revalue
 * a bond at a past date at all.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { portfolioAnalyticsApi } from "@/lib/api-client";
import type { AllocationHistoryRequest } from "@/lib/api-types";
import { useBondPositionsStore } from "@/stores/bond-positions-store";

const KRW_PER_EOK = 100_000_000;

export function useAllocationHistory(book = "RP Fund") {
  const bondPositions = useBondPositionsStore((state) => state.positions);

  const request: AllocationHistoryRequest | undefined = useMemo(() => {
    const positions = bondPositions
      // A bond with no issue date can't be scheduled. blotter-parser.ts only
      // guards maturityDate, so issueDate can arrive empty despite the
      // BondPosition type claiming otherwise -- drop those here rather than
      // sending a payload the backend rejects with a 422 that kills the panel.
      .filter((p) => p.issueDate && p.maturityDate)
      .map((p) => ({
        position_id: p.id,
        book: p.book,
        sector: p.sector,
        issue_date: p.issueDate,
        maturity_date: p.maturityDate,
        coupon_rate: p.couponRate,
        payment_frequency: p.paymentFrequency,
        notional: p.notionalKrwEok * KRW_PER_EOK,
        rating: p.rating,
      }));
    if (positions.length === 0) return undefined;
    return { positions, book };
  }, [bondPositions, book]);

  const query = useQuery({
    // The whole request is the key, so it must stay referentially stable --
    // that's what the useMemo above is for.
    queryKey: ["portfolio-analytics", "allocation-history", request],
    queryFn: () => portfolioAnalyticsApi.allocationHistory(request!),
    enabled: Boolean(request),
  });

  return {
    hasPositions: Boolean(request),
    allocation: query.data,
    // Per-panel flags, not a shared isLoading -- a single shared flag made every
    // Home panel wait for the slowest one.
    allocationLoading: Boolean(request) && query.isLoading,
    allocationError: query.isError,
  };
}
