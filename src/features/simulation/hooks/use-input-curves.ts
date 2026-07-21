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

/** FB4 T2 — the bond families the 커브형 preview can offer, in chip order.
 * A family renders only when the credit taxonomy actually carries it ("every
 * family the snapshot carries", never a fabricated curve). */
export const PREVIEW_BOND_SECTORS = ["국고채", "통안채", "회사채", "여전채"] as const;

export const INPUT_CURVE_KEYS = {
  dateRange: ["simulation", "market-date-range"] as const,
  taxonomy: ["simulation", "credit-taxonomy"] as const,
  swapQuotes: (d: string) => ["simulation", "input-curves", "swap", d] as const,
  // The representative rating is part of the cache identity: a rated sector's
  // curve differs per rating, and the FB5 fix keys the base quote to ratings[0].
  bondQuotes: (d: string, sector: string = BOND_SECTOR, rating: string | null = null) =>
    ["simulation", "input-curves", "bond", sector, rating ?? "-", d] as const,
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

/** The credit taxonomy tree (sectors → ratings → tenors) — the Rate History
 * selector's own option source. FB5 B1: the 커브형 chip roster and its
 * enablement/representative-rating are derived from THIS (reuse, not a forked
 * list). Shares the taxonomy cache key with useSectorInputQuotes, so one fetch
 * feeds both. */
export function useCreditTaxonomy(enabled = true) {
  return useQuery({
    queryKey: INPUT_CURVE_KEYS.taxonomy,
    queryFn: () => creditCurveApi.taxonomy(),
    staleTime: Infinity,
    retry: 1,
    enabled,
  });
}

/** Representative rating for a sector's single preview curve — the RV selector's
 * own default tier (ratings[0], the highest/first). Unrated sectors (국고채) and
 * any sector the taxonomy doesn't rate return null. This is THE FB5 silent-chip
 * fix: a RATED sector queried with rating:null resolves to no raw category
 * server-side (raw_category(sector,"") === None) → an empty, silently-blank
 * series; ratings[0] is a REAL curve (not invented math) and mirrors LegPicker. */
export function representativeRating(sectorDef?: { ratings?: string[] } | null): string | null {
  const ratings = sectorDef?.ratings ?? [];
  return ratings.length > 0 ? ratings[0] : null;
}

/** IRS par quotes (+ CD 3M short end) for the date → BaseQuote[]. A missing
 * snapshot (non-business day) surfaces as isError — the panel shows the
 * blank-policy notice instead of fabricating quotes. SIM2-1: `enabled` lets
 * the 시계열형 branch keep the whole preview network-free. */
export function useSwapInputQuotes(baseDate: string, enabled = true) {
  return useQuery({
    queryKey: INPUT_CURVE_KEYS.swapQuotes(baseDate),
    enabled: enabled && !!baseDate,
    staleTime: Infinity,
    retry: false,
    queryFn: async (): Promise<BaseQuote[]> => {
      const snap = await marketDataApi.snapshot(baseDate);
      const quotes: BaseQuote[] = [{ t: 0.25, label: "3M", rate: snap.cd_rate ?? null }];
      for (const q of snap.swap_quotes) {
        // Sub-1Y quotes arrive as tenor_years:1 + tenor_months (6M/9M) — the
        // months field is the real tenor; ignoring it would stack them on 1Y.
        const t = q.tenor_months != null ? q.tenor_months / 12 : q.tenor_years;
        quotes.push({ t, label: yearsToTenorLabel(t), rate: q.rate ?? null });
      }
      return quotes.sort((a, b) => a.t - b.t);
    },
  });
}

/** FB4 T2 — per-SECTOR par yields per taxonomy tenor for the date →
 * BaseQuote[]; a tenor with no point on the date stays rate:null (rendered
 * —, never +0). Generalizes the old 국고채-only hook: same query shape, the
 * sector is part of the cache key, and `carried` reports whether the credit
 * taxonomy offers the sector at all (chip renders only when it does). */
export function useSectorInputQuotes(sector: string, baseDate: string, enabled = true) {
  const taxonomy = useCreditTaxonomy(enabled);

  const sectorDef = taxonomy.data?.sectors.find((s) => s.sector === sector);
  const tenors = sectorDef?.tenors ?? [];
  // FB5 B1 — resolve the sector's representative rating (ratings[0]) so a RATED
  // sector fetches a real curve instead of the silent-blank rating:null series.
  const repRating = representativeRating(sectorDef);

  const series = useQuery({
    queryKey: INPUT_CURVE_KEYS.bondQuotes(baseDate, sector, repRating),
    enabled: enabled && !!baseDate && tenors.length > 0,
    staleTime: Infinity,
    retry: false,
    queryFn: async (): Promise<BaseQuote[]> => {
      const res = await creditCurveApi.series({
        legs: tenors.map((tenor) => ({ sector, rating: repRating, tenor })),
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

  return {
    ...series,
    taxonomyError: taxonomy.isError,
    /** Taxonomy resolved AND carries this sector. */
    carried: (taxonomy.data?.sectors.some((s) => s.sector === sector) ?? false),
    taxonomyLoaded: taxonomy.isSuccess,
    /** The rating the preview curve actually reflects (null = unrated). Shown
     * in the panel caption so a single-tier curve is never passed off as "the"
     * whole sector. */
    representativeRating: repRating,
    rated: (sectorDef?.ratings?.length ?? 0) > 0,
  };
}

/** 국고채 par yields — the pre-FB4 export, now a thin alias (same cache key
 * as before via the sector-keyed variant; existing consumers unaffected). */
export function useBondInputQuotes(baseDate: string, enabled = true) {
  return useSectorInputQuotes(BOND_SECTOR, baseDate, enabled);
}
