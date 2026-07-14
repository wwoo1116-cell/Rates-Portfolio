"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLatestMarketSnapshot, useMarketDataRange, useMarketDataSnapshot } from "@/hooks/use-api";
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
  const rangeQuery = useMarketDataRange();
  
  const latestDate = rangeQuery.data?.max_date;
  const availableDates = rangeQuery.data?.available_dates || [];
  
  const priorDate = useMemo(() => {
    if (!latestDate || availableDates.length < 2) return undefined;
    const sorted = [...availableDates].sort();
    const idx = sorted.indexOf(latestDate);
    if (idx > 0) return sorted[idx - 1];
    return undefined;
  }, [latestDate, availableDates]);

  const priorSnapshotQuery = useMarketDataSnapshot(priorDate);

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
    }));
    
    const bonds: ParsedPositionOut[] = bondPositions.map(p => ({
      instrument_type: "bond",
      position_id: p.name,
      sector: p.sector,
      book: p.book,
      start_date: null,
      maturity_date: null,
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

  const priorRequest = useMemo(() => {
    if (!baseRequest || !priorSnapshotQuery.data) return undefined;
    return {
      ...baseRequest,
      prior_valuation_date: priorSnapshotQuery.data.valuation_date,
      prior_cd_rate: priorSnapshotQuery.data.cd_rate,
      prior_on_rate: priorSnapshotQuery.data.on_rate,
      prior_swap_quotes: priorSnapshotQuery.data.swap_quotes,
      // Included in the body (and thus the query key) so changing the spread
      // in Settings refetches Home's Daily P&L with the new funding assumption.
      funding_spread_bp: fundingSpreadBp,
    };
  }, [baseRequest, priorSnapshotQuery.data, fundingSpreadBp]);

  const pvbpSensitivityQuery = useQuery({
    queryKey: ["portfolio-analytics", "pvbp-sensitivity", baseRequest],
    queryFn: () => portfolioAnalyticsApi.pvbpSensitivity(baseRequest!),
    enabled: Boolean(baseRequest),
  });

  const bookDailyPnlQuery = useQuery({
    queryKey: ["portfolio-analytics", "book-daily-pnl", priorRequest],
    queryFn: () => portfolioAnalyticsApi.bookDailyPnl(priorRequest!),
    enabled: Boolean(priorRequest),
  });

  const bookSummaryRequest = useMemo(() => {
    if (!baseRequest || !bookDailyPnlQuery.data) return undefined;
    return {
      ...baseRequest,
      daily_pnl_by_book: bookDailyPnlQuery.data,
    };
  }, [baseRequest, bookDailyPnlQuery.data]);

  const bookSummaryQuery = useQuery({
    queryKey: ["portfolio-analytics", "book-summary", bookSummaryRequest],
    queryFn: () => portfolioAnalyticsApi.bookSummary(bookSummaryRequest!),
    enabled: Boolean(bookSummaryRequest),
  });

  const isLoading = 
    snapshotLoading || 
    priorSnapshotQuery.isLoading || 
    (Boolean(baseRequest) && pvbpSensitivityQuery.isLoading) || 
    (Boolean(priorRequest) && bookDailyPnlQuery.isLoading) || 
    (Boolean(bookSummaryRequest) && bookSummaryQuery.isLoading);

  const isError = 
    snapshotError || 
    priorSnapshotQuery.isError || 
    pvbpSensitivityQuery.isError || 
    bookDailyPnlQuery.isError || 
    bookSummaryQuery.isError;

  return {
    hasPositions: combinedPositions.length > 0,
    pvbpSensitivity: pvbpSensitivityQuery.data,
    bookDailyPnl: bookDailyPnlQuery.data,
    bookSummary: bookSummaryQuery.data,
    isLoading,
    isError,
  };
}
