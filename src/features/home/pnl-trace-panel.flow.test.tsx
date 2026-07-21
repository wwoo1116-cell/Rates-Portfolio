// @vitest-environment jsdom
/**
 * FB3 F1 — the PnL Trace chart must SURVIVE a condition change. (Separate
 * file from pnl-trace-panel.test.tsx: that suite stubs LwChartBase out;
 * this one needs the REAL LwChartBase over a faked lightweight-charts to
 * exercise the chart lifecycle itself.)
 *
 * The repro this pins (owner report): change a condition → the mutation
 * resets data → the chart block unmounts (chart disposed) → data arrives →
 * block remounts. Pre-fix, the data effect's first post-remount run fired
 * with the STALE disposed chart from state, attached the series there, and
 * the visible new chart stayed blank (attribution only) while the header
 * updated. The pins:
 *   1. after the flow, the LATEST created chart carries the series with the
 *      new trace data (fails on revert: latest chart gets nothing);
 *   2. no series is EVER attached to a disposed chart (fails on revert);
 *   3. repeated condition changes keep working (no one-shot fix).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// ── fake lightweight-charts ────────────────────────────────────────────────
interface FakeSeries {
  setData: ReturnType<typeof vi.fn>;
  applyOptions: ReturnType<typeof vi.fn>;
  createPriceLine: ReturnType<typeof vi.fn>;
  removePriceLine: ReturnType<typeof vi.fn>;
}
interface FakeChart {
  removed: boolean;
  series: FakeSeries[];
  disposedAddSeries: number;
  addSeries: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  applyOptions: ReturnType<typeof vi.fn>;
  timeScale: () => { fitContent: ReturnType<typeof vi.fn>; width: () => number };
  priceScale: () => { applyOptions: ReturnType<typeof vi.fn> };
  subscribeClick: ReturnType<typeof vi.fn>;
  subscribeCrosshairMove: ReturnType<typeof vi.fn>;
  unsubscribeCrosshairMove: ReturnType<typeof vi.fn>;
  removeSeries: ReturnType<typeof vi.fn>;
}
const charts: FakeChart[] = [];

function makeChart(): FakeChart {
  const timeScale = { fitContent: vi.fn(), width: () => 600 };
  const chart: FakeChart = {
    removed: false,
    series: [],
    disposedAddSeries: 0,
    addSeries: vi.fn(() => {
      // Emulate the worst (non-throwing) disposed behavior: record and hand
      // back an orphan series — the pre-fix path that blanked the pane.
      if (chart.removed) chart.disposedAddSeries += 1;
      const s: FakeSeries = {
        setData: vi.fn(),
        applyOptions: vi.fn(),
        createPriceLine: vi.fn(() => ({})),
        removePriceLine: vi.fn(),
      };
      chart.series.push(s);
      return s;
    }),
    remove: vi.fn(() => {
      chart.removed = true;
    }),
    applyOptions: vi.fn(),
    timeScale: () => timeScale,
    priceScale: () => ({ applyOptions: vi.fn() }),
    subscribeClick: vi.fn(),
    subscribeCrosshairMove: vi.fn(),
    unsubscribeCrosshairMove: vi.fn(() => {
      if (chart.removed) throw new Error("Object is disposed");
    }),
    removeSeries: vi.fn(),
  };
  charts.push(chart);
  return chart;
}

vi.mock("lightweight-charts", () => ({
  createChart: () => makeChart(),
  createSeriesMarkers: vi.fn(() => ({ setMarkers: vi.fn(), detach: vi.fn() })),
  LineSeries: "line",
  LineStyle: { Solid: 0, Dashed: 2 },
  CrosshairMode: { Normal: 0 },
}));

// ── hand-driven api hooks ──────────────────────────────────────────────────
const mutateSpy = vi.fn();
let mutation: {
  data: unknown;
  isPending: boolean;
  isError: boolean;
  error: null;
  mutate: typeof mutateSpy;
};
vi.mock("@/hooks/use-api", () => ({
  useNpvTrace: () => mutation,
  useMarketDataRange: () => ({ data: { max_date: "2026-07-16" } }),
  useHistoricalQuote: () => ({ data: { historical_rate: 0.03 }, isLoading: false }),
}));

const { PnlTracePanel } = await import("./pnl-trace-panel");

const POINT = { valuation_date: "2026-07-01" } as never;
const trace = (v: number) => ({
  points: [
    { valuation_date: "2026-07-01", cumulative_pnl: 0, daily_pnl: 0, delta: null },
    { valuation_date: "2026-07-16", cumulative_pnl: v, daily_pnl: v, delta: null },
  ],
});

function setMutation(over: Partial<typeof mutation> = {}) {
  mutation = { data: undefined, isPending: false, isError: false, error: null, mutate: mutateSpy, ...over };
}

const panelEl = () => (
  <PnlTracePanel params={{ point: POINT }} api={undefined as never} containerApi={undefined as never} />
);

beforeEach(() => {
  charts.length = 0;
  mutateSpy.mockClear();
  setMutation();
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as never;
  }
});
afterEach(cleanup);

/** Drive the panel to a traced state: fill maturity (canTrace), land data. */
function landFirstTrace(r: ReturnType<typeof render>) {
  fireEvent.change(screen.getByLabelText(/Maturity Date/i), { target: { value: "2028-07-01" } });
  expect(mutateSpy).toHaveBeenCalled();
  act(() => {
    setMutation({ data: trace(1_000_000) });
  });
  r.rerender(panelEl());
}

