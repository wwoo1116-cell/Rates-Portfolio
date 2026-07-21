"use client";

/**
 * RECON-DAILY — data plumbing for the 일별 대사 panel (both mounts).
 *
 * One close-date pick (home-date-store.reconCloseDate, shared by the Home and
 * Rates History mounts) drives four queries, ALL against endpoints that
 * already existed — the T1 adjudication found no BE change needed:
 *
 *  M1  POST /api/portfolio/pvbp-sensitivity with the D−1 close snapshot.
 *      `valuation_date` (and the whole curve) is client-settable by design
 *      (PortfolioAnalyticsRequest, api/routers/portfolio_analytics.py:48) —
 *      the same v2-T1 finding as book-daily-pnl. When D−1 is the latest close
 *      this request is byte-identical to the Home PVBP panel's (same query
 *      key + fingerprint), so TanStack serves both from one fetch.
 *      Honesty note: the bond rows' KRD is the workbook's static per-bucket
 *      pvbp (request positions), so only the IRS row genuinely reprices at
 *      D−1 — recorded in the panel caption and the session report.
 *  Δ   GET market-data snapshots at D−1 and D for the Δbp row. D is the
 *      SERVER's as_of from the daily-pnl response, never client-derived.
 *  R   POST /api/portfolio/book-daily-pnl with close = D−1 (the v2 T2b
 *      machinery): the response's Total row by_class carries the realized
 *      day-D valuation buckets — bond.mtm = 채권평가 (V(D,y_D) − V(D,y_{D−1})
 *      per bond, _bond_pnl), swap.mtm = 스왑평가 (V(D,c_D) − V(D,c_{D−1}),
 *      _swap_pnl) — plus the 테타/펀딩 chip figures and realized_cash.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useMarketDataRange, useMarketDataSnapshot } from "@/hooks/use-api";
import { useCombinedPositions } from "@/hooks/use-portfolio-analytics";
import { resolveDailyCloseDate, useHomeDateStore } from "@/stores/home-date-store";
import { useSettingsStore } from "@/stores/settings-store";
import { portfolioAnalyticsApi } from "@/lib/api-client";
import { requestFingerprint } from "@/lib/request-fingerprint";
import type { BookDailyPnlResponse, DailyPnlBookRow, MarketDataResponse } from "@/lib/api-types";
import { TENOR_COLS } from "@/features/home/pvbp-sensitivity-table";
import { deltaBpByTenor } from "@/lib/daily-recon-math";

export function useDailyRecon() {
  const combinedPositions = useCombinedPositions();
  const fundingSpreadBp = useSettingsStore((s) => s.fundingSpreadBp);

  const rangeQuery = useMarketDataRange();
  const latestDate = rangeQuery.data?.max_date;
  const availableDates = rangeQuery.data?.available_dates;

  const picked = useHomeDateStore((s) => s.reconCloseDate);
  const setPicked = useHomeDateStore((s) => s.setReconCloseDate);
  // Same snap rule as the Daily P&L picker: latest available close ≤ pick,
  // never forward, latest for null/future/pre-range picks.
  const resolvedClose = useMemo(
    () => resolveDailyCloseDate(picked, latestDate, availableDates),
    [picked, latestDate, availableDates],
  );

  const closeSnapshotQuery = useMarketDataSnapshot(resolvedClose);
  const closeSnapshot = closeSnapshotQuery.data;

  // ---- realized leg: book-daily-pnl @ close D−1 --------------------------
  const dailyRequest = useMemo(() => {
    if (!closeSnapshot || combinedPositions.length === 0) return undefined;
    return {
      valuation_date: closeSnapshot.valuation_date,
      cd_rate: closeSnapshot.cd_rate,
      on_rate: closeSnapshot.on_rate,
      swap_quotes: closeSnapshot.swap_quotes,
      positions: combinedPositions,
      funding_spread_bp: fundingSpreadBp,
    };
  }, [closeSnapshot, combinedPositions, fundingSpreadBp]);
  const dailyFingerprint = useMemo(
    () => (dailyRequest ? requestFingerprint(dailyRequest) : undefined),
    [dailyRequest],
  );
  // Key shape mirrors use-portfolio-analytics verbatim: the same request must
  // be the same cache entry, so the recon panel and the Daily P&L table can
  // never answer differently for the same close.
  const dailyQuery = useQuery({
    queryKey: ["portfolio-analytics", "book-daily-pnl", combinedPositions.length, dailyFingerprint],
    queryFn: () => portfolioAnalyticsApi.bookDailyPnl(dailyRequest!),
    enabled: Boolean(dailyRequest),
  });
  const daily: BookDailyPnlResponse | undefined = dailyQuery.data;
  const asOf = daily?.as_of;

  // ---- M1: KRD @ D−1 ------------------------------------------------------
  const pvbpRequest = useMemo(() => {
    if (!closeSnapshot || combinedPositions.length === 0) return undefined;
    return {
      valuation_date: closeSnapshot.valuation_date,
      cd_rate: closeSnapshot.cd_rate,
      on_rate: closeSnapshot.on_rate,
      swap_quotes: closeSnapshot.swap_quotes,
      positions: combinedPositions,
    };
  }, [closeSnapshot, combinedPositions]);
  const pvbpFingerprint = useMemo(
    () => (pvbpRequest ? requestFingerprint(pvbpRequest) : undefined),
    [pvbpRequest],
  );
  const pvbpQuery = useQuery({
    queryKey: ["portfolio-analytics", "pvbp-sensitivity", combinedPositions.length, pvbpFingerprint],
    queryFn: () => portfolioAnalyticsApi.pvbpSensitivity(pvbpRequest!),
    enabled: Boolean(pvbpRequest),
  });

  // ---- M2: Δbp — needs the day-D snapshot, which only exists once D's
  // quotes have landed. Never fabricated: absent → deltaBp undefined and the
  // panel says so. -----------------------------------------------------------
  const asOfAvailable = Boolean(asOf && availableDates?.includes(asOf));
  const asOfSnapshotQuery = useMarketDataSnapshot(asOfAvailable ? asOf : undefined);
  const asOfSnapshot: MarketDataResponse | undefined = asOfSnapshotQuery.data;

  const deltaBp = useMemo(
    () =>
      closeSnapshot && asOfSnapshot
        ? deltaBpByTenor(TENOR_COLS, closeSnapshot, asOfSnapshot)
        : undefined,
    [closeSnapshot, asOfSnapshot],
  );

  const totalRow: DailyPnlBookRow | undefined = daily?.by_book.find((r) => r.book === "Total");

  return {
    hasPositions: combinedPositions.length > 0,
    picked,
    setPicked,
    resolvedClose,
    /** T4a — the swap-cashflow recon prices its schedule off this same close
     * snapshot, so scheduled and realized legs share one D−1. */
    closeSnapshot,
    asOf,
    asOfAvailable,
    pvbpRows: pvbpQuery.data as Array<Record<string, unknown>> | undefined,
    deltaBp,
    totalRow,
    quoteSources: daily?.quote_sources,
    loading:
      rangeQuery.isLoading ||
      closeSnapshotQuery.isLoading ||
      (Boolean(dailyRequest) && dailyQuery.isLoading) ||
      (Boolean(pvbpRequest) && pvbpQuery.isLoading) ||
      (asOfAvailable && asOfSnapshotQuery.isLoading),
    error:
      rangeQuery.isError ||
      closeSnapshotQuery.isError ||
      dailyQuery.isError ||
      pvbpQuery.isError ||
      asOfSnapshotQuery.isError,
  };
}
