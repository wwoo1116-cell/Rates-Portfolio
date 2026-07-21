/**
 * TanStack Query layer for the Simulation Screen (protocol §1.3). Server state
 * lives in Query; client scenario state lives in the Zustand slice. Query keys are
 * namespaced ['simulation', …] per the protocol. Modeled on the target's src/hooks/use-api.ts.
 *
 * The run is a MUTATION (an explicit user action with a fresh body each time), and on
 * success it invalidates ['simulation'] and writes the result into the slice so
 * cross-screen selectors see it.
 */
"use client";

import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { simulationApi } from "../api/simulation-api";
import type { SimulateRequest, SimulateResponse } from "../api/simulate-dto";
import { anchorConversionError, buildSimulateRequest } from "../lib/scenario-curves";
import { useSimulationDataStore } from "../store/simulation-data-store";
import type { SimulationDataPort } from "../types/simulation-port";

export const SIMULATION_KEYS = {
  all: ["simulation"] as const,
  run: () => ["simulation", "run"] as const,
  lastResult: () => ["simulation", "last-result"] as const,
};

/** Low-level run-trigger mutation. Prefer useSimulationPort().run() from the screen. */
export function useRunSimulation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: SIMULATION_KEYS.run(),
    mutationFn: ({ req, signal }: { req: SimulateRequest; signal?: AbortSignal }) =>
      simulationApi.simulate(req, signal),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SIMULATION_KEYS.all }),
  });
}

/**
 * Assembles the full SimulationDataPort the screen consumes: Zustand-held inputs +
 * params + last result, with run() wired to the mutation and result ingestion.
 * This is the single object the ported <ScenarioSimulator> will bind to in Phase 4.
 */
// SIM2-6 — MODULE-level controller for the in-flight request: the request
// outlives the component (the mutation writes to the module-level store), so
// the cancel affordance must too. A hook-local ref meant a remount during
// flight rendered a Running screen whose cancel could no longer abort the
// live request. One run at a time (the UI gates on status).
let activeRunController: AbortController | null = null;

export function useSimulationPort(): SimulationDataPort {
  const store = useSimulationDataStore();
  const runMutation = useRunSimulation();

  const run = useCallback(
    async (request: SimulateRequest): Promise<SimulateResponse | null> => {
      const { markRunning, ingestResult, markError } = useSimulationDataStore.getState();
      const controller = new AbortController();
      activeRunController = controller;
      markRunning();
      try {
        const result = await runMutation.mutateAsync({ req: request, signal: controller.signal });
        ingestResult(request, result);
        return result;
      } catch (err) {
        // A user cancel is not an error state: markCancelled already ran.
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          markError(err instanceof Error ? err.message : "시뮬레이션 오류가 발생했습니다.");
        }
        return null;
      } finally {
        if (activeRunController === controller) activeRunController = null;
      }
    },
    [runMutation],
  );

  const runCurrent = useCallback(async (): Promise<SimulateResponse | null> => {
    // Read fresh from the store (not the closed-over render snapshot) so a run
    // triggered right after a patchParams uses the latest params/inputs.
    const { inputs, params, markError, setLastRunAnchorTenor } = useSimulationDataStore.getState();
    // N1 degeneracy guard — belt to Configure's braces: even a programmatic
    // caller cannot ship a degenerate anchor conversion (silent
    // customPath-disable / SIM2-4 triviality misclassification). No request
    // is issued; the honest cause lands on `error`.
    const anchorError = anchorConversionError(params);
    if (anchorError) {
      markError(anchorError);
      return null;
    }
    const anchor = params.anchorTenor ?? "3Y";
    const result = await run(buildSimulateRequest(inputs, params));
    // Remember which pillar the landed run was designed on (Results chip
    // labeling) — captured at build time, immune to mid-flight anchor edits.
    if (result) setLastRunAnchorTenor(anchor);
    return result;
  }, [run]);

  const cancelRun = useCallback((): void => {
    // Flip the store first so the abort's rejection sees status already idle;
    // previous result stays untouched (replace-on-arrival semantics). The
    // module-level controller means this also aborts a request started by a
    // PREVIOUS mount of the tab (SIM2-6).
    useSimulationDataStore.getState().markCancelled();
    activeRunController?.abort();
    activeRunController = null;
  }, []);

  return {
    inputs: store.inputs,
    params: store.params,
    lastRun: store.lastRun,
    lastRunRequest: store.lastRunRequest,
    status: store.status,
    error: store.error,
    setInputs: store.setInputs,
    patchParams: store.patchParams,
    resetParams: store.resetParams,
    run,
    runCurrent,
    cancelRun,
  };
}
