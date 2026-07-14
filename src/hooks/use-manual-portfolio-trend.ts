"use client";

/**
 * 1-year trend data for Home's Status panel sparklines, computed from the
 * SAME real backend as the headline stats (use-manual-portfolio-metrics.ts) --
 * no fabricated/mock series.
 *
 * Cumulative P&L: one real POST /api/portfolio/historical-pnl call across the
 * whole window (the backend already walks every business date and filters
 * each date's active positions to start_date <= date <= maturity_date).
 *
 * Overall Duration / Total Notional: there's no batch "historical delta"
 * endpoint, so these are sampled at SAMPLE_COUNT dates spread over the last
 * year. Duration needs a real per-date market snapshot + a real
 * POST /api/portfolio/delta call (fetched in two parallel useQueries waves);
 * Total Notional is pure local arithmetic (sum of positions whose own
 * start/maturity window covers that date) -- no network call at all. Both
 * apply the same start_date <= date <= maturity_date "was this position even
 * on the book yet" filter historical-pnl applies server-side, so a
 * freshly-added position correctly contributes nothing before its own start
 * date rather than a fabricated backfilled value.
 */
import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { subYears, format, parseISO } from "date-fns";
import { marketDataApi, portfolioApi } from "@/lib/api-client";
import { useManualPositionsStore, type ManualPosition } from "@/stores/manual-positions-store";
import { useMarketDataRange } from "@/hooks/use-api";
import { manualPositionsToPositionsIn } from "@/lib/manual-portfolio-request";
import { bucketDeltasByTenor, weightedDuration } from "@/lib/risk-buckets";
import type { SparklinePoint } from "@/components/charts/sparkline";

const SAMPLE_COUNT = 12;

function isActiveOn(position: ManualPosition, date: string): boolean {
  return position.startDate <= date && date <= position.maturityDate;
}

function pickSampleDates(availableDates: string[]): string[] {
  if (availableDates.length === 0) return [];
  const maxDate = availableDates[availableDates.length - 1];
  const oneYearAgo = format(subYears(parseISO(maxDate), 1), "yyyy-MM-dd");
  const inWindow = availableDates.filter((d) => d >= oneYearAgo);
  if (inWindow.length <= SAMPLE_COUNT) return inWindow;
  const step = (inWindow.length - 1) / (SAMPLE_COUNT - 1);
  return Array.from({ length: SAMPLE_COUNT }, (_, i) => inWindow[Math.round(i * step)]);
}

export interface ManualPortfolioTrend {
  pnlTrend: SparklinePoint[];
  durationTrend: SparklinePoint[];
  notionalTrend: SparklinePoint[];
  isLoading: boolean;
}

export function useManualPortfolioTrend(): ManualPortfolioTrend {
  const positions = useManualPositionsStore((state) => state.positions);
  const rangeQuery = useMarketDataRange();
  const sampleDates = useMemo(
    () => pickSampleDates(rangeQuery.data?.available_dates ?? []),
    [rangeQuery.data],
  );

  const pnlRequest = useMemo(() => {
    if (positions.length === 0 || sampleDates.length === 0) return undefined;
    return {
      positions: manualPositionsToPositionsIn(positions),
      start_date: sampleDates[0],
      end_date: sampleDates[sampleDates.length - 1],
    };
  }, [positions, sampleDates]);

  const pnlQuery = useQuery({
    queryKey: ["manual-portfolio", "historical-pnl", pnlRequest],
    queryFn: () => portfolioApi.historicalPnl(pnlRequest!),
    enabled: Boolean(pnlRequest),
  });

  const snapshotQueries = useQueries({
    queries: sampleDates.map((date) => ({
      queryKey: ["market-data", "snapshot", date],
      queryFn: () => marketDataApi.snapshot(date),
      enabled: positions.length > 0,
      staleTime: 5 * 60_000,
    })),
  });

  const deltaQueries = useQueries({
    queries: sampleDates.map((date, i) => {
      const snapshot = snapshotQueries[i]?.data;
      const activePositions = positions.filter((p) => isActiveOn(p, date));
      const req =
        snapshot && activePositions.length > 0
          ? {
              valuation_date: snapshot.valuation_date,
              cd_rate: snapshot.cd_rate,
              on_rate: snapshot.on_rate,
              swap_quotes: snapshot.swap_quotes,
              positions: manualPositionsToPositionsIn(activePositions),
            }
          : undefined;
      return {
        queryKey: ["manual-portfolio", "delta-trend", date, req],
        queryFn: () => portfolioApi.delta(req!),
        enabled: Boolean(req),
      };
    }),
  });

  const durationTrend = useMemo<SparklinePoint[]>(
    () =>
      sampleDates
        .map((date, i) => {
          const data = deltaQueries[i]?.data;
          if (!data) return null;
          return { date, value: weightedDuration(bucketDeltasByTenor(data.buckets)) };
        })
        .filter((p): p is SparklinePoint => p !== null),
    [sampleDates, deltaQueries],
  );

  const notionalTrend = useMemo<SparklinePoint[]>(
    () =>
      sampleDates.map((date) => ({
        date,
        value: positions.filter((p) => isActiveOn(p, date)).reduce((sum, p) => sum + p.notionalKrwEok, 0),
      })),
    [sampleDates, positions],
  );

  const pnlTrend = useMemo<SparklinePoint[]>(
    () => (pnlQuery.data?.points ?? []).map((p) => ({ date: p.valuation_date, value: p.net_npv })),
    [pnlQuery.data],
  );

  const isLoading =
    positions.length > 0 &&
    (pnlQuery.isLoading ||
      snapshotQueries.some((q) => q.isLoading) ||
      deltaQueries.some((q) => q.isLoading));

  return { pnlTrend, durationTrend, notionalTrend, isLoading };
}
