/**
 * Scoped Zustand slice backing the SimulationDataPort (protocol §1.3). Holds the
 * screen's client state: ambient inputs, user scenario params, and the last run's
 * result. Authored in the target's store idiom (plain `create<State>((set) => …)`,
 * cf. src/stores/*-store.ts) but lives INSIDE the slice — it is not registered in
 * the app-wide src/stores/ dir, keeping the vertical slice self-contained.
 *
 * NOTE the pre-existing app store src/stores/simulation-store.ts (`useSimulationStore`,
 * a trade sandbox) is the PLACEHOLDER's state and is unrelated — this is a new,
 * separately-named slice (`useSimulationDataStore`) and does not touch it.
 *
 * Server transport (POST /api/simulate) is NOT here — it goes through the TanStack
 * Query mutation in ../hooks/use-simulation.ts, which writes the result back via
 * ingestResult(). Cross-screen consumers read results through selectSimulationResults.
 */
import { create } from "zustand";

import type { SimulateRequest, SimulateResponse } from "../api/simulate-dto";
import {
  DEFAULT_SCENARIO_PARAMS,
  EMPTY_SIMULATION_INPUTS,
  type RunStatus,
  type ScenarioParams,
  type SimulationInputs,
} from "../types/simulation-port";

interface SimulationDataState {
  inputs: SimulationInputs;
  params: ScenarioParams;
  lastRun: SimulateResponse | null;
  lastRunRequest: SimulateRequest | null;
  status: RunStatus;
  error: string | null;

  setInputs: (inputs: Partial<SimulationInputs>) => void;
  patchParams: (patch: Partial<ScenarioParams>) => void;
  resetParams: () => void;

  // Called by the transport layer (use-simulation.ts) — not by UI directly.
  markRunning: () => void;
  ingestResult: (request: SimulateRequest, result: SimulateResponse) => void;
  markError: (message: string) => void;
}

export const useSimulationDataStore = create<SimulationDataState>((set) => ({
  inputs: EMPTY_SIMULATION_INPUTS,
  params: DEFAULT_SCENARIO_PARAMS,
  lastRun: null,
  lastRunRequest: null,
  status: "idle",
  error: null,

  setInputs: (inputs) => set((state) => ({ inputs: { ...state.inputs, ...inputs } })),
  patchParams: (patch) => set((state) => ({ params: { ...state.params, ...patch } })),
  resetParams: () => set({ params: DEFAULT_SCENARIO_PARAMS }),

  markRunning: () => set({ status: "running", error: null }),
  ingestResult: (request, result) =>
    set({ status: "success", error: null, lastRun: result, lastRunRequest: request }),
  markError: (message) => set({ status: "error", error: message }),
}));

// ---------------------------------------------------------------------------
// Selectors — the sanctioned cross-screen read path (protocol §1.3). If the
// Portfolio or Backtest tabs later need simulation output, they select it here;
// they never import the simulation components.
// ---------------------------------------------------------------------------

export const selectSimulationResults = (s: SimulationDataState): SimulateResponse | null => s.lastRun;
export const selectSimulationStatus = (s: SimulationDataState): RunStatus => s.status;
export const selectScenarioParams = (s: SimulationDataState): ScenarioParams => s.params;
