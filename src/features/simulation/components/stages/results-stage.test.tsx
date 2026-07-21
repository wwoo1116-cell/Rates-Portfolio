// @vitest-environment jsdom
/**
 * N1/T2 — Results chip anchor-native labeling: the chip prints the DESIGNED
 * anchor verbatim ("국고 5Y 목표 +30bp"), reconstructing X from the wire's
 * 국채 curve at the anchor pillar (the wire itself stays 3Y-normalized);
 * pre-N1 results (no recorded anchor) label as 3Y with the wire figure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render as rtlRender, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { DEFAULT_SCENARIO_PARAMS, EMPTY_SIMULATION_INPUTS } from "../../types/simulation-port";
import { useSimulationDataStore } from "../../store/simulation-data-store";
import { buildSimulateRequest } from "../../lib/scenario-curves";
import { N1_GOLDEN_INPUTS, N1_GOLDEN_PARAMS } from "../../lib/n1-golden-config";
import type { SimulateResponse } from "../../api/simulate-dto";

vi.mock("../panels/component-curves-panel", () => ({
  ComponentCurvesPanel: () => <div data-testid="curves-hero" />,
}));
vi.mock("../panels/scenario-recon-panel", () => ({
  ScenarioReconPanel: () => null,
}));

const { ResultsStage } = await import("./results-stage");

const RESULT = {
  chartData: [],
  summary: { finalMTM: 0, finalCarry: 0, finalSwap: 0, finalTotal: 0, breakEvenDay: -1 },
  fundingCurve: [],
  distribution: null,
  exclusions: [],
} as unknown as SimulateResponse;

function render(ui: React.ReactElement) {
  const qc = new QueryClient();
  return rtlRender(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  useSimulationDataStore.setState({
    params: DEFAULT_SCENARIO_PARAMS,
    inputs: EMPTY_SIMULATION_INPUTS,
    lastRun: null,
    lastRunRequest: null,
    lastRunAnchorTenor: null,
    status: "idle",
    error: null,
  });
});
afterEach(cleanup);

describe("ResultsStage — N1 anchor-native target chip", () => {
  it("prints the designed anchor verbatim with X reconstructed from the wire curve", () => {
    // Designed on 5Y at +30bp (spread10y 12 → wire base ≈ 26.571…): the chip
    // must show the DESIGN (+30bp), not the wire figure.
    const wire = buildSimulateRequest(N1_GOLDEN_INPUTS, { ...N1_GOLDEN_PARAMS, anchorTenor: "5Y" });
    useSimulationDataStore.setState({
      lastRun: RESULT,
      lastRunRequest: wire,
      lastRunAnchorTenor: "5Y",
    });
    render(<ResultsStage onEdit={() => {}} />);

    expect(screen.getByText("국고 5Y 목표")).toBeTruthy();
    expect(screen.getByText("+30bp")).toBeTruthy();
    expect(screen.queryByText(/\+26\.5/)).toBeNull(); // wire figure never shown
  });

  it("pre-N1 result (no recorded anchor): labels 3Y and shows the wire target (same value)", () => {
    const wire = buildSimulateRequest(N1_GOLDEN_INPUTS, N1_GOLDEN_PARAMS); // legacy 3Y wire, X=30
    useSimulationDataStore.setState({
      lastRun: RESULT,
      lastRunRequest: wire,
      lastRunAnchorTenor: null,
    });
    render(<ResultsStage onEdit={() => {}} />);

    expect(screen.getByText("국고 3Y 목표")).toBeTruthy();
    expect(screen.getByText("+30bp")).toBeTruthy();
  });
});
