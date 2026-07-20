"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useMarketDataRange, useMarketDataSnapshot } from "@/hooks/use-api";
import { useManualPositionsStore } from "@/stores/manual-positions-store";
import { useBondPositionsStore } from "@/stores/bond-positions-store";
import { resolveDailyCloseDate, useHomeDateStore } from "@/stores/home-date-store";
import { useSettingsStore } from "@/stores/settings-store";
import { portfolioAnalyticsApi, type ParsedPositionOut } from "@/lib/api-client";
import { requestFingerprint } from "@/lib/request-fingerprint";

export function usePortfolioAnalytics() {
  const irsPositions = useManualPositionsStore((state) => state.positions);
  const bondPositions = useBondPositionsStore((state) => state.positions);
  // Funding-rate assumption from the Settings tab. Flows into book-daily-pnl
  // so the backend applies BOK base + this spread to bond funding cost.
  const fundingSpreadBp = useSettingsStore((state) => state.fundingSpreadBp);
  
  // Latest close — the same range→snapshot composition useLatestMarketSnapshot
  // wraps, inlined here (T2b) because Daily P&L below needs the range's
  // available_dates and, when a past date is picked, a SECOND snapshot. PVBP /
  // Book Summary / Portfolio Overview always price off this latest close; the
  // past-date pick never touches them.
  const rangeQuery = useMarketDataRange();
  const latestDate = rangeQuery.data?.max_date;
  const snapshotQuery = useMarketDataSnapshot(latestDate);
  const snapshot = snapshotQuery.data;
  const snapshotLoading = rangeQuery.isLoading || snapshotQuery.isLoading;
  const snapshotError = rangeQuery.isError || snapshotQuery.isError;

  const combinedPositions: ParsedPositionOut[] = useMemo(() => {
    const irs: ParsedPositionOut[] = irsPositions.map(p => ({
      instrument_type: "irs",
      position_id: p.name, // The backend needs position_id. In upload, name=position_id
      sector: p.sector,
      book: p.book,
      start_date: p.startDate,
      maturity_date: p.maturityDate,
      notional: p.notionalKrwEok * 100_000_000,
      fixed_rate: p.fixedRate / 100,
      pay_fixed: p.payFixed,
      float_spread: 0,
      evaluation_amount: null,
      remaining_days: null,
      tenor_bucket: null,
      entry_yield: null,
      mtm_yield: null,
      duration: null,
      pvbp: null,
      // Bond-only static params; a swap has no coupon schedule of this shape.
      issue_date: null,
      coupon_rate: null,
      payment_frequency: null,
      rating: null,
    }));
    
    const bonds: ParsedPositionOut[] = bondPositions.map(p => ({
      instrument_type: "bond",
      position_id: p.name,
      sector: p.sector,
      book: p.book,
      start_date: null,
      // maturity_date used to be hardcoded null here even though the store has
      // it. Without it (and the four static params below) the backend can't
      // build a coupon schedule, so it can't revalue the bond at a rolled
      // valuation date -- i.e. it can't compute theta at all, only carry.
      maturity_date: p.maturityDate || null,
      notional: p.notionalKrwEok * 100_000_000,
      fixed_rate: null,
      pay_fixed: null,
      float_spread: null,
      evaluation_amount: p.evaluationAmountKrwEok * 100_000_000,
      remaining_days: p.remainingDays,
      tenor_bucket: p.tenorBucket,
      entry_yield: p.entryYield,
      mtm_yield: p.mtmYield,
      duration: p.duration,
      pvbp: p.pvbp,
      // Static bond params, already hydrated by blotter-parser.ts and already
      // sent to /api/portfolio/allocation-history (see use-allocation-history).
      // Sent as null rather than filtered out when absent: a bond with no issue
      // date still has carry, and the backend falls back to an analytic split
      // for it. Dropping it here would silently understate the book instead.
      issue_date: p.issueDate || null,
      coupon_rate: p.couponRate ?? null,
      payment_frequency: p.paymentFrequency ?? null,
      rating: p.rating ?? null,
    }));
    return [...irs, ...bonds];
  }, [irsPositions, bondPositions]);

  const baseRequest = useMemo(() => {
    if (!snapshot || combinedPositions.length === 0) return undefined;
    return {
      valuation_date: snapshot.valuation_date,
      cd_rate: snapshot.cd_rate,
      on_rate: snapshot.on_rate,
      swap_quotes: snapshot.swap_quotes,
      positions: combinedPositions,
    };
  }, [snapshot, combinedPositions]);

  // Daily P&L needs ONE close snapshot and nothing else. It used to also send
  // the close-before-that as prior_*, back when the panel meant "yesterday vs
  // the day before". It now means "T vs a close", where the backend resolves
  // T = next business day after the close and decides for itself whether T has
  // quotes yet -- both theta legs price off the close curve, so an older
  // snapshot has no role.
  //
  // R3B-PLUS T2b — WHICH close is now the user's choice: the panel's date
  // picker writes a past close date to home-date-store, and this request (and
  // only this request) follows it. A free-typed date that isn't an available
  // date (weekend/holiday) snaps to the latest available date ≤ it; the
  // panel's steppers only ever step over available_dates. A null pick means
  // the latest close — same snapshot query key (deduped by TanStack) and a
  // byte-identical request body to the pre-T2b shape.
  const pickedCloseDate = useHomeDateStore((s) => s.dailyPnlCloseDate);
  const availableDates = rangeQuery.data?.available_dates;
  const dailyCloseDate = useMemo(
    () => resolveDailyCloseDate(pickedCloseDate, latestDate, availableDates),
    [pickedCloseDate, latestDate, availableDates],
  );
  const dailySnapshotQuery = useMarketDataSnapshot(dailyCloseDate);
  const dailySnapshot = dailySnapshotQuery.data;

  const dailyPnlRequest = useMemo(() => {
    if (!dailySnapshot || combinedPositions.length === 0) return undefined;
    return {
      valuation_date: dailySnapshot.valuation_date,
      cd_rate: dailySnapshot.cd_rate,
      on_rate: dailySnapshot.on_rate,
      swap_quotes: dailySnapshot.swap_quotes,
      positions: combinedPositions,
      // Included in the body (and thus the fingerprint) so changing the spread
      // in Settings refetches Home's Daily P&L with the new funding assumption.
      funding_spread_bp: fundingSpreadBp,
    };
  }, [dailySnapshot, combinedPositions, fundingSpreadBp]);

  // Query keys carry a content FINGERPRINT of the request, never the request
  // itself: TanStack re-hashes the whole key every render, and this request is
  // ~290 KB × 3 queries × 3 consumers of this hook = ~31 ms of pure
  // serialization per Home render (measured). The fingerprint is computed once
  // per content change here; the full body still goes over the wire untouched.
  const baseFingerprint = useMemo(
    () => (baseRequest ? requestFingerprint(baseRequest) : undefined),
    [baseRequest],
  );
  const dailyPnlFingerprint = useMemo(
    () => (dailyPnlRequest ? requestFingerprint(dailyPnlRequest) : undefined),
    [dailyPnlRequest],
  );

  const pvbpSensitivityQuery = useQuery({
    queryKey: ["portfolio-analytics", "pvbp-sensitivity", combinedPositions.length, baseFingerprint],
    queryFn: () => portfolioAnalyticsApi.pvbpSensitivity(baseRequest!),
    enabled: Boolean(baseRequest),
  });

  const bookDailyPnlQuery = useQuery({
    queryKey: ["portfolio-analytics", "book-daily-pnl", combinedPositions.length, dailyPnlFingerprint],
    queryFn: () => portfolioAnalyticsApi.bookDailyPnl(dailyPnlRequest!),
    enabled: Boolean(dailyPnlRequest),
  });

  // Book Summary depends only on baseRequest -- NOT on bookDailyPnlQuery.data.
  // It used to wait for /book-daily-pnl to resolve and then POST that entire
  // result back as `daily_pnl_by_book`, which the backend's build_book_summary
  // never read. That turned two independent panels into a serial chain
  // (range -> snapshot -> prior snapshot -> daily-pnl -> summary, five
  // sequential round trips) purely to populate a dead field. Both panels now
  // fetch in parallel off the same snapshot.
  const bookSummaryQuery = useQuery({
    queryKey: ["portfolio-analytics", "book-summary", combinedPositions.length, baseFingerprint],
    queryFn: () => portfolioAnalyticsApi.bookSummary(baseRequest!),
    enabled: Boolean(baseRequest),
  });

  // Per-panel loading, not one shared flag. The old single `isLoading` was true
  // while ANY query was in flight, so every panel showed a spinner until the
  // slowest one landed -- PVBP sat on "Computing…" waiting for Book Summary's
  // data that it never uses. Each panel now reflects only what it needs.
  return {
    hasPositions: combinedPositions.length > 0,

    // The close date every close-based panel (PVBP, Portfolio Overview) prices
    // off. Exposed so those panels can label themselves: Daily P&L shows the
    // NEXT business day (its as_of comes from the backend), so without labels
    // the Home tab shows two different dates with no explanation.
    closeDate: snapshot?.valuation_date,

    // T2b: the RESOLVED close date the Daily P&L request prices off (picked
    // date snapped to available_dates; latest close when nothing is picked).
    // The panel's date control renders this, and compares it to the range's
    // max_date to know it is showing a past view.
    dailyPnlCloseDate: dailyCloseDate,

    pvbpSensitivity: pvbpSensitivityQuery.data,
    pvbpLoading: snapshotLoading || (Boolean(baseRequest) && pvbpSensitivityQuery.isLoading),
    pvbpError: snapshotError || pvbpSensitivityQuery.isError,

    bookDailyPnl: bookDailyPnlQuery.data,
    // T2b: tracks the DAILY snapshot (picked close), not the latest-close one
    // the other two panels wait on — picking a past date must not spin them.
    bookDailyPnlLoading:
      rangeQuery.isLoading ||
      dailySnapshotQuery.isLoading ||
      (Boolean(dailyPnlRequest) && bookDailyPnlQuery.isLoading),
    bookDailyPnlError:
      rangeQuery.isError || dailySnapshotQuery.isError || bookDailyPnlQuery.isError,

    bookSummary: bookSummaryQuery.data,
    bookSummaryLoading: snapshotLoading || (Boolean(baseRequest) && bookSummaryQuery.isLoading),
    bookSummaryError: snapshotError || bookSummaryQuery.isError,
  };
}
