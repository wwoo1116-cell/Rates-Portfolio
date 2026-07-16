// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { DEFAULT_SCENARIO_PARAMS, EMPTY_SIMULATION_INPUTS } from "../../types/simulation-port";
import { useSimulationDataStore } from "../../store/simulation-data-store";
import { ScenarioConfigPanel } from "./scenario-config-panel";

/**
 * S4/§4.2 interaction smoke test (the browser-free slice of validation): the config
 * panel renders and drives the SimulationDataPort. Chart panels can't run here (canvas
 * needs a real browser) — that's the deferred Playwright visual pass.
 */
function renderPanel() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <ScenarioConfigPanel />
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

describe("ScenarioConfigPanel (S4 interaction)", () => {
  it("renders defaults and disables Run when there are no positions", () => {
    renderPanel();
    expect(screen.getByText("시나리오 조건 설정")).toBeTruthy();
    expect(screen.getByText("180 Days")).toBeTruthy();
    const run = screen.getByRole("button", { name: /시뮬레이션 실행/ }) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
  });

  it("edits the horizon through the port (segmented button → store → display)", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "90D" }));
    expect(useSimulationDataStore.getState().params.simDays).toBe(90);
    expect(screen.getByText("90 Days")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "90D" }) as HTMLButtonElement).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("edits the base shock through the port", () => {
    renderPanel();
    const input = screen.getByDisplayValue("30");
    fireEvent.change(input, { target: { value: "45" } });
    expect(useSimulationDataStore.getState().params.baseShockBp).toBe("45");
  });

  it("auto-regenerates the 30-day waypoint rows for the horizon", () => {
    renderPanel();
    // 180d → intermediate waypoints at 30/60/90/120/150 (5 stepper fields).
    expect(screen.getAllByLabelText(/^D\+\d+ 변동폭$/).length).toBe(5);
  });

  it("contains zero slide toggles / range sliders (s11 T2 acceptance)", () => {
    const { container } = renderPanel();
    expect(screen.queryAllByRole("slider").length).toBe(0);
    expect(container.querySelectorAll('input[type="range"]').length).toBe(0);
  });

  it("steps a waypoint with the ∓/± buttons and accepts typed values", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "D+30 변동폭 5bp 증가" }));
    expect(
      useSimulationDataStore.getState().params.waypoints.find((w) => w.day === 30)?.bp,
    ).toBe(5);

    fireEvent.change(screen.getByLabelText("D+60 변동폭"), { target: { value: "-12" } });
    expect(
      useSimulationDataStore.getState().params.waypoints.find((w) => w.day === 60)?.bp,
    ).toBe(-12);
  });

  it("edits the fan σ with the stepper and clamps typed values to (0, 25] (s13)", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "분포 σ 0.5bp 증가" }));
    expect(useSimulationDataStore.getState().params.sigmaBp).toBe("2.5");

    fireEvent.change(screen.getByLabelText("분포 σ"), { target: { value: "4" } });
    expect(useSimulationDataStore.getState().params.sigmaBp).toBe("4");

    fireEvent.change(screen.getByLabelText("분포 σ"), { target: { value: "99" } });
    expect(useSimulationDataStore.getState().params.sigmaBp).toBe("25");
  });

  it("keeps waypoint state semantics identical for equivalent selections (payload parity)", () => {
    // The same {simDays, waypoints} the sliders would have produced: the store
    // shape is unchanged, so buildSimulateRequest sees identical params.
    renderPanel();
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
