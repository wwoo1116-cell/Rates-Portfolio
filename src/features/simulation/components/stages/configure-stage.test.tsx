// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { DEFAULT_SCENARIO_PARAMS, EMPTY_SIMULATION_INPUTS } from "../../types/simulation-port";
import { buildSimulateRequest } from "../../lib/scenario-curves";
import { useSimulationDataStore } from "../../store/simulation-data-store";
import { ConfigureStage } from "./configure-stage";

/**
 * s15 T3 — the Configure stage keeps the S4/§4.2 interaction coverage the
 * superseded ScenarioConfigPanel carried (renamed test-for-test): the stage
 * renders and drives the SimulationDataPort with IDENTICAL store keys and
 * payload semantics. The live curve preview is canvas (lightweight-charts) and
 * can't run in jsdom, so it's mocked out — its logic is covered by
 * scenario-preview tests.
 */
vi.mock("../panels/curve-view-panel", () => ({
  CurveViewPanel: () => <div data-testid="curve-preview" />,
}));

function renderStage() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <ConfigureStage />
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

describe("ConfigureStage (s15 staged flow — configure)", () => {
  it("renders defaults and disables Run when there are no positions", () => {
    renderStage();
    expect(screen.getByText("시나리오 조건 설정")).toBeTruthy();
    expect(screen.getByText("180 Days")).toBeTruthy();
    const run = screen.getByRole("button", { name: /시뮬레이션 실행/ }) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
  });

  it("shows the live curve preview beside the controls", () => {
    renderStage();
    expect(screen.getByTestId("curve-preview")).toBeTruthy();
  });

  it("collapses waypoints, curve spreads and 금통위 into closed 고급 설정 accordions", () => {
    const { container } = renderStage();
    expect(screen.getByText("고급 설정")).toBeTruthy();
    const accordions = container.querySelectorAll("details");
    expect(accordions.length).toBe(3);
    for (const d of accordions) expect(d.open).toBe(false);
  });

  it("edits the horizon through the port (segmented button → store → display)", () => {
    renderStage();
    fireEvent.click(screen.getByRole("button", { name: "90D" }));
    expect(useSimulationDataStore.getState().params.simDays).toBe(90);
    expect(screen.getByText("90 Days")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "90D" }) as HTMLButtonElement).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("edits the base shock through the port", () => {
    renderStage();
    const input = screen.getByDisplayValue("30");
    fireEvent.change(input, { target: { value: "45" } });
    expect(useSimulationDataStore.getState().params.baseShockBp).toBe("45");
  });

  it("auto-regenerates the 30-day waypoint rows for the horizon", () => {
    renderStage();
    // 180d → intermediate waypoints at 30/60/90/120/150 (5 stepper fields).
    expect(screen.getAllByLabelText(/^D\+\d+ 변동폭$/).length).toBe(5);
  });

  it("contains zero slide toggles / range sliders (s11 T2 acceptance)", () => {
    const { container } = renderStage();
    expect(screen.queryAllByRole("slider").length).toBe(0);
    expect(container.querySelectorAll('input[type="range"]').length).toBe(0);
  });

  it("steps a waypoint with the ∓/± buttons and accepts typed values", () => {
    renderStage();
    fireEvent.click(screen.getByRole("button", { name: "D+30 변동폭 5bp 증가" }));
    expect(
      useSimulationDataStore.getState().params.waypoints.find((w) => w.day === 30)?.bp,
    ).toBe(5);

    fireEvent.change(screen.getByLabelText("D+60 변동폭"), { target: { value: "-12" } });
    expect(
      useSimulationDataStore.getState().params.waypoints.find((w) => w.day === 60)?.bp,
    ).toBe(-12);
  });

  // HARDEN-1 (supersedes the DEMO-DEBT σ-test skip): the σ/fan design left
  // the Simulation surface PERMANENTLY (owner ruling) — the old stepper test
  // is rewritten to pin the CURRENT spec instead of waiting for a control
  // that is not coming back.
  it("σ removal is permanent: no σ control, engine σ contract intact (HARDEN-1)", () => {
    renderStage();
    // No σ control or fan-band affordance anywhere on Configure.
    expect(screen.queryByText(/분포 σ/)).toBeNull();
    expect(screen.queryByLabelText("분포 σ")).toBeNull();
    expect(screen.queryByText(/팬 차트/)).toBeNull();
    // The REQUEST contract is untouched: sigmaBp default survives in the
    // store and buildSimulateRequest still ships sigma_bp = 2.0.
    const { params, inputs } = useSimulationDataStore.getState();
    expect(params.sigmaBp).toBe("2.0");
    expect(buildSimulateRequest(inputs, params).sigma_bp).toBe(2.0);
  });

  it("keeps waypoint state semantics identical for equivalent selections (payload parity)", () => {
    // The same {simDays, waypoints} the sliders would have produced: the store
    // shape is unchanged, so buildSimulateRequest sees identical params.
    renderStage();
    fireEvent.click(screen.getByRole("button", { name: "90D" }));
    fireEvent.change(screen.getByLabelText("D+30 변동폭"), { target: { value: "10" } });
    const { params } = useSimulationDataStore.getState();
    expect(params.simDays).toBe(90);
    expect(params.waypoints).toEqual([
      { day: 0, bp: 0 },
      { day: 30, bp: 10 },
      { day: 60, bp: 0 },
      { day: 90, bp: 30 },
    ]);
  });
});
