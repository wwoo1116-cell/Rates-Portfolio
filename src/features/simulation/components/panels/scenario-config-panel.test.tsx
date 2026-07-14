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

  it("edits the horizon through the port (slider → store → display)", () => {
    renderPanel();
    const horizon = screen.getAllByRole("slider")[0];
    fireEvent.change(horizon, { target: { value: "210" } });
    expect(useSimulationDataStore.getState().params.simDays).toBe(210);
    expect(screen.getByText("210 Days")).toBeTruthy();
  });

  it("edits the base shock through the port", () => {
    renderPanel();
    const input = screen.getByDisplayValue("30");
    fireEvent.change(input, { target: { value: "45" } });
    expect(useSimulationDataStore.getState().params.baseShockBp).toBe("45");
  });

  it("auto-regenerates the 30-day waypoint sliders for the horizon", () => {
    renderPanel();
    // 180d → intermediate waypoints at 30/60/90/120/150 (5) + the horizon slider = 6.
    expect(screen.getAllByRole("slider").length).toBe(6);
  });
});
