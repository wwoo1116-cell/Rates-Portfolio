"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLatestMarketSnapshot } from "@/hooks/use-api";
import { useManualPositionsStore } from "@/stores/manual-positions-store";
import { useBondPositionsStore } from "@/stores/bond-positions-store";
import { useSettingsStore } from "@/stores/settings-store";
import { portfolioAnalyticsApi, type ParsedPositionOut } from "@/lib/api-client";

export function usePortfolioAnalytics() {
  const irsPositions = useManualPositionsStore((state) => state.positions);
  const bondPositions = useBondPositionsStore((state) => state.positions);
  // Funding-rate assumption from the Settings tab. Flows into book-daily-pnl
  // so the backend applies BOK base + this spread to bond funding cost.
  const fundingSpreadBp = useSettingsStore((state) => state.fundingSpreadBp);
  
  const { snapshot, isLoading: snapshotLoading, isError: snapshotError } = useLatestMarketSnapshot();

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

  // Daily P&L needs the LAST CLOSE (= baseRequest's snapshot) and nothing else.
  // It used to also send the close-before-that as prior_*, back when the panel
  // meant "yesterday vs the day before". It now means "T vs last close", where
  // the backend resolves T = next business day after the close and decides for
  // itself whether T has quotes yet -- both theta legs price off the close
  // curve, so the older snapshot has no role. That also drops a whole
  // snapshot round trip out of this panel's path.
  const dailyPnlRequest = useMemo(() => {
    if (!baseRequest) return undefined;
    return {
      ...baseRequest,
      // Included in the body (and thus the query key) so changing the spread
      // in Settings refetches Home's Daily P&L with the new funding assumption.
      funding_spread_bp: fundingSpreadBp,
    };
  }, [baseRequest, fundingSpreadBp]);

  const pvbpSensitivityQuery = useQuery({
    queryKey: ["portfolio-analytics", "pvbp-sensitivity", baseRequest],
    queryFn: () => portfolioAnalyticsApi.pvbpSensitivity(baseRequest!),
    enabled: Boolean(baseRequest),
  });

  const bookDailyPnlQuery = useQuery({
    queryKey: ["portfolio-analytics", "book-daily-pnl", dailyPnlRequest],
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
    queryKey: ["portfolio-analytics", "book-summary", baseRequest],
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

    pvbpSensitivity: pvbpSensitivityQuery.data,
    pvbpLoading: snapshotLoading || (Boolean(baseRequest) && pvbpSensitivityQuery.isLoading),
    pvbpError: snapshotError || pvbpSensitivityQuery.isError,

    bookDailyPnl: bookDailyPnlQuery.data,
    bookDailyPnlLoading:
      snapshotLoading || (Boolean(dailyPnlRequest) && bookDailyPnlQuery.isLoading),
    bookDailyPnlError: snapshotError || bookDailyPnlQuery.isError,

    bookSummary: bookSummaryQuery.data,
    bookSummaryLoading: snapshotLoading || (Boolean(baseRequest) && bookSummaryQuery.isLoading),
    bookSummaryError: snapshotError || bookSummaryQuery.isError,
  };
}
