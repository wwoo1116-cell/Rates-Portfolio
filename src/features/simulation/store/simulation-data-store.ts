/**
 * Scoped Zustand slice backing the SimulationDataPort (protocol §1.3). Holds the
 * screen's client state: ambient inputs, user scenario params, and the last run's
 * result. Authored in the target's store idiom (plain `create<State>((set) => …)`,
 * cf. src/stores/*-store.ts) but lives INSIDE the slice — it is not registered in
 * the app-wide src/stores/ dir, keeping the vertical slice self-contained.
 *
 * (The old placeholder's `src/stores/simulation-store.ts` trade-sandbox store this
 * slice was once distinguished from was removed in R3B-PLUS A1 — see git history.)
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
  type AnchorTenor,
  type RunStatus,
  type ScenarioParams,
  type SimulationInputs,
} from "../types/simulation-port";

interface SimulationDataState {
  inputs: SimulationInputs;
  params: ScenarioParams;
  lastRun: SimulateResponse | null;
  lastRunRequest: SimulateRequest | null;
  /** N1 — the anchor pillar `lastRunRequest` was DESIGNED on (the wire itself
   * stays 3Y-normalized). Set by runCurrent on arrival; null before any run.
   * Results reconstructs the anchor-native target X from the wire's 국채
   * curve at this pillar. */
  lastRunAnchorTenor: AnchorTenor | null;
  setLastRunAnchorTenor: (anchor: AnchorTenor) => void;
  status: RunStatus;
  error: string | null;

  /** Demo sprint (two-pane) — the analyst's explicit valuation-date override.
   * null = automatic (today in Seoul). The app-layer bridge reads this when it
   * assembles inputs, so a ledger refresh never clobbers a user-chosen date. */
  userBaseDate: string | null;
  setUserBaseDate: (date: string | null) => void;

  /** SIM2-1 — which preview the Curve View panel shows. UI-only: survives
   * stage navigation (module-level store) and NEVER enters the payload. */
  previewMode: "curve" | "path";
  setPreviewMode: (mode: "curve" | "path") => void;

  /** SIM2-6 — the staged flow's screen, MOVED here from SimulationFlow's
   * component state so leaving the tab and returning restores EXACTLY what
   * was on screen (the s17 ES precedent). ingestResult lands on "results"
   * (a run finishing while the user sits elsewhere still lands Results);
   * markCancelled returns to "configure"; 조건 수정 sets it explicitly. */
  stage: "configure" | "results";
  setStage: (stage: "configure" | "results") => void;

  setInputs: (inputs: Partial<SimulationInputs>) => void;
  patchParams: (patch: Partial<ScenarioParams>) => void;
  resetParams: () => void;

  // Called by the transport layer (use-simulation.ts) — not by UI directly.
  markRunning: () => void;
  ingestResult: (request: SimulateRequest, result: SimulateResponse) => void;
  markError: (message: string) => void;
  /** s15 — user-cancelled run: back to idle, previous result untouched
   * (re-run REPLACES outright only when a new result actually arrives). */
  markCancelled: () => void;
}

export const useSimulationDataStore = create<SimulationDataState>((set) => ({
  inputs: EMPTY_SIMULATION_INPUTS,
  params: DEFAULT_SCENARIO_PARAMS,
  lastRun: null,
  lastRunRequest: null,
  lastRunAnchorTenor: null,
  setLastRunAnchorTenor: (anchor) => set({ lastRunAnchorTenor: anchor }),
  status: "idle",
  error: null,

  userBaseDate: null,
  setUserBaseDate: (date) => set({ userBaseDate: date }),

  previewMode: "curve",
  setPreviewMode: (mode) => set({ previewMode: mode }),

  stage: "configure",
  setStage: (stage) => set({ stage }),

  setInputs: (inputs) => set((state) => ({ inputs: { ...state.inputs, ...inputs } })),
  patchParams: (patch) => set((state) => ({ params: { ...state.params, ...patch } })),
  resetParams: () => set({ params: DEFAULT_SCENARIO_PARAMS }),

  markRunning: () => set({ status: "running", error: null }),
  // SIM2-6: arrival LANDS the flow on Results (even if the tab was left and
  // remounted mid-flight — the request outlives the component).
  ingestResult: (request, result) =>
    set({ status: "success", error: null, lastRun: result, lastRunRequest: request, stage: "results" }),
  markError: (message) => set({ status: "error", error: message }),
  // SIM2-6: a user cancel returns to Configure with inputs intact (s15 rule).
  markCancelled: () => set({ status: "idle", error: null, stage: "configure" }),
}));

// ---------------------------------------------------------------------------
// Selectors — the sanctioned cross-screen read path (protocol §1.3). If the
// Portfolio or Backtest tabs later need simulation output, they select it here;
// they never import the simulation components.
// ---------------------------------------------------------------------------

export const selectSimulationResults = (s: SimulationDataState): SimulateResponse | null => s.lastRun;
export const selectSimulationStatus = (s: SimulationDataState): RunStatus => s.status;
export const selectScenarioParams = (s: SimulationDataState): ScenarioParams => s.params;
