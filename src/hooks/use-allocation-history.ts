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
import { requestFingerprint } from "@/lib/request-fingerprint";
import { useBondPositionsStore, type BondPosition } from "@/stores/bond-positions-store";

const KRW_PER_EOK = 100_000_000;

/** Bonds the backend can actually schedule (build a coupon calendar for).
 * blotter-parser.ts only guards maturityDate, so issueDate can arrive empty
 * despite the BondPosition type claiming otherwise. */
export function schedulableBonds(bondPositions: BondPosition[]): BondPosition[] {
  return bondPositions.filter((p) => p.issueDate && p.maturityDate);
}

/** The shared revaluation payload. /allocation-history and /period-pnl take
 * the identical bond contract (the backend shares the mapping too, see
 * routers/portfolio_analytics._to_bond_snapshot_inputs) -- the field mapping
 * and unit conversion must not fork between the two consumers. */
export function toRevaluationRequest(
  schedulable: BondPosition[],
  book?: string,
): AllocationHistoryRequest | undefined {
  if (schedulable.length === 0) return undefined;
  return {
    positions: schedulable.map((p) => ({
      position_id: p.id,
      book: p.book,
      sector: p.sector,
      issue_date: p.issueDate,
      maturity_date: p.maturityDate,
      coupon_rate: p.couponRate,
      payment_frequency: p.paymentFrequency,
      notional: p.notionalKrwEok * KRW_PER_EOK,
      rating: p.rating,
    })),
    ...(book !== undefined ? { book } : {}),
  };
}

export function useAllocationHistory(book = "RP Fund") {
  const bondPositions = useBondPositionsStore((state) => state.positions);

  // Unschedulable bonds are dropped rather than sent -- the backend would 422
  // the whole payload and kill the panel.
  //
  // Kept as its own memo (not inlined into the request) because the DELTA
  // between these two counts is itself a UI state: "bonds exist but none are
  // schedulable" is a data-quality failure the panel must say out loud. This
  // exact silent state (273 bonds, 0 schedulable, query disabled, charts
  // gone without a word) read as a rendering bug for weeks -- see
  // DIAGNOSIS_REPORT.md S3.
  const schedulable = useMemo(() => schedulableBonds(bondPositions), [bondPositions]);

  const request: AllocationHistoryRequest | undefined = useMemo(
    () => toRevaluationRequest(schedulable, book),
    [schedulable, book],
  );

  // Content fingerprint, not the request object: TanStack re-hashes the whole
  // key every render, and a 273-bond request is tens of KB of serialization
  // each time. Computed once per content change; the body still ships whole.
  // See src/lib/request-fingerprint.ts for the correctness argument.
  const requestFp = useMemo(
    () => (request ? requestFingerprint(request) : undefined),
    [request],
  );

  const query = useQuery({
    queryKey: ["portfolio-analytics", "allocation-history", request?.positions.length, requestFp],
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
    // The two counts whose difference distinguishes "no bonds at all" from
    // "bonds exist but none carry issue/maturity dates" (query disabled). The
    // panel renders a different, explicit state for each -- never nothing.
    bondCount: bondPositions.length,
    schedulableCount: schedulable.length,
  };
}
