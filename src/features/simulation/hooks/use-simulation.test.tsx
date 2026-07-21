// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  DEFAULT_SCENARIO_PARAMS,
  EMPTY_SIMULATION_INPUTS,
} from "../types/simulation-port";
import { useSimulationDataStore } from "../store/simulation-data-store";
import type { SimulateResponse } from "../api/simulate-dto";

/**
 * N1 — runCurrent's degeneracy guard (belt to Configure's braces): a
 * degenerate anchor conversion must never reach the wire, from ANY caller.
 * The transport is mocked at the api module; the store is real.
 */

const mockSimulate = vi.fn();
vi.mock("../api/simulation-api", () => ({
  simulationApi: {
    simulate: (req: unknown, signal?: AbortSignal) => mockSimulate(req, signal),
  },
}));

const { useSimulationPort } = await import("./use-simulation");

const RESULT = { chartData: [], summary: {} } as unknown as SimulateResponse;

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  useSimulationDataStore.setState({
    inputs: { ...EMPTY_SIMULATION_INPUTS, baseDate: "2026-07-14" },
    params: { ...DEFAULT_SCENARIO_PARAMS, spread10y: "12" },
    lastRun: null,
    lastRunRequest: null,
    lastRunAnchorTenor: null,
    status: "idle",
    error: null,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useSimulationPort runCurrent — N1 guard", () => {
  it("blocks a degenerate anchor conversion: NO request, honest error on the store", async () => {
    // anchor 10Y with X == spread10y → base_wire 0 (the silent-disable shape).
    useSimulationDataStore.setState((s) => ({
      params: { ...s.params, anchorTenor: "10Y", baseShockBp: "12" },
    }));
    const { result } = renderHook(() => useSimulationPort(), { wrapper });

    const run = await result.current.runCurrent();
    expect(run).toBeNull();
    expect(mockSimulate).not.toHaveBeenCalled();
    expect(useSimulationDataStore.getState().error).toMatch(/상쇄/);
    expect(useSimulationDataStore.getState().status).toBe("error");
  });

  it("ships the CONVERTED wire request for a valid non-3Y anchor and records the anchor", async () => {
    mockSimulate.mockResolvedValue(RESULT);
    useSimulationDataStore.setState((s) => ({
      params: { ...s.params, anchorTenor: "10Y", baseShockBp: "30" },
    }));
    const { result } = renderHook(() => useSimulationPort(), { wrapper });

    const run = await result.current.runCurrent();
    expect(run).toBe(RESULT);
    expect(mockSimulate).toHaveBeenCalledTimes(1);
    const wire = mockSimulate.mock.calls[0][0];
    expect(wire.baseShockBp).toBeCloseTo(30 - 12, 10); // X − spread10y
    await waitFor(() =>
      expect(useSimulationDataStore.getState().lastRunAnchorTenor).toBe("10Y"),
    );
  });
});
