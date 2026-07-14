"use client";

/**
 * Runs the client-side mean-reversion backtest (lib/math/backtest.ts) for the
 * focused instrument, using the already-cached series and the store params.
 * Works for ANY focused instrument -- IRS/KTB/credit spreads and outrights --
 * and recomputes instantly on lookback/threshold/param changes (no network).
 *
 * Values are fed to the sim in bp: spreads are already bp; outright decimal
 * rates are scaled ×10000. (z-score is scale-invariant, so signals are
 * identical to the oscillator's; only the pnl magnitude uses the bp scale, to
 * keep `notional` a consistent per-bp sensitivity.)
 */

import { useMemo } from "react";
import { simulateMeanReversion, type BtResult } from "@/lib/math/backtest";
import type { BuiltSeries } from "@/lib/rv-instruments";
import { useEntrySignalsStore } from "@/stores/entry-signals-store";

export function useFocusedBacktest(focusedSeries: BuiltSeries | null): BtResult | null {
  const lookback = useEntrySignalsStore((s) => s.lookback);
  const entryZ = useEntrySignalsStore((s) => s.entryZ);
  const exitZ = useEntrySignalsStore((s) => s.exitZ);
  const stopZ = useEntrySignalsStore((s) => s.stopZ);
  const costBp = useEntrySignalsStore((s) => s.costBp);
  const notional = useEntrySignalsStore((s) => s.notional);

  return useMemo(() => {
    if (!focusedSeries || focusedSeries.lineData.length === 0) return null;
    const dates = focusedSeries.lineData.map((d) => d.time);
    // Spreads are bp already; outright decimal rates -> bp for the per-bp notional.
    const scale = focusedSeries.kind === "spread" ? 1 : 10_000;
    const values = focusedSeries.lineData.map((d) => d.value * scale);
    return simulateMeanReversion(dates, values, { lookback, entryZ, exitZ, stopZ, costBp, notional });
  }, [focusedSeries, lookback, entryZ, exitZ, stopZ, costBp, notional]);
}
