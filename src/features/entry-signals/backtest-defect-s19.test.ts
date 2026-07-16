/**
 * s19 DIAGNOSIS TESTS — these encode the Entry Signals backtest display
 * defect as executable evidence (docs/session-s19/REPORT_s19.md). Every test
 * here is `it.fails(...)`: it asserts the CORRECT behavior and is EXPECTED to
 * fail on today's code. When a fix pass lands, flip `it.fails` to `it` — do
 * NOT weaken the assertions.
 *
 * Root causes encoded:
 *  R1 — the z-score oscillator's SHORT/LONG markers are an independent
 *       derivation (first |z|≥entry crossing) and do not correspond to the
 *       backtest's trades (not injective, not surjective).
 *  R2 — the rendered time window is a render-side artifact: fitContent is
 *       defeated at mount (race) and, even when applied, lightweight-charts'
 *       default minBarSpacing (0.5px) caps visible bars at paneWidth/0.5 —
 *       a full 4,040-bar history can never fit a workspace-sized pane, so
 *       the chart silently shows only the tail while KPIs aggregate the full
 *       domain ("cumulative starts at 64.5M", "markers missing").
 */
import { describe, expect, it } from "vitest";
import { BASE_CHART_OPTIONS } from "@/components/charts/lw-chart-base";
import { simulateMeanReversion } from "@/lib/math/backtest";
import {
  checkCorrespondence,
  oscillatorCrossingMarkers,
  tradeEntryMarkers,
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

describe("s19 defect: oscillator markers vs backtest trades (R1)", () => {
  it.fails("SHORT/LONG markers biject with trade entries and sit on entry bars", () => {
    const { dates, values } = fixture();
    const result = simulateMeanReversion(dates, values, PARAMS);
    expect(result.trades.length).toBeGreaterThan(0); // fixture sanity — not the defect

    const actual = oscillatorCrossingMarkers(dates, values, PARAMS.lookback, PARAMS.entryZ);
    const expected = tradeEntryMarkers(result.trades);
    const check = checkCorrespondence(expected, actual, new Set(dates));

    // CORRECT behavior: every marker is a trade entry, every trade entry has
    // a marker, all on real bars. FAILS today: the panel derives markers from
    // raw z-crossings (orphans while a position is open; missing after
    // stop-exit re-entries), independent of the trade list the KPIs use.
    expect(check.orphans).toEqual([]);
    expect(check.missing).toEqual([]);
    expect(check.offBar).toEqual([]);
  });
});

describe("s19 defect: rendered window vs data domain (R2)", () => {
  // Live-measured geometry (docs/session-s19): s17 Results 2×2 grid pane
  // ≈ 640px; full IRS history = 4,040 bars.
  const PANE_PX = 640;
  const FULL_HISTORY_BARS = 4040;
  const LW_DEFAULT_MIN_BAR_SPACING = 0.5; // lightweight-charts default; dist line 12348
  const LW_DEFAULT_BAR_SPACING = 6; // window when fitContent never applies (the mount race)

  it.fails("chart options allow fitContent to fit a full-history series in a workspace pane", () => {
    const timeScale = BASE_CHART_OPTIONS.timeScale as { minBarSpacing?: number } | undefined;
    const effectiveMin = timeScale?.minBarSpacing ?? LW_DEFAULT_MIN_BAR_SPACING;
    // CORRECT behavior: fitting 4,040 bars into 640px needs barSpacing
    // ≈ 0.158px, so the configured floor must be at or below that. FAILS
    // today: nothing overrides the 0.5px default, so even a successful
    // fitContent shows at most 1,280 bars — the tail — while the backtest
    // KPIs cover all 4,040.
    expect(FULL_HISTORY_BARS * effectiveMin).toBeLessThanOrEqual(PANE_PX);
  });

  it.fails("every backtest trade is visible in the default render window", () => {
    const { dates, values } = fixture();
    const result = simulateMeanReversion(dates, values, PARAMS);
    // When the mount race defeats fitContent entirely (observed live —
    // cached-data path), the chart renders the library default: the last
    // paneWidth/6 bars. CORRECT behavior: the default view covers every
    // trade the KPI block reports. FAILS today for any series longer than
    // the default window.
    const defaultVisibleBars = Math.floor(PANE_PX / LW_DEFAULT_BAR_SPACING);
    const firstVisibleIdx = Math.max(0, dates.length - defaultVisibleBars);
    const firstVisibleDate = dates[firstVisibleIdx];
    const invisibleEntries = result.trades.filter((t) => t.entryDate < firstVisibleDate);
    expect(invisibleEntries).toEqual([]);
  });
});
