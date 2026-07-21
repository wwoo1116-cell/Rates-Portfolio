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
import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { buildSimulateRequest } from "../../lib/scenario-curves";
import { buildScenarioOverlay } from "../../lib/input-curve-preview";
import { createPathEvaluator } from "../../lib/recon/path-matrix";
import { sectorColor } from "@/lib/chart-colors";
import { buildTimePath } from "../../lib/scenario-preview";
import { DEFAULT_SCENARIO_PARAMS, EMPTY_SIMULATION_INPUTS } from "../../types/simulation-port";
import { useSimulationDataStore } from "../../store/simulation-data-store";
import { dayToTime } from "../charts/lw-line-chart";
import type { LwLineChartProps } from "../charts/lw-line-chart";

// Chart hosts are canvas — mock both and capture the path-branch props.
let lwProps: LwLineChartProps | null = null;
let termProps: { pillarLabels: string[]; curves: Array<{ label: string; color: string; dashed?: boolean; points: (number | null | undefined)[] }> } | null = null;
vi.mock("../charts/term-structure-chart", () => ({
  TermStructureChart: (props: never) => {
    termProps = props as typeof termProps;
    return <div data-testid="term-structure" />;
  },
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

// Network spies — the no-fetch pin asserts these are never touched in path
// mode. FB4: rich enough for 커브형 family curves (국고채 + 여전채 in the
// taxonomy; 통안채 deliberately ABSENT so the carried-only chip rule shows).
const snapshotSpy = vi.fn(async () => ({
  valuation_date: "2026-07-15",
  cd_rate: 0.029,
  swap_quotes: [
    { tenor_years: 1, tenor_months: null, rate: 0.0265 },
    { tenor_years: 3, tenor_months: null, rate: 0.0278 },
  ],
}));
const taxonomySpy = vi.fn(async () => ({
  sectors: [
    // 국고채 unrated; 여전채 RATED (FB5 B1: the panel must fetch its base curve
    // at the representative rating ratings[0], not the silent-blank rating:null).
    { sector: "국고채", ratings: [], tenors: ["1Y", "3Y"] },
    { sector: "여전채", ratings: ["AAA (카드)", "AA (카드)"], tenors: ["1Y", "3Y"] },
  ],
}));
const seriesSpy = vi.fn(async (reqBody: { legs: Array<{ sector: string; rating: string | null; tenor: string }> }) => ({
  results: reqBody.legs.map((leg) => ({
    sector: leg.sector,
    tenor: leg.tenor,
    points: [
      {
        valuation_date: "2026-07-15",
        value: (leg.sector === "여전채" ? 0.031 : 0.026) + (leg.tenor === "3Y" ? 0.001 : 0),
      },
    ],
  })),
}));
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
      series: (...a: unknown[]) => seriesSpy(a[0] as Parameters<typeof seriesSpy>[0]),
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

  // ── RECON-SCEN F2 — 시계열형 multi-series (tenor × 곡선군) ──

  it("F2 defaults: anchor 국고채 3Y pre-selected; every path-machinery pillar offered as a chip", () => {
    seed("path");
    render(<CurveViewPanel />);
    expect((screen.getByRole("button", { name: "3Y" }) as HTMLButtonElement).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("button", { name: "국고채" }) as HTMLButtonElement).getAttribute("aria-pressed")).toBe("true");
    for (const pillar of ["1D", "3M", "9Y", "10Y"]) {
      expect(screen.getByRole("button", { name: pillar })).toBeTruthy();
    }
    for (const fam of ["IRS", "공사채", "시은채", "회사채", "여전채"]) {
      expect((screen.getByRole("button", { name: fam }) as HTMLButtonElement).getAttribute("aria-pressed")).toBe("false");
    }
    expect(lwProps!.series.length).toBe(1); // anchor only, no policy series
  });

  it("F2 pin: a selected non-anchor tenor series equals the corresponding M2 matrix row", async () => {
    const { buildPathMatrix, PATH_PILLARS } = await import("../../lib/recon/path-matrix");
    seed("path");
    render(<CurveViewPanel />);
    fireEvent.click(screen.getByRole("button", { name: "5Y" }));

    expect(lwProps!.series.length).toBe(2); // anchor first + 5Y
    const request = buildSimulateRequest(useSimulationDataStore.getState().inputs, DEFAULT_SCENARIO_PARAMS);
    const m = buildPathMatrix(request, "국채");
    const i5y = PATH_PILLARS.findIndex((p) => p.label === "5Y");
    expect(lwProps!.series[1].data.map((p) => p.value)).toEqual(
      m.cumBp.map((row) => parseFloat(row[i5y].toFixed(2))),
    );
    // Anchor stays series[0] (markers/drag/zero-line host).
    const expected = buildTimePath(DEFAULT_SCENARIO_PARAMS, "2026-07-15");
    expect(lwProps!.series[0].data.map((p) => p.value)).toEqual(expected.map((p) => p.gov3y));
  });

  it("F2 pin: a family series equals base + its spread staircase (여전채 → 카드채 curve)", async () => {
    const { buildPathMatrix, PATH_PILLARS, createPathEvaluator } = await import("../../lib/recon/path-matrix");
    const params = {
      ...DEFAULT_SCENARIO_PARAMS,
      creditSpreads: { ...DEFAULT_SCENARIO_PARAMS.creditSpreads, 카드채: "12" },
    };
    seed("path", { params });
    render(<CurveViewPanel />);
    fireEvent.click(screen.getByRole("button", { name: "여전채" }));

    expect(lwProps!.series.length).toBe(2); // anchor + 여전채 3Y
    const request = buildSimulateRequest(useSimulationDataStore.getState().inputs, params);
    const m = buildPathMatrix(request, "카드채");
    const i3y = PATH_PILLARS.findIndex((p) => p.label === "3Y");
    const famValues = lwProps!.series[1].data.map((p) => p.value);
    expect(famValues).toEqual(m.cumBp.map((row) => parseFloat(row[i3y].toFixed(2))));
    // …which IS base + factor × its constant credit spread at every sample.
    const ev = createPathEvaluator(request);
    m.days.forEach((d, i) => {
      expect(famValues[i]).toBeCloseTo(
        parseFloat((ev.cumBpAt("국채", 3, d) + 12 * ev.factorAt(d)).toFixed(2)),
        2,
      );
    });
  });

  it("F2: deselecting the anchor removes waypoint markers and disables drag (no fake host series)", async () => {
    seed("path", { params: GRID });
    render(<CurveViewPanel />);
    await screen.findByLabelText("D+30 웨이포인트 드래그");
    fireEvent.click(screen.getByRole("button", { name: "5Y" })); // keep a tenor selected
    fireEvent.click(screen.getByRole("button", { name: "3Y" })); // drop the anchor
    expect(screen.queryByLabelText("D+30 웨이포인트 드래그")).toBeNull();
    expect(lwProps!.markers!.length).toBe(0);
    expect(screen.getByText(/드래그는 국고채 3Y 표시 중에만/)).toBeTruthy();
  });

  it("F2: the last selected tenor/family cannot be deselected (never an empty chart)", () => {
    seed("path");
    render(<CurveViewPanel />);
    fireEvent.click(screen.getByRole("button", { name: "3Y" }));
    expect((screen.getByRole("button", { name: "3Y" }) as HTMLButtonElement).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "국고채" }));
    expect((screen.getByRole("button", { name: "국고채" }) as HTMLButtonElement).getAttribute("aria-pressed")).toBe("true");
    expect(lwProps!.series.length).toBe(1);
  });

  it("F2: composite overlay — families × tenors, family colors distinct, policy series appended last", () => {
    seed("path", {
      params: {
        ...DEFAULT_SCENARIO_PARAMS,
        shortEndEvents: [{ id: 0, date: "2026-08-20", shiftBp: "-25" }],
      },
    });
    render(<CurveViewPanel />);
    fireEvent.click(screen.getByRole("button", { name: "10Y" }));
    fireEvent.click(screen.getByRole("button", { name: "IRS" }));
    // 2 tenors × 2 families + dashed policy = 5 series, anchor first, policy last.
    expect(lwProps!.series.length).toBe(5);
    expect(lwProps!.series[4].dashed).toBe(true);
    const colors = new Set(lwProps!.series.slice(0, 4).map((s) => s.color));
    expect(colors.size).toBe(2); // one established color per family
  });

  // ── FB5 B2 — 시계열형 per-series crosshair Δbp readout ──

  it("B2: crosshair readout shows each visible series' Δbp under the date; — on a whitespace day", () => {
    seed("path", { params: GRID });
    render(<CurveViewPanel />);
    fireEvent.click(screen.getByRole("button", { name: "5Y" })); // 2 tenor series

    // Series carry per-series labels for the readout (family + tenor).
    const labels = lwProps!.series.map((s) => s.label);
    expect(labels).toContain("국고채 3Y");
    expect(labels).toContain("국고채 5Y");

    // Feed the readout the way LwLineChart does from param.seriesData — the
    // panel renders those values verbatim (no recomputation), — for the null.
    act(() => {
      lwProps!.onCrosshairMove!({
        time: dayToTime("2026-07-15", 30),
        points: [
          { label: "국고채 3Y", color: "rgb(1,1,1)", value: 5 },
          { label: "국고채 5Y", color: "rgb(2,2,2)", value: null }, // whitespace
        ],
      });
    });

    expect(screen.getByText("2026-08-14")).toBeTruthy(); // baseDate + 30d (UTC)
    expect(screen.getByText("+5.0bp")).toBeTruthy();
    expect(screen.getByText("국고채 5Y")).toBeTruthy();
    // The null series reads — (honest whitespace), never a fabricated +0.0bp.
    expect(screen.queryByText("+0.0bp")).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("B2: crosshair leaving the data (null readout) hides the readout row", () => {
    seed("path", { params: GRID });
    render(<CurveViewPanel />);
    act(() => {
      lwProps!.onCrosshairMove!({
        time: dayToTime("2026-07-15", 30),
        points: [{ label: "국고채 3Y", color: "rgb(1,1,1)", value: 5 }],
      });
    });
    expect(screen.getByText("2026-08-14")).toBeTruthy();
    act(() => lwProps!.onCrosshairMove!(null));
    expect(screen.queryByText("2026-08-14")).toBeNull();
  });

  // ── FB4 T2 — 커브형: base curves × families + scenario overlay ──

  it("FB4/FB5: 국고채+IRS pressed; 여전채 offered (taxonomy-carried, full PVBP name); 통안채 NOT offered (no snapshot curve)", async () => {
    seed("curve");
    render(<CurveViewPanel />);
    expect(await screen.findByTestId("term-structure")).toBeTruthy();
    expect((screen.getByRole("button", { name: "국고채" }) as HTMLButtonElement).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("button", { name: "IRS" }) as HTMLButtonElement).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("button", { name: "여전채" }) as HTMLButtonElement).getAttribute("aria-pressed")).toBe("false");
    // 통안채/특은채 carry no distinct curve in the credit-matrix snapshot → absent,
    // never a clickable chip that silently draws nothing (FB5 honesty).
    expect(screen.queryByRole("button", { name: "통안채" })).toBeNull();
    expect(screen.queryByRole("button", { name: "특은채" })).toBeNull();
  });

  it("FB4 curves: solid base + same-color DASHED ghost per family — sector tokens only, no new hues", async () => {
    seed("curve");
    render(<CurveViewPanel />);
    await screen.findByTestId("term-structure");
    await waitFor(() => expect(termProps!.curves.length).toBe(4)); // 2 families × (base+ghost)
    const [govBase, govGhost, irsBase, irsGhost] = termProps!.curves;
    expect(govBase.label).toBe("국고채");
    expect(govGhost.label).toBe("국고채 시나리오");
    expect(govGhost.dashed).toBe(true);
    expect(govGhost.color).toBe(govBase.color);
    expect(govBase.color).toBe(sectorColor("국고채"));
    expect(irsGhost.dashed).toBe(true);
    expect(irsGhost.color).toBe(irsBase.color); // Tangerine — the established IRS hue
    // No-forked-math (panel-level): the ghost values ARE the lib overlay's.
    const { inputs, params } = useSimulationDataStore.getState();
    const req = buildSimulateRequest(inputs, params);
    const expected = buildScenarioOverlay(req, params.simDays, [
      { key: "국고채", quotes: [{ t: 1, label: "1Y", rate: 0.026 }, { t: 3, label: "3Y", rate: 0.027 }] },
    ]);
    expect(expected.series[0].shockedPct.length).toBeGreaterThan(0); // machinery reachable
  });

  it("FB4: selecting 여전채 adds its base+ghost pair in its sector token", async () => {
    seed("curve");
    render(<CurveViewPanel />);
    await screen.findByTestId("term-structure");
    fireEvent.click(screen.getByRole("button", { name: "여전채" }));
    await waitFor(() => expect(termProps!.curves.length).toBe(6));
    const card = termProps!.curves.find((c) => c.label === "여전채")!;
    expect(card.color).toBe(sectorColor("여전채"));
    expect(termProps!.curves.find((c) => c.label === "여전채 시나리오")!.dashed).toBe(true);
  });

  it("FB5 B1: a RATED sector fetches its base curve at the representative rating (not the silent rating:null)", async () => {
    seed("curve");
    render(<CurveViewPanel />);
    await screen.findByTestId("term-structure");
    fireEvent.click(screen.getByRole("button", { name: "여전채" }));
    // The offered chip DRAWS (base+ghost pair present) — no silent blank…
    await waitFor(() => expect(termProps!.curves.some((c) => c.label === "여전채")).toBe(true));
    // …because the request carried the taxonomy's representative rating
    // (ratings[0]) for every 여전채 leg, never null (the FB5 root-cause fix).
    await waitFor(() => {
      const cardLegs = seriesSpy.mock.calls.flatMap((c) => c[0].legs).filter((l) => l.sector === "여전채");
      expect(cardLegs.length).toBeGreaterThan(0);
      expect(cardLegs.every((l) => l.rating === "AAA (카드)")).toBe(true);
    });
    // And the representative rating is disclosed (never passed off as the whole sector).
    expect(screen.getByText(/기준 등급:.*여전채 AAA \(카드\)/)).toBeTruthy();
  });

  it("FB5 B1: 국고채 (unrated) still fetches with rating:null", async () => {
    seed("curve");
    render(<CurveViewPanel />);
    await screen.findByTestId("term-structure");
    await waitFor(() => {
      const govLegs = seriesSpy.mock.calls.flatMap((c) => c[0].legs).filter((l) => l.sector === "국고채");
      expect(govLegs.length).toBeGreaterThan(0);
      expect(govLegs.every((l) => l.rating === null)).toBe(true);
    });
  });

  it("FB5 B1 (ruling ④): every offered 커브형 family label is a PVBP sector name (or IRS)", async () => {
    const { SECTOR_ORDER } = await import("@/lib/chart-colors");
    const allowed = new Set<string>([...SECTOR_ORDER, "IRS"]);
    seed("curve");
    render(<CurveViewPanel />);
    await screen.findByTestId("term-structure");
    // The 곡선군 chip row: labels come straight from the PVBP taxonomy.
    for (const name of ["국고채", "IRS", "여전채"]) {
      expect(allowed.has(name)).toBe(true);
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("FB4: a PARALLEL scenario shows ONE terminal overlay — no scrubber; legend names the slice", async () => {
    seed("curve"); // DEFAULT params: exact linear ramp → not shaped
    render(<CurveViewPanel />);
    await screen.findByTestId("term-structure");
    expect(screen.queryByLabelText("시나리오 시점 (D+n)")).toBeNull();
    expect(screen.getByText(/점선 = 시나리오 \(D\+180\)/)).toBeTruthy();
  });

  it("FB4: a SHAPED scenario gets the D+n scrubber, readout bound to the slice, ghosts re-sliced through the evaluator", async () => {
    const shaped = {
      ...DEFAULT_SCENARIO_PARAMS,
      simDays: 90,
      waypoints: [
        { day: 0, bp: 0 },
        { day: 45, bp: 25 }, // off-line → shaped
        { day: 90, bp: 30 },
      ],
    };
    seed("curve", { params: shaped });
    render(<CurveViewPanel />);
    await screen.findByTestId("term-structure");

    const scrubber = screen.getByLabelText("시나리오 시점 (D+n)") as HTMLInputElement;
    expect(scrubber.max).toBe("90");
    // Default position = horizon end (the readout's exact D+n +bp format —
    // distinct from the header's unformatted "+30bp").
    expect(screen.getByText("D+90 +30.0bp")).toBeTruthy();

    fireEvent.change(scrubber, { target: { value: "45" } });
    // Readout binds to the slice: designed anchor bp at D+45 is the waypoint's 25.
    expect(screen.getByText("D+45 +25.0bp")).toBeTruthy();
    expect(screen.getByText(/점선 = 시나리오 \(D\+45\)/)).toBeTruthy();

    // Ghost points re-slice through the SAME evaluator (no forked math).
    await waitFor(() => {
      const govGhost = termProps!.curves.find((c) => c.label === "국고채 시나리오")!;
      const { inputs, params } = useSimulationDataStore.getState();
      const req = buildSimulateRequest(inputs, params);
      const ev = createPathEvaluator(req);
      const govBase = termProps!.curves.find((c) => c.label === "국고채")!;
      termProps!.pillarLabels.forEach((label, i) => {
        const base = govBase.points[i];
        const ghost = govGhost.points[i];
        if (base === undefined || base === null) return;
        const t = label === "1Y" ? 1 : 3;
        expect(ghost).toBeCloseTo((base as number) + ev.cumBpAt("국채", t, 45) / 100, 9);
      });
    });
  });

  it("FB4: an unselected family costs no request (per-family fetch gating)", async () => {
    seed("curve");
    render(<CurveViewPanel />);
    await screen.findByTestId("term-structure");
    await waitFor(() => expect(seriesSpy).toHaveBeenCalled());
    const sectorsRequested = seriesSpy.mock.calls.flatMap((c) => c[0].legs.map((l) => l.sector));
    expect(sectorsRequested).toContain("국고채");
    expect(sectorsRequested).not.toContain("여전채"); // offered but unselected
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

describe("CurveViewPanel — N1 anchor-driven gating", () => {
  it("anchor 5Y: its tenor chip auto-selects, drag caption names the anchor, markers ride it", () => {
    seed("path", {
      params: { ...DEFAULT_SCENARIO_PARAMS, anchorTenor: "5Y" },
    });
    render(<CurveViewPanel />);

    // The 5Y chip is pressed (auto-selected for the anchor)…
    const chip5y = screen.getAllByRole("button", { name: "5Y" })[0] as HTMLButtonElement;
    expect(chip5y.getAttribute("aria-pressed")).toBe("true");
    // …the caption names the anchor pillar…
    expect(screen.getByText(/국고채 5Y 드래그 가능/)).toBeTruthy();
    // …and waypoint markers exist (anchor visible ⇒ dots have a host series).
    expect(lwProps?.markers?.length).toBeGreaterThan(0);
  });

  it("anchor switch AFTER mount adds the new anchor chip without deselecting the old", () => {
    seed("path");
    render(<CurveViewPanel />);
    expect((screen.getAllByRole("button", { name: "3Y" })[0] as HTMLButtonElement).getAttribute("aria-pressed")).toBe("true");

    act(() => {
      useSimulationDataStore.setState((s) => ({
        params: { ...s.params, anchorTenor: "10Y" },
      }));
    });
    expect((screen.getAllByRole("button", { name: "10Y" })[0] as HTMLButtonElement).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getAllByRole("button", { name: "3Y" })[0] as HTMLButtonElement).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/국고채 10Y 드래그 가능|드래그는 국고채 10Y 표시 중에만/)).toBeTruthy();
  });
});
