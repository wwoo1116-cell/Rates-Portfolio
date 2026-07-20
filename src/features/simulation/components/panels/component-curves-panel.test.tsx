// @vitest-environment jsdom
/**
 * HARDEN-1 — component-curves hero pins:
 *  - exactly five defs in waterfall order with the Korean labels;
 *  - valueKind:'krw' + NO formatter key on every def (s14 signed 억/만);
 *  - ZERO last-value badges (badge policy at five crossing series);
 *  - calendar whitespace slots for weekend/holiday days (s15 rule);
 *  - final curve values reconcile with totalReturnDecomposition (the
 *    waterfall's payload — path and destination agree);
 *  - blank policy: excluded-swap days are whitespace (gap), legend says 제외.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render as rtlRender, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { SeriesChartSeriesDef } from "@/components/charts/series-chart";
import type { SimulateResponse } from "../../api/simulate-dto";
import { DEFAULT_SCENARIO_PARAMS, EMPTY_SIMULATION_INPUTS } from "../../types/simulation-port";
import { useSimulationDataStore } from "../../store/simulation-data-store";

let captured: { series: SeriesChartSeriesDef[] } | null = null;
vi.mock("@/components/charts/series-chart", () => ({
  SeriesChart: (props: { series: SeriesChartSeriesDef[] }) => {
    captured = props;
    return <div data-testid="series-chart" />;
  },
}));

const { ComponentCurvesPanel } = await import("./component-curves-panel");

function render(ui: React.ReactElement) {
  const qc = new QueryClient();
  return rtlRender(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

// Days 0,1,4 — 2/3 are the "weekend": rows exist only for business days.
const DAILY = [
  { day: 0, fundingCost: 0, bondMtm: 0, bondCarry: 0, swapMtm: 0, swapCarry: 0, total: 0 },
  { day: 1, fundingCost: -100, bondMtm: 10, bondCarry: 200, swapMtm: 50, swapCarry: -20, total: 140 },
  { day: 4, fundingCost: -400, bondMtm: 40, bondCarry: 800, swapMtm: 90, swapCarry: -60, total: 470 },
];

const RESULT = {
  chartData: [{ day: 0, totalPnL: 0 }, { day: 4, totalPnL: 470 }],
  summary: { finalMTM: 40, finalCarry: 400, finalSwap: 30, finalTotal: 470, breakEvenDay: -1 },
  exclusions: [],
  totalReturnDecomposition: {
    bondMtm: 40, bondCarry: 800, fundingCost: -400, swapMtm: 90, swapCarry: -60, total: 470,
  },
  decompositionDaily: DAILY,
} as unknown as SimulateResponse;

function seed(result: SimulateResponse) {
  useSimulationDataStore.setState({
    params: DEFAULT_SCENARIO_PARAMS,
    inputs: { ...EMPTY_SIMULATION_INPUTS, baseDate: "2026-07-15" },
    lastRun: result,
    lastRunRequest: null,
    status: "success",
    error: null,
  });
}

beforeEach(() => {
  captured = null;
});
afterEach(cleanup);

const WANT_IDS = ["fundingCost", "bondMtm", "bondCarry", "swapMtm", "swapCarry"];
const WANT_LABELS = ["조달비용", "채권평가", "채권캐리", "스왑평가", "스왑캐리"];

describe("ComponentCurvesPanel (HARDEN-1)", () => {
  it("renders five defs in waterfall order, krw kind, zero badges, no formatter", () => {
    seed(RESULT);
    render(<ComponentCurvesPanel />);

    const defs = captured!.series;
    expect(defs.map((d) => d.id)).toEqual(WANT_IDS);
    expect(defs.map((d) => d.label)).toEqual(WANT_LABELS);
    for (const d of defs) {
      expect(d.valueKind).toBe("krw");
      expect("formatter" in d && d.formatter !== undefined).toBe(false);
      expect(d.lastValueBadge).toBe(false);
    }
    // Five distinct colors (the four SIM_SERIES hues + funding Navy-40).
    expect(new Set(defs.map((d) => d.color)).size).toBe(5);
  });

  it("fills the calendar axis with whitespace slots for non-business days (s15)", () => {
    seed(RESULT);
    render(<ComponentCurvesPanel />);

    for (const d of captured!.series) {
      expect(d.data.length).toBe(5); // days 0..4, every calendar day present
      const hasValue = d.data.map((p) => "value" in p);
      expect(hasValue).toEqual([true, true, false, false, true]);
    }
  });

  it("final curve values reconcile with the waterfall decomposition", () => {
    seed(RESULT);
    render(<ComponentCurvesPanel />);

    const d = RESULT.totalReturnDecomposition!;
    const finals = Object.fromEntries(
      captured!.series.map((s) => {
        const last = [...s.data].reverse().find((p) => "value" in p) as { value: number };
        return [s.id, last.value];
      }),
    );
    expect(finals).toEqual({
      fundingCost: d.fundingCost,
      bondMtm: d.bondMtm,
      bondCarry: d.bondCarry,
      swapMtm: d.swapMtm,
      swapCarry: d.swapCarry,
    });
  });

  it("excluded swaps: swap days become gaps (whitespace), legend carries 제외 —", () => {
    const excluded = {
      ...RESULT,
      exclusions: [{ assetClass: "swap", reason: "당일 IRS 호가 없음", asOf: "2026-07-15" }],
      decompositionDaily: DAILY.map((r) => ({ ...r, swapMtm: null, swapCarry: null })),
    } as unknown as SimulateResponse;
    seed(excluded);
    render(<ComponentCurvesPanel />);

    for (const id of ["swapMtm", "swapCarry"]) {
      const s = captured!.series.find((x) => x.id === id)!;
      expect(s.data.every((p) => !("value" in p))).toBe(true); // all gaps, no 0 line
    }
    expect(screen.getAllByText("제외 —").length).toBe(2);
  });

  it("responses without decompositionDaily get the honest re-run notice, no chart", () => {
    seed({ ...RESULT, decompositionDaily: undefined } as unknown as SimulateResponse);
    render(<ComponentCurvesPanel />);
    expect(screen.queryByTestId("series-chart")).toBeNull();
    expect(screen.getByText(/일별 성분 경로가 없습니다/)).toBeTruthy();
  });
});
