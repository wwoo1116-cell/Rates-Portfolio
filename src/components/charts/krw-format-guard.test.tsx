// @vitest-environment jsdom
/**
 * s14 KRW chart-surface guard: renders every non-Simulation KRW chart fixture
 * against a recording lightweight-charts fake and asserts that no axis
 * formatter, last-value badge, marker text, or tooltip output ever emits a
 * raw-decimal KRW value (/\d+\.\d{2}/) — the signed 억/만 formatter must
 * arrive BY DEFAULT (valueKind or shared import), not per-chart wiring.
 *
 * Also exercises the s14 badge collision policy end-to-end at the component
 * level (the pure rule is unit-tested in chart-defaults.test.ts).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

const rec = vi.hoisted(() => ({
  seriesOptions: [] as Record<string, unknown>[],
  series: [] as { options: Record<string, unknown> }[],
  markerTexts: [] as string[],
  crosshairHandlers: [] as ((p: unknown) => void)[],
  reset() {
    this.seriesOptions.length = 0;
    this.series.length = 0;
    this.markerTexts.length = 0;
    this.crosshairHandlers.length = 0;
  },
}));

const tracePoints = vi.hoisted(() => [
  { valuation_date: "2026-07-01", cumulative_pnl: 12_345_678.9, daily_pnl: 2_345_678.9, delta: 456_789.5 },
  { valuation_date: "2026-07-02", cumulative_pnl: -98_765_432.1, daily_pnl: -1_234_567.8, delta: 456_789.5 },
]);

vi.mock("lightweight-charts", () => {
  class FakeSeries {
    options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      this.options = { ...options };
      rec.seriesOptions.push(this.options);
      rec.series.push(this);
    }
    applyOptions(o: Record<string, unknown>) {
      Object.assign(this.options, o);
    }
    setData() {}
    createPriceLine() {
      return {};
    }
    removePriceLine() {}
  }
  const recordMarkers = (ms: readonly { text?: string }[] | undefined) => {
    for (const m of ms ?? []) if (m.text) rec.markerTexts.push(m.text);
  };
  return {
    createChart: () => ({
      addSeries: (_type: unknown, options: Record<string, unknown>) => new FakeSeries(options),
      removeSeries: () => {},
      priceScale: () => ({ applyOptions: () => {} }),
      // s20: hosts fit via ensureFullDomainFit, which also subscribes to
      // range/size events — the stub carries inert versions of those.
      timeScale: () => ({
        fitContent: () => {},
        setVisibleLogicalRange: () => {},
        width: () => 400,
        getVisibleLogicalRange: () => null,
        subscribeVisibleLogicalRangeChange: () => {},
        unsubscribeVisibleLogicalRangeChange: () => {},
        subscribeSizeChange: () => {},
        unsubscribeSizeChange: () => {},
      }),
      subscribeClick: () => {},
      subscribeCrosshairMove: (cb: (p: unknown) => void) => {
        rec.crosshairHandlers.push(cb);
      },
      unsubscribeCrosshairMove: (cb: (p: unknown) => void) => {
        const i = rec.crosshairHandlers.indexOf(cb);
        if (i >= 0) rec.crosshairHandlers.splice(i, 1);
      },
      applyOptions: () => {},
      remove: () => {},
    }),
    CrosshairMode: { Normal: 0 },
    LineSeries: "Line",
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2 },
    createSeriesMarkers: (_s: unknown, initial?: { text?: string }[]) => {
      recordMarkers(initial);
      return { setMarkers: recordMarkers, detach: () => {} };
    },
  };
});

vi.mock("@/components/charts/snap-reticle", () => ({
  paneOffsetX: () => 0,
  snapReticleToNearestSeries: () => null,
  seriesDistanceY: () => null,
}));

vi.mock("@/hooks/use-api", () => ({
  useMarketDataRange: () => ({ data: { max_date: "2026-07-15" }, isLoading: false, isError: false }),
  // HARDEN-1: PnlTracePanel now consumes the par-prefill hook — no data here
  // (the guard exercises formatting, not the prefill).
  useHistoricalQuote: () => ({ data: null, isLoading: false }),
  useNpvTrace: () => ({
    mutate: () => {},
    data: { points: tracePoints },
    isError: false,
    error: null,
    isPending: false,
  }),
  usePositionMtmHistory: () => ({ data: null, isLoading: false, isError: false }),
}));

// Entry Signals siblings: the equity fixture exercises only the chart wiring.
vi.mock("@/features/entry-signals/hooks/use-entry-signals-data", () => ({
  useEntrySignalsData: () => ({
    focusedSeries: { id: "irs-3y", kind: "outright", label: "IRS 3Y", lineData: [] },
    isLoading: false,
    isError: false,
  }),
}));
// s17: the equity curve is pinned to the run snapshot — same fixture result,
// now delivered through the pinned seam instead of the live-params hook.
vi.mock("@/features/entry-signals/hooks/use-pinned-backtest", () => ({
  usePinnedBacktest: () => ({
    run: { instrument: { id: "irs-3y" }, ranAt: "2026-07-16T00:00:00Z" },
    label: "IRS 3Y",
    result: {
      points: [
        { date: "2026-07-01", value: 0, z: 0, position: 0, dailyPnl: 0, cumulativePnl: 1_234_567.89 },
        { date: "2026-07-02", value: 0, z: 0, position: 0, dailyPnl: 0, cumulativePnl: 3_456_789.12 },
      ],
      trades: [{ entryDate: "2026-07-01", exitDate: "2026-07-02", direction: 1, pnl: 3_456_789.12 }],
      summary: { totalPnl: 3_456_789.12, maxDrawdown: 0, winRate: 1, sharpe: null, numTrades: 1 },
    },
  }),
  useRunIsStale: () => false,
}));
vi.mock("@/stores/entry-signals-store", () => ({
  useEntrySignalsStore: (sel: (s: { focused: unknown }) => unknown) => sel({ focused: { id: "irs-3y" } }),
}));
vi.mock("@/features/entry-signals/components/panels/panel-shell", () => ({
  PanelEmptyState: () => null,
  SyncedTimeGuide: () => null,
  NumberField: () => null,
}));
vi.mock("@/features/entry-signals/hooks/use-synced-time-scales", () => ({
  registerSyncChart: () => {},
  unregisterSyncChart: () => {},
  setSharedHoverTime: () => {},
  syncSetLogicalRange: () => {}, // s20: the group-fit applier the panels pass
}));

import { SeriesChart, type SeriesChartSeriesDef } from "./series-chart";
import { MtmHistoryChart } from "@/features/portfolio/details-panel";
import { SpreadPnlChart } from "@/features/home/spread-pnl-chart";
import { PnlTracePanel } from "@/features/home/pnl-trace-panel";
import { EquityCurvePanel } from "@/features/entry-signals/components/panels/equity-curve-panel";

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", FakeResizeObserver);

/** A raw-decimal KRW leak: "12345678.91", "-450.25" etc. on a KRW surface. */
const RAW_DECIMAL = /\d+\.\d{2}/;
const KRW_PROBES = [123_456_789.12, -45_678_901.23, 3_456.78, 98_765_432_109.87, -0.55, 0];