/** One condition-change → pending-reset → arrival round trip. */
function conditionRoundTrip(r: ReturnType<typeof render>, notional: string, value: number) {
  fireEvent.change(screen.getByLabelText(/Notional/i), { target: { value: notional } });
  act(() => {
    setMutation({ data: undefined, isPending: true });
  });
  r.rerender(panelEl());
  act(() => {
    setMutation({ data: trace(value) });
  });
  r.rerender(panelEl());
}

describe("PnlTracePanel — F1 chart survives condition changes", () => {
  it("initial trace renders the chart with the series on the live chart", () => {
    const r = render(panelEl());
    landFirstTrace(r);

    expect(charts.length).toBe(1);
    expect(charts[0].series.length).toBe(1);
    const data = charts[0].series[0].setData.mock.calls.at(-1)![0] as { value: number }[];
    expect(data.at(-1)!.value).toBe(1_000_000);
  });

  it("condition change → reset → arrival: the NEW chart gets the series, never the disposed one", () => {
    const r = render(panelEl());
    landFirstTrace(r);
    const firstChart = charts[0];

    conditionRoundTrip(r, "200", 2_986);

    expect(firstChart.removed).toBe(true);
    expect(charts.length).toBe(2);
    const latest = charts[1];
    // THE pin: the visible (latest) chart carries the series with the NEW data.
    expect(latest.series.length).toBe(1);
    const data = latest.series[0].setData.mock.calls.at(-1)![0] as { value: number }[];
    expect(data.at(-1)!.value).toBe(2_986);
    // And nothing was ever attached to a disposed chart (the pre-fix path).
    for (const c of charts) expect(c.disposedAddSeries).toBe(0);
    // The header updated alongside (the owner's "data flows" observation).
    expect(screen.getByText(/Cumulative PnL as of/i)).toBeTruthy();
  });

  it("repeated condition changes keep working (no one-shot fix)", () => {
    const r = render(panelEl());
    landFirstTrace(r);

    for (const [notional, v] of [
      ["300", 5_000],
      ["400", 7_500],
    ] as const) {
      conditionRoundTrip(r, notional, v);
      const latest = charts.at(-1)!;
      expect(latest.series.length).toBe(1);
      const data = latest.series[0].setData.mock.calls.at(-1)![0] as { value: number }[];
      expect(data.at(-1)!.value).toBe(v);
      for (const c of charts) expect(c.disposedAddSeries).toBe(0);
    }
  });
});
