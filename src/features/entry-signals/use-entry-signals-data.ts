"use client";

/**
 * Data composition for the Entry Signals tab. Reuses the same cached hooks the
 * Rates History RV chart already uses (useMarketDataRange -> useRateHistory +
 * credit series) and the same buildInstrumentSeries transform, then resolves
 * every focused/watchlist instrument to a plottable {time,value}[] series.
 *
 * No z-score endpoint is called here: rolling stats are computed on the client
 * (lib/math/rolling-stats.ts) from this already-in-cache data, so sweeping
 * lookback/thresholds never triggers a network request. The mean-reversion
 * backtest is likewise client-side (lib/math/backtest.ts via useFocusedBacktest).
 */

import { useMemo } from "react";
import {
  useCreditCurveSeries,
  useCreditCurveTaxonomy,
  useMarketDataRange,
  useRateHistory,
} from "@/hooks/use-api";
import type { InstrumentTaxonomyOut } from "@/lib/api-client";
import {
  buildInstrumentSeries,
  creditLegsOf,
  type BuiltSeries,
  type SelectedInstrument,
} from "@/lib/rv-instruments";
import { useEntrySignalsStore } from "@/stores/entry-signals-store";

export interface EntrySignalsData {
  minDate: string;
  maxDate: string;
  taxonomy: InstrumentTaxonomyOut | undefined;
  /** Built series for the focused instrument (null when nothing is focused). */
  focusedSeries: BuiltSeries | null;
  /** Built series for every focused + watchlist instrument, keyed by id. */
  seriesById: Map<string, BuiltSeries>;
  isLoading: boolean;
  isError: boolean;
}

export function useEntrySignalsData(): EntrySignalsData {
  const focused = useEntrySignalsStore((s) => s.focused);
  const watchlist = useEntrySignalsStore((s) => s.watchlist);

  const rangeQuery = useMarketDataRange();
  const minDate = rangeQuery.data?.min_date ?? "";
  const maxDate = rangeQuery.data?.max_date ?? "";

  const historyQuery = useRateHistory(minDate, maxDate);
  const points = useMemo(() => historyQuery.data?.points ?? [], [historyQuery.data]);

  const taxonomyQuery = useCreditCurveTaxonomy();

  // Union of focused + watchlist instruments (dedup by id).
  const instruments = useMemo<SelectedInstrument[]>(() => {
    const map = new Map<string, SelectedInstrument>();
    for (const w of watchlist) map.set(w.id, w);
    if (focused) map.set(focused.id, focused);
    return [...map.values()];
  }, [focused, watchlist]);

  // Only credit (non-IRS) legs need a backend fetch; IRS legs resolve from the
  // rate-history payload already loaded above.
  const creditLegs = useMemo(() => creditLegsOf(instruments), [instruments]);
  const creditSeriesQuery = useCreditCurveSeries(creditLegs, minDate, maxDate);
  const creditResults = useMemo(
    () => creditSeriesQuery.data?.results ?? [],
    [creditSeriesQuery.data],
  );

  const built = useMemo(
    () => buildInstrumentSeries(instruments, points, creditResults),
    [instruments, points, creditResults],
  );

  const seriesById = useMemo(() => {
    const m = new Map<string, BuiltSeries>();
    for (const b of built) m.set(b.id, b);
    return m;
  }, [built]);

  const focusedSeries = focused ? seriesById.get(focused.id) ?? null : null;

  return {
    minDate,
    maxDate,
    taxonomy: taxonomyQuery.data,
    focusedSeries,
    seriesById,
    isLoading: rangeQuery.isLoading || historyQuery.isLoading,
    isError: rangeQuery.isError || historyQuery.isError,
  };
}