function expectCleanKrwFormatter(options: Record<string, unknown>, label: string) {
  const priceFormat = options.priceFormat as { formatter?: (v: number) => string } | undefined;
  // Missing custom formatter == the library's 2dp float default — a leak.
  expect(priceFormat?.formatter, `${label}: KRW series must carry a custom formatter`).toBeTypeOf("function");
  for (const v of KRW_PROBES) {
    expect(priceFormat!.formatter!(v), `${label}: formatter(${v})`).not.toMatch(RAW_DECIMAL);
  }
}

afterEach(() => {
  cleanup();
  rec.reset();
});

describe("Portfolio MtM (1Y) — MtmHistoryChart", () => {
  const points = [
    { valuation_date: "2026-07-01", clean_npv: 123_456_789.12 },
    { valuation_date: "2026-07-02", clean_npv: -45_678_901.23 },
  ] as Parameters<typeof MtmHistoryChart>[0]["points"];

  it("axis/badge formatter arrives from valueKind and emits no raw decimals", () => {
    render(<MtmHistoryChart points={points} />);
    expect(rec.seriesOptions).toHaveLength(1);
    expectCleanKrwFormatter(rec.seriesOptions[0], "portfolio-mtm");
    expect(rec.seriesOptions[0].lastValueVisible).toBe(true); // single series keeps its badge
  });

  it("crosshair tooltip renders 억/만, never raw decimals", async () => {
    render(<MtmHistoryChart points={points} />);
    const handler = rec.crosshairHandlers.at(-1)!;
    await act(async () => {
      handler({
        point: { x: 100, y: 40 },
        time: "2026-07-01",
        seriesData: new Map([[rec.series[0], { value: 123_456_789.12 }]]),
      });
    });
    expect(screen.getByText("+1.2억")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(RAW_DECIMAL);
  });
});

describe("Home spread P&L — SpreadPnlChart", () => {
  it("inherits the KRW default, keeps its badge off, and emits no raw decimals", () => {
    render(
      <SpreadPnlChart
        data={[
          { time: "2026-07-01", value: 1_234_567.89 },
          { time: "2026-07-02", value: -7_654_321.09 },
        ]}
      />,
    );
    expect(rec.seriesOptions).toHaveLength(1);
    expectCleanKrwFormatter(rec.seriesOptions[0], "spread-pnl");
    expect(rec.seriesOptions[0].lastValueVisible).toBe(false); // header readout owns the last value
    expect(rec.seriesOptions[0].priceLineVisible).toBe(false);
  });
});

describe("Home PnL Trace — PnlTracePanel", () => {
  function renderPanel() {
    const props = { params: { point: { valuation_date: "2026-07-01" } } } as unknown as Parameters<
      typeof PnlTracePanel
    >[0];
    return render(<PnlTracePanel {...props} />);
  }

  it("axis formatter, min/max markers, and final badge all use 억/만", () => {
    renderPanel();
    expect(rec.seriesOptions).toHaveLength(1);
    expectCleanKrwFormatter(rec.seriesOptions[0], "pnl-trace");
    const minMax = rec.markerTexts.filter((t) => /^(Max|Min):/.test(t));
    expect(minMax).toHaveLength(2);
    for (const t of minMax) expect(t).not.toMatch(RAW_DECIMAL);
    expect(screen.getByText("-9,877만 KRW")).toBeTruthy(); // final cumulative badge
  });

  it("hover tooltip (delta / daily / cumulative) emits no raw decimals", async () => {
    renderPanel();
    const handler = rec.crosshairHandlers.at(-1)!;
    await act(async () => {
      handler({ time: "2026-07-01", point: { x: 60, y: 30 } });
    });
    expect(screen.getByText(/\+1,235만 KRW/)).toBeTruthy(); // cumulative row
    expect(document.body.textContent).not.toMatch(RAW_DECIMAL);
  });
});

describe("Entry Signals backtest — EquityCurvePanel", () => {
  it("axis formatter and net readout use 억/만, never raw won digits", () => {
    render(<EquityCurvePanel />);
    expect(rec.seriesOptions).toHaveLength(1);
    expectCleanKrwFormatter(rec.seriesOptions[0], "es-equity");
    expect(screen.getByText("+346만")).toBeTruthy(); // header net readout
    expect(document.body.textContent).not.toMatch(RAW_DECIMAL);
  });
});

describe("badge collision policy on the canonical SeriesChart (s14 T3)", () => {
  const def = (id: string, extra?: Partial<SeriesChartSeriesDef>): SeriesChartSeriesDef => ({
    id,
    label: id,
    color: "#000000",
    data: [{ time: "2026-07-01", value: 1 }],
    valueKind: "krw",
    ...extra,
  });

  it("over the limit, only the primary series keeps its badge (and axis title)", () => {
    render(<SeriesChart series={[def("a", { primary: true }), def("b"), def("c")]} />);
    expect(rec.series.map((s) => s.options.lastValueVisible)).toEqual([true, false, false]);
    // lw-charts renders `title` on the axis even without the value badge —
    // the policy must blank it or the pile survives as labels.
    expect(rec.series.map((s) => s.options.title)).toEqual(["a", "", ""]);
  });

  it("at or under the limit every badge stays on", () => {
    render(<SeriesChart series={[def("a"), def("b")]} />);
    expect(rec.series.map((s) => s.options.lastValueVisible)).toEqual([true, true]);
  });

  it("per-chart badgeLimit override opts a chart out of the policy", () => {
    render(<SeriesChart series={[def("a"), def("b"), def("c")]} badgeLimit={Infinity} />);
    expect(rec.series.map((s) => s.options.lastValueVisible)).toEqual([true, true, true]);
  });
});
