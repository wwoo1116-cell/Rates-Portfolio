"use client";

/**
 * The Results stage's backtest seam (s17): computes the mean-reversion sim
 * from the PINNED run config (store.lastRun) — never from the live params —
 * so the KPI block, trades table and cumulative P&L stay a snapshot of the
 * run that produced them while the signals/z-score surfaces track the live
 * config. Same series→bp scaling and math as use-backtest.ts (the pre-staged
 * live hook); only the parameter source differs.
 */

import { useMemo } from "react";
import { simulateMeanReversion, type BtResult } from "@/lib/math/backtest";
import { instrumentLabel, type BuiltSeries } from "@/lib/rv-instruments";
import { useEntrySignalsStore, type EsRunConfig } from "@/stores/entry-signals-store";
import { useEntrySignalsData } from "./use-entry-signals-data";

export interface PinnedBacktest {
  run: EsRunConfig;
  label: string;
  /** null while the pinned instrument's series is not resolvable (e.g. its
   * credit legs are still fetching in a fresh session). */
  result: BtResult | null;
}

export function usePinnedBacktest(): PinnedBacktest | null {
  const lastRun = useEntrySignalsStore((s) => s.lastRun);
  const { seriesById } = useEntrySignalsData();

  return useMemo(() => {
    if (!lastRun) return null;
    const label = instrumentLabel(lastRun.instrument);
    const series: BuiltSeries | undefined = seriesById.get(lastRun.instrument.id);
    if (!series || series.lineData.length === 0) return { run: lastRun, label, result: null };
    // Spreads are bp already; outright decimal rates -> bp (same convention
    // as use-backtest.ts, so identical inputs give identical numbers).
    const scale = series.kind === "spread" ? 1 : 10_000;
    const dates = series.lineData.map((d) => d.time);
    const values = series.lineData.map((d) => d.value * scale);
    const result = simulateMeanReversion(dates, values, {
      lookback: lastRun.lookback,
      entryZ: lastRun.entryZ,
      exitZ: lastRun.exitZ,
      stopZ: lastRun.stopZ,
      costBp: lastRun.costBp,
      notional: lastRun.notional,
    });
    return { run: lastRun, label, result };
  }, [lastRun, seriesById]);
}

/** True when the live config no longer matches the pinned run — the Results
 * stage marks the backtest block as belonging to the previous parameters
 * (the live monitoring surfaces are unaffected). */
export function useRunIsStale(): boolean {
  return useEntrySignalsStore((s) => {
    const run = s.lastRun;
    if (!run) return false;
    return (
      s.focused?.id !== run.instrument.id ||
      s.lookback !== run.lookback ||
      s.entryZ !== run.entryZ ||
      s.warnZ !== run.warnZ ||
      s.exitZ !== run.exitZ ||
      s.stopZ !== run.stopZ ||
      s.costBp !== run.costBp ||
      s.notional !== run.notional
    );
  });
}
