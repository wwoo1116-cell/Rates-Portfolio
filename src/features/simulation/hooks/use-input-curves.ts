"use client";

/**
 * Query layer for the two-pane preview's BASE market quotes — light data
 * lookups only (market-data snapshot, 국고채 credit-curve series, available
 * date range), never the simulation engine. Everything is keyed by valuation
 * date and cached indefinitely: historical quotes for a date do not change
 * within a session, so moving a slider re-reads the cache and only a baseDate
 * switch refetches.
 *
 * Rates from both sources are DECIMAL (0.0282) — conversion to % happens in
 * lib/input-curve-preview, not here.
 */
import { useQuery } from "@tanstack/react-query";

import { creditCurveApi, marketDataApi } from "@/lib/api-client";

import { tenorToYears, yearsToTenorLabel, type BaseQuote } from "../lib/input-curve-preview";

const BOND_SECTOR = "국고채";

export const INPUT_CURVE_KEYS = {
  dateRange: ["simulation", "market-date-range"] as const,
  taxonomy: ["simulation", "credit-taxonomy"] as const,
  swapQuotes: (d: string) => ["simulation", "input-curves", "swap", d] as const,
  bondQuotes: (d: string) => ["simulation", "input-curves", "bond", d] as const,
};

/** Available market-data dates — bounds + steps for the baseDate toggle. */
export function useMarketDateRange() {
  return useQuery({
    queryKey: INPUT_CURVE_KEYS.dateRange,
    queryFn: () => marketDataApi.dateRange(),
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

/** IRS par quotes (+ CD 3M short end) for the date → BaseQuote[]. A missing
 * snapshot (non-business day) surfaces as isError — the panel shows the
 * blank-policy notice instead of fabricating quotes. */
export function useSwapInputQuotes(baseDate: string) {
  return useQuery({
    queryKey: INPUT_CURVE_KEYS.swapQuotes(baseDate),
    enabled: !!baseDate,
    staleTime: Infinity,
    retry: false,
    queryFn: async (): Promise<BaseQuote[]> => {
      const snap = await marketDataApi.snapshot(baseDate);
      const quotes: BaseQuote[] = [{ t: 0.25, label: "3M", rate: snap.cd_rate ?? null }];
      for (const q of snap.swap_quotes) {
        quotes.push({ t: q.tenor_years, label: yearsToTenorLabel(q.tenor_years), rate: q.rate ?? null });
      }
      return quotes.sort((a, b) => a.t - b.t);
    },
  });
}

/** 국고채 par yields per taxonomy tenor for the date → BaseQuote[]; a tenor
 * with no point on the date stays rate:null (rendered —, never +0). */
export function useBondInputQuotes(baseDate: string) {
  const taxonomy = useQuery({
    queryKey: INPUT_CURVE_KEYS.taxonomy,
    queryFn: () => creditCurveApi.taxonomy(),
    staleTime: Infinity,
    retry: 1,
  });

  const tenors =
    taxonomy.data?.sectors.find((s) => s.sector === BOND_SECTOR)?.tenors ?? [];

  const series = useQuery({
    queryKey: INPUT_CURVE_KEYS.bondQuotes(baseDate),
    enabled: !!baseDate && tenors.length > 0,
    staleTime: Infinity,
    retry: false,
    queryFn: async (): Promise<BaseQuote[]> => {
      const res = await creditCurveApi.series({
        legs: tenors.map((tenor) => ({ sector: BOND_SECTOR, rating: null, tenor })),
        start_date: baseDate,
        end_date: baseDate,
      });
      const quotes: BaseQuote[] = [];
      for (const r of res.results) {
        const t = tenorToYears(r.tenor);
        if (t === null) continue;
        const point = r.points.find((p) => p.valuation_date === baseDate) ?? r.points.at(-1);
        quotes.push({ t, label: r.tenor, rate: point?.value ?? null });
      }
      return quotes.sort((a, b) => a.t - b.t);
    },
  });

  return { ...series, taxonomyError: taxonomy.isError };
}
