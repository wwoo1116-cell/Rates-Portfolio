// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { DEFAULT_SCENARIO_PARAMS, EMPTY_SIMULATION_INPUTS } from "../types/simulation-port";
import { useSimulationDataStore } from "../store/simulation-data-store";
import type { SimulateRequest, SimulateResponse } from "../api/simulate-dto";
import { SimulationFlow } from "./simulation-flow";

/**
 * s15 T3 — stage-flow semantics: Configure → Running → Results, 조건 수정
 * back-navigation with inputs preserved, cancel returning to Configure, and
 * the Results surface's blank-MtM rendering for excluded swaps.
 *
 * Chart internals are canvas (lightweight-charts) — mocked; the flow logic
 * under test is stage resolution + the Results card, both DOM.
 */
vi.mock("./panels/curve-view-panel", () => ({
  CurveViewPanel: () => <div data-testid="curve-preview" />,
}));
// HARDEN-1: the Results hero is the component-curves panel (fan removed).
vi.mock("./panels/component-curves-panel", () => ({
  ComponentCurvesPanel: () => <div data-testid="curves-hero" />,
}));

const REQUEST = {
  simDays: 180,
  baseShockBp: 30,
  sigma_bp: 2.0,
} as unknown as SimulateRequest;

const RESULT: SimulateResponse = {
  chartData: [
    { day: 0, totalPnL: 0 },
    { day: 180, totalPnL: 1_234_567 },
  ],
  summary: { finalMTM: -100, finalCarry: 200, finalSwap: 0, finalTotal: 100, breakEvenDay: -1 },
  fundingCurve: [
    { day: 0, date: "2026-07-16", fundingRate: 0.0285, positionRate: 0.0326, carryBp: 41.0 },
    { day: 180, date: "2027-01-12", fundingRate: 0.0285, positionRate: 0.0326, carryBp: 41.0 },
  ],
  distribution: null,
  exclusions: [{ assetClass: "swap", reason: "당일 IRS 호가 없음", asOf: "2026-07-16" }],
  totalReturnDecomposition: {
    bondMtm: -34_560_000,
    bondCarry: 89_000_000,
    fundingCost: -54_340_000,
    swapMtm: null,
    swapCarry: null,
    total: 100_000,
  },
};

function renderFlow() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <SimulationFlow />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useSimulationDataStore.setState({
    params: DEFAULT_SCENARIO_PARAMS,
    inputs: EMPTY_SIMULATION_INPUTS,
    lastRun: null,
    lastRunRequest: null,
    status: "idle",
    error: null,
  });
});
afterEach(cleanup);

describe("SimulationFlow (s15 staged flow)", () => {
  it("starts on Configure", () => {
    renderFlow();
    expect(screen.getByText("시나리오 조건 설정")).toBeTruthy();
  });

  it("shows the Running interstitial with engine stages, elapsed clock and cancel", () => {
    renderFlow();
    act(() => useSimulationDataStore.getState().markRunning());
    expect(screen.getByText("엔진 계산 중")).toBeTruthy();
    expect(screen.getByText("커브 부트스트랩")).toBeTruthy();
    expect(screen.getByText("시나리오 프라이싱")).toBeTruthy();
    expect(screen.getByText("분위수 구성")).toBeTruthy();
    expect(screen.getByRole("button", { name: "취소" })).toBeTruthy();
  });

  it("cancel returns to Configure and keeps the previous result untouched", () => {
    renderFlow();
    act(() => useSimulationDataStore.getState().ingestResult(REQUEST, RESULT));
    act(() => useSimulationDataStore.getState().markRunning());
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(useSimulationDataStore.getState().status).toBe("idle");
    expect(useSimulationDataStore.getState().lastRun).toBe(RESULT);
    expect(screen.getByText("시나리오 조건 설정")).toBeTruthy();
  });

  it("lands on Results when a run completes, with scenario chips + 조건 수정", () => {
    renderFlow();
    act(() => useSimulationDataStore.getState().markRunning());
    act(() => useSimulationDataStore.getState().ingestResult(REQUEST, RESULT));

    expect(screen.getByTestId("curves-hero")).toBeTruthy();
    expect(screen.getByText("D+180")).toBeTruthy();       // 기간 chip
    expect(screen.getByText("+30bp")).toBeTruthy();       // 목표 변동 chip
    expect(screen.getByText("2.85%")).toBeTruthy();       // Funding chip (constant)
    expect(screen.getByText("+41.0bp")).toBeTruthy();     // Carry chip == 운용 − funding
    expect(screen.getByRole("button", { name: "조건 수정" })).toBeTruthy();
  });

  it("renders the swap exclusion notice and blank (—) swap lines, never +0", () => {
    renderFlow();
    act(() => useSimulationDataStore.getState().markRunning());
    act(() => useSimulationDataStore.getState().ingestResult(REQUEST, RESULT));

    expect(screen.getByText(/스왑 제외 — 당일 IRS 호가 없음/)).toBeTruthy();
    const swapCells = screen.getAllByText("—");
    expect(swapCells.length).toBe(2); // 스왑 MTM + 스왑 캐리, both blank
    expect(screen.queryByText("+0만")).toBeNull();
  });

  it("SIM2-5: stepped funding renders the range chip, never a bare single number", () => {
    renderFlow();
    const steppedReq = { ...REQUEST, fundingStepping: true } as unknown as SimulateRequest;
    const steppedResult = {
      ...RESULT,
      fundingCurve: [
        { day: 0, date: "2026-07-16", fundingRate: 0.0285, positionRate: 0.0326, carryBp: 41.0 },
        { day: 180, date: "2027-01-12", fundingRate: 0.026, positionRate: 0.0326, carryBp: 66.0 },
      ],
    };
    act(() => useSimulationDataStore.getState().markRunning());
    act(() => useSimulationDataStore.getState().ingestResult(steppedReq, steppedResult));

    expect(screen.getByText("Funding(만기)")).toBeTruthy();
    expect(screen.getByText("2.85%→2.60%")).toBeTruthy();
    expect(screen.queryByText(/^2\.60%$/)).toBeNull(); // no bare single number
  });

  it("조건 수정 returns to Configure with all params preserved", () => {
    renderFlow();
    act(() => useSimulationDataStore.getState().patchParams({ baseShockBp: "45" }));
    act(() => useSimulationDataStore.getState().markRunning());
    act(() => useSimulationDataStore.getState().ingestResult(REQUEST, RESULT));

    fireEvent.click(screen.getByRole("button", { name: "조건 수정" }));
    expect(screen.getByText("시나리오 조건 설정")).toBeTruthy();
    expect(useSimulationDataStore.getState().params.baseShockBp).toBe("45");
    // The previous result is still in the store (replaced only on new arrival).
    expect(useSimulationDataStore.getState().lastRun).toBe(RESULT);
  });
});
