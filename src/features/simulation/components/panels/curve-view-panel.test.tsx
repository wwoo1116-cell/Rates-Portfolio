// @vitest-environment jsdom
/**
 * SIM2-1 — 커브형/시계열형 toggle pins:
 *  - default is 커브형 with the term-structure chart (demo-sprint view intact);
 *  - 시계열형 renders buildTimePath through LwLineChart (dayToTime calendar
 *    slots), waypoint markers, dashed policy series when 금통위 events exist,
 *    and the +X.Xbp axis formatter;
 *  - 시계열형 performs ZERO network calls (base-quote hooks disabled);
 *  - payload parity: buildSimulateRequest is previewMode-blind;
 *  - previewMode survives unmount/remount (store-level, stage navigation).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render as rtlRender, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { buildSimulateRequest } from "../../lib/scenario-curves";
import { buildTimePath } from "../../lib/scenario-preview";
import { DEFAULT_SCENARIO_PARAMS, EMPTY_SIMULATION_INPUTS } from "../../types/simulation-port";
import { useSimulationDataStore } from "../../store/simulation-data-store";
import type { LwLineChartProps } from "../charts/lw-line-chart";

// Chart hosts are canvas — mock both and capture the path-branch props.
let lwProps: LwLineChartProps | null = null;
vi.mock("../charts/term-structure-chart", () => ({
  TermStructureChart: () => <div data-testid="term-structure" />,
}));
// Deterministic coordinate fakes for the SIM2-3 drag tests: price→y is
// (200 − bp), so coordinateToPrice(y) = 200 − y round-trips exactly.
const fakeChart = {
  timeScale: () => ({
    timeToCoordinate: () => 100,
    subscribeVisibleTimeRangeChange: () => {},
    unsubscribeVisibleTimeRangeChange: () => {},
  }),
} as never;
const fakeSeries = {
  priceToCoordinate: (bp: number) => 200 - bp,
  coordinateToPrice: (y: number) => 200 - y,
} as never;

vi.mock("../charts/lw-line-chart", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../charts/lw-line-chart")>();
  const { useEffect } = await import("react");
  return {
    ...actual,
    LwLineChart: (props: LwLineChartProps) => {
      lwProps = props;
      // Feed the coordinate seam the way the real host does (post-rebuild).
      const cb = props.onSeriesRebuilt;
      useEffect(() => {
        cb?.(fakeChart, fakeSeries);
      }, [cb]);
      return <div data-testid="lw-path-chart" />;
    },
  };
});

// Network spies — the no-fetch pin asserts these are never touched in path mode.
const snapshotSpy = vi.fn(async () => ({ valuation_date: "2026-07-15", cd_rate: 0.029, swap_quotes: [] }));
const taxonomySpy = vi.fn(async () => ({ sectors: [] }));
const seriesSpy = vi.fn(async () => ({ results: [] }));
vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    marketDataApi: {
      ...actual.marketDataApi,
      snapshot: (...a: unknown[]) => snapshotSpy(...(a as [])),
      dateRange: async () => ({ min_date: "", max_date: "", available_dates: [] }),
    },
    creditCurveApi: {
      taxonomy: (...a: unknown[]) => taxonomySpy(...(a as [])),
      series: (...a: unknown[]) => seriesSpy(...(a as [])),
    },
  };
});

const { CurveViewPanel } = await import("./curve-view-panel");

function render(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function seed(previewMode: "curve" | "path" = "curve", overrides: Record<string, unknown> = {}) {
  useSimulationDataStore.setState({
    params: DEFAULT_SCENARIO_PARAMS,
    inputs: { ...EMPTY_SIMULATION_INPUTS, baseDate: "2026-07-15" },
    lastRun: null,
    lastRunRequest: null,
    status: "idle",
    error: null,
    previewMode,
    ...overrides,
  });
}

beforeEach(() => {
  lwProps = null;
  snapshotSpy.mockClear();
  taxonomySpy.mockClear();
  seriesSpy.mockClear();
  // jsdom has no pointer-capture API; the drag handles call it on every drag.
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
  }
});
afterEach(cleanup);

describe("CurveViewPanel 커브형/시계열형 (SIM2-1)", () => {
  it("defaults to 커브형: term-structure chart + pressed segment", async () => {
    seed("curve");
    render(<CurveViewPanel />);
    // findBy: the quote queries start pending (loading placeholder) and
    // resolve in a microtask — the chart mounts once they settle.
    expect(await screen.findByTestId("term-structure")).toBeTruthy();
    expect(screen.queryByTestId("lw-path-chart")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "커브형" }) as HTMLButtonElement).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("시계열형 renders buildTimePath through LwLineChart with waypoint markers", () => {
    seed("curve");
    render(<CurveViewPanel />);
    fireEvent.click(screen.getByRole("button", { name: "시계열형" }));

    expect(screen.getByTestId("lw-path-chart")).toBeTruthy();
    expect(screen.queryByTestId("term-structure")).toBeNull();
    expect(useSimulationDataStore.getState().previewMode).toBe("path");

    // Gov series data == buildTimePath output (same lerp as the BE _factor).
    const expected = buildTimePath(DEFAULT_SCENARIO_PARAMS, "2026-07-15");
    expect(lwProps!.series[0].data.map((p) => p.value)).toEqual(expected.map((p) => p.gov3y));
    // Default params carry no 금통위 events → single series, no dashed line.
    expect(lwProps!.series.length).toBe(1);
    // One marker per store waypoint (default: D+0 and D+simDays).
    expect(lwProps!.markers!.length).toBe(DEFAULT_SCENARIO_PARAMS.waypoints.length);
    // bp axis format on the pane.
    expect(lwProps!.formatValue!(12.34)).toBe("+12.3bp");
    expect(lwProps!.formatValue!(-5)).toBe("-5.0bp");
  });

  it("adds the dashed policy series when 금통위 events exist", () => {
    seed("path", {
      params: {
        ...DEFAULT_SCENARIO_PARAMS,
        shortEndEvents: [{ id: 0, date: "2026-08-20", shiftBp: "-25" }],
      },
    });
    render(<CurveViewPanel />);
    expect(lwProps!.series.length).toBe(2);
    expect(lwProps!.series[1].dashed).toBe(true);
    expect(screen.getByText(/점선 = 기준금리 누적 변동/)).toBeTruthy();
  });

  it("시계열형 performs ZERO network calls (base-quote hooks disabled)", () => {
    seed("path");
    render(<CurveViewPanel />);
    expect(screen.getByTestId("lw-path-chart")).toBeTruthy();
    expect(snapshotSpy).not.toHaveBeenCalled();
    expect(taxonomySpy).not.toHaveBeenCalled();
    expect(seriesSpy).not.toHaveBeenCalled();
  });

  it("payload parity: buildSimulateRequest is previewMode-blind", () => {
    seed("curve");
    const { inputs, params } = useSimulationDataStore.getState();
    const inCurveMode = buildSimulateRequest(inputs, params);
    useSimulationDataStore.getState().setPreviewMode("path");
    const inPathMode = buildSimulateRequest(inputs, params);
    expect(inPathMode).toEqual(inCurveMode);
    expect("previewMode" in inPathMode).toBe(false);
  });

  // ── SIM2-3 (ruling ②) — waypoint dot drag on the 시계열형 preview ──

  const GRID = {
    ...DEFAULT_SCENARIO_PARAMS,
    waypoints: [
      { day: 0, bp: 0 },
      { day: 30, bp: 5 },
      { day: 60, bp: 10 },
      { day: 180, bp: 30 },
    ],
  };

  it("drags an intermediate dot: snapped commit through the shared patch, day flagged touched", async () => {
    seed("path", { params: GRID });
    render(<CurveViewPanel />);
    const handle = await screen.findByLabelText("D+30 웨이포인트 드래그");

    // coordinateToPrice(y) = 200 − y: pointer at clientY 173 → 27bp → snap 25.
    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 195 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 173 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 173 });

    const { params } = useSimulationDataStore.getState();
    expect(params.waypoints.find((w) => w.day === 30)?.bp).toBe(25);
    expect(params.touchedWaypointDays).toContain(30);
  });

  it("clamps a wild drag at ±max(|baseShock|+50, 100)", async () => {
    seed("path", { params: GRID });
    render(<CurveViewPanel />);
    const handle = await screen.findByLabelText("D+60 웨이포인트 드래그");
    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 190 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: -900 }); // → 1100bp raw
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: -900 });
    expect(useSimulationDataStore.getState().params.waypoints.find((w) => w.day === 60)?.bp).toBe(100);
  });

  it("renders NO drag handles for the D+0 and terminal pins", async () => {
    seed("path", { params: GRID });
    render(<CurveViewPanel />);
    await screen.findByLabelText("D+30 웨이포인트 드래그");
    expect(screen.queryByLabelText("D+0 웨이포인트 드래그")).toBeNull();
    expect(screen.queryByLabelText("D+180 웨이포인트 드래그")).toBeNull();
  });

  it("previewMode survives unmount/remount (stage navigation)", () => {
    seed("curve");
    const first = render(<CurveViewPanel />);
    fireEvent.click(screen.getByRole("button", { name: "시계열형" }));
    first.unmount();

    render(<CurveViewPanel />);
    expect(screen.getByTestId("lw-path-chart")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "시계열형" }) as HTMLButtonElement).getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
