/**
 * s19 DIAGNOSIS TESTS — FLIPPED BY s20. s19 encoded the Entry Signals
 * backtest display defect as `it.fails` evidence (docs/session-s19/
 * REPORT_s19.md); s20 landed the fixes and flipped every test to `it`
 * per the s19 contract ("flip `it.fails` to `it` — do NOT weaken the
 * assertions"). The assertions are byte-identical; only the SHIPPED-side
 * derivations were updated, as the helper's mirror contract requires:
 *
 *  R1 — the oscillator's markers are now pinnedOscillatorMarkers (the pinned
 *       run's trade entries — the same result object as the KPIs); the
 *       parallel first-|z|≥entry crossing derivation was deleted. The
 *       expected side is built INLINE from the trade list so the bijection
 *       check cannot become tautological.
 *  R2 — BASE_CHART_OPTIONS now carries minBarSpacing 0.05 (R2b), and the
 *       panels fit through ensureFullDomainFit, which converges on the
 *       cache-hit mount race instead of dropping the fit (R2a). The default
 *       render window is therefore whatever the fit engine converges to on
 *       the WORST path (data set while the pane is unsized), driven here
 *       through the fit-harness mirror of the library's time-scale semantics.
 */
import { describe, expect, it } from "vitest";
import { BASE_CHART_OPTIONS } from "@/components/charts/lw-chart-base";
import { simulateMeanReversion } from "@/lib/math/backtest";
import { ensureFullDomainFit } from "./full-domain-fit";
import { FitHarness } from "./fit-harness";
import {
  checkCorrespondence,
  pinnedOscillatorMarkers,
  type MarkerTuple,
} from "./marker-trade-correspondence";

/** Deterministic fixture: LCG noise + sine + regime jumps (same recipe as the
 * s17 KPI pin) — produces multiple trades AND crossing/trade divergence. */
function fixture(): { dates: string[]; values: number[] } {
  let s = 42;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff - 0.5;
  };
  const dates: string[] = [];
  const values: number[] = [];
  const d0 = Date.UTC(2025, 0, 1);
  for (let i = 0; i < 320; i++) {
    dates.push(new Date(d0 + i * 86_400_000).toISOString().slice(0, 10));
    let v = 50 + 6 * Math.sin(i / 14) + rand() * 4;
    if (i >= 120 && i < 180) v += 9;
    if (i >= 240) v -= 7;
    values.push(Math.round(v * 100) / 100);
  }
  return { dates, values };
}

const PARAMS = { lookback: 60, entryZ: 2.0, exitZ: 0.5, stopZ: 3.5, costBp: 0.05, notional: 1_000_000 };

describe("s19 defect: oscillator markers vs backtest trades (R1) — fixed by s20", () => {
  it("SHORT/LONG markers biject with trade entries and sit on entry bars", () => {
    const { dates, values } = fixture();
    const result = simulateMeanReversion(dates, values, PARAMS);
    expect(result.trades.length).toBeGreaterThan(0); // fixture sanity — not the defect

    // Shipped derivation (s20): the panel renders the pinned run's trade
    // entries, non-stale path (stale suppression is pinned separately in
    // marker-pins-s20.test.ts).
    const actual = pinnedOscillatorMarkers(result, false);
    // Expected side built inline — independent of the helper under test.
    const expected: MarkerTuple[] = result.trades.map((t) => ({
      time: t.entryDate,
      position: t.direction > 0 ? "belowBar" : "aboveBar",
      shape: "circle",
      text: t.direction > 0 ? "LONG" : "SHORT",
    }));
    const check = checkCorrespondence(expected, actual, new Set(dates));

    // CORRECT behavior: every marker is a trade entry, every trade entry has
    // a marker, all on real bars. Failed pre-s20: the panel derived markers
    // from raw z-crossings (orphans while a position is open; missing after
    // stop-exit re-entries), independent of the trade list the KPIs use.
    expect(check.orphans).toEqual([]);
    expect(check.missing).toEqual([]);
    expect(check.offBar).toEqual([]);
  });
});

describe("s19 defect: rendered window vs data domain (R2) — fixed by s20", () => {
  // Live-measured geometry (docs/session-s19): s17 Results 2×2 grid pane
  // ≈ 640px; full IRS history = 4,040 bars.
  const PANE_PX = 640;
  const FULL_HISTORY_BARS = 4040;
  const LW_DEFAULT_MIN_BAR_SPACING = 0.5; // lightweight-charts default; dist line 12348

  it("chart options allow fitContent to fit a full-history series in a workspace pane", () => {
    const timeScale = BASE_CHART_OPTIONS.timeScale as { minBarSpacing?: number } | undefined;
    const effectiveMin = timeScale?.minBarSpacing ?? LW_DEFAULT_MIN_BAR_SPACING;
    // CORRECT behavior: fitting 4,040 bars into 640px needs barSpacing
    // ≈ 0.158px, so the configured floor must be at or below that. Failed
    // pre-s20: nothing overrode the 0.5px default, so even a successful
    // fitContent showed at most 1,280 bars — the tail — while the backtest
    // KPIs cover all 4,040.
    expect(FULL_HISTORY_BARS * effectiveMin).toBeLessThanOrEqual(PANE_PX);
  });

  it("every backtest trade is visible in the default render window", () => {
    const { dates, values } = fixture();
    const result = simulateMeanReversion(dates, values, PARAMS);
    // The default render window is what the shipped fit path converges to on
    // the WORST mount ordering (s19 R2a: data cache-hit while the pane is
    // still unsized, layout arrives after). Pre-s20 this was the library
    // default barSpacing-6 tail (~PANE_PX/6 bars), hiding every earlier trade.
    const h = new FitHarness({ width: 0 });
    h.setData(dates.length);
    ensureFullDomainFit(h.chart, dates.length);
    h.flush();
    h.layout(PANE_PX);
    h.flush();
    const range = h.visibleRange();
    expect(range).not.toBeNull();
    const firstVisibleIdx = Math.max(0, Math.ceil(range!.from));
    const firstVisibleDate = dates[firstVisibleIdx];
    const invisibleEntries = result.trades.filter((t) => t.entryDate < firstVisibleDate);
    expect(invisibleEntries).toEqual([]);
  });
});
