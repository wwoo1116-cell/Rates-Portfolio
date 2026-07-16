// @vitest-environment jsdom
/**
 * s17 behavior pin: the backtest KPI block must render IDENTICAL values for
 * identical inputs before and after the staged-flow restructure. The expected
 * strings below were captured from the PRE-restructure BacktestPanel (this
 * test committed green against it first); the restructure may change how the
 * block is reached, but never these numbers.
 *
 * The series is deterministic (fixed LCG seed) and runs through the REAL
 * pipeline the UI uses — zustand store run config -> pinned-backtest scaling
 * (spread => bp as-is) -> lib/math/backtest -> SummaryTiles formatting. Only
 * the data hook and ag-grid (jsdom-hostile, not part of the pin) are mocked.
 * Post-restructure the harness feeds the SAME params through store.lastRun
 * (the pinned seam that replaced the live-params hook); the expected values
 * are untouched from the pre-restructure capture.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { colorForId } from "@/lib/chart-colors";
import type { BuiltSeries, SelectedInstrument } from "@/lib/rv-instruments";

const FIXTURE_INSTRUMENT: SelectedInstrument = {
  kind: "spread",
  id: "S:1*IRS||10Y~-1*IRS||3Y",
  legs: [
    { leg: { sector: "IRS", rating: null, tenor: "10Y" }, weight: 1 },
    { leg: { sector: "IRS", rating: null, tenor: "3Y" }, weight: -1 },
  ],
};

/** 320 business-day bp spread path: slow sine + LCG noise + two level jumps,
 * so the 60D rolling z-score genuinely breaches ±2σ several times. */
function fixtureSeries(): BuiltSeries {
  let s = 42;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff - 0.5;
  };
  const lineData: { time: string; value: number }[] = [];
  const d0 = Date.UTC(2025, 0, 1);
  for (let i = 0; i < 320; i++) {
    const t = new Date(d0 + i * 86_400_000).toISOString().slice(0, 10);
    let v = 50 + 6 * Math.sin(i / 14) + rand() * 4;
    if (i >= 120 && i < 180) v += 9; // regime jump up
    if (i >= 240) v -= 7; // regime jump down
    lineData.push({ time: t, value: Math.round(v * 100) / 100 });
  }
  return {
    id: FIXTURE_INSTRUMENT.id,
    kind: "spread",
    label: "IRS 10Y − IRS 3Y",
    color: colorForId(FIXTURE_INSTRUMENT.id),
    priceScaleId: "left",
    lineData,
  } as BuiltSeries;
}

const SERIES = fixtureSeries();

vi.mock("./use-entry-signals-data", () => ({
  useEntrySignalsData: () => ({
    minDate: "2025-01-01",
    maxDate: "2025-11-16",
    taxonomy: undefined,
    focusedSeries: SERIES,
    seriesById: new Map([[SERIES.id, SERIES]]),
    isLoading: false,
    isError: false,
  }),
}));

// ag-grid is not part of the pin (trade rows render through it, the KPI tiles
// don't) and its layout probes are jsdom-hostile.
vi.mock("ag-grid-react", () => ({ AgGridReact: () => null }));
vi.mock("ag-grid-community", () => ({
  AllCommunityModule: {},
  ModuleRegistry: { registerModules: () => {} },
}));

import { BacktestPanel } from "./backtest-panel";
import { useEntrySignalsStore } from "@/stores/entry-signals-store";

/** The exact run parameters of the pin — store defaults as of s16. */
const PIN_PARAMS = {
  lookback: 60,
  entryZ: 2.0,
  warnZ: 1.5,
  exitZ: 0.5,
  stopZ: 3.5,
  costBp: 0.05,
  notional: 1_000_000,
} as const;

beforeEach(() => {
  useEntrySignalsStore.setState({
    ...PIN_PARAMS,
    focused: FIXTURE_INSTRUMENT,
    watchlist: [FIXTURE_INSTRUMENT],
    // s17 staged flow: the KPI block renders the pinned run snapshot.
    lastRun: {
      ...PIN_PARAMS,
      instrument: FIXTURE_INSTRUMENT,
      ranAt: "2026-07-16T00:00:00.000Z",
    },
  });
});

afterEach(cleanup);

function tile(label: string): string {
  const el = screen.getByText(label);
  return el.parentElement!.querySelector(".num")!.textContent!.trim();
}

describe("backtest KPI pin — identical inputs, identical rendered KPIs (s17)", () => {
  it("renders the captured pre-restructure KPI values", () => {
    render(<BacktestPanel />);
    // Captured 2026-07-16 against the pre-restructure BacktestPanel at s16
    // head 2a52654 — do NOT regenerate these to make a failure pass; a
    // mismatch means the restructure touched signal/backtest logic.
    expect({
      totalPnl: tile("Total P&L"),
      maxDrawdown: tile("Max Drawdown"),
      winRate: tile("Win Rate"),
      sharpe: tile("Sharpe"),
      trades: tile("Trades"),
    }).toEqual({
      totalPnl: "-3,580,000",
      maxDrawdown: "18,800,000",
      winRate: "33%",
      sharpe: "-0.16",
      trades: "3",
    });
  });
});
