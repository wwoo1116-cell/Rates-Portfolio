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

import { useCallback, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { simulationApi } from "../api/simulation-api";
import type { SimulateRequest, SimulateResponse } from "../api/simulate-dto";
import { buildSimulateRequest } from "../lib/scenario-curves";
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
export function useSimulationPort(): SimulationDataPort {
  const store = useSimulationDataStore();
  const runMutation = useRunSimulation();
  // s15 — controller for the in-flight request so the Running interstitial's
  // cancel button can abort it. One run at a time (the UI gates on status).
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(
    async (request: SimulateRequest): Promise<SimulateResponse | null> => {
      const { markRunning, ingestResult, markError } = useSimulationDataStore.getState();
      const controller = new AbortController();
      abortRef.current = controller;
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
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [runMutation],
  );

  const runCurrent = useCallback((): Promise<SimulateResponse | null> => {
    // Read fresh from the store (not the closed-over render snapshot) so a run
    // triggered right after a patchParams uses the latest params/inputs.
    const { inputs, params } = useSimulationDataStore.getState();
    return run(buildSimulateRequest(inputs, params));
  }, [run]);

  const cancelRun = useCallback((): void => {
    // Flip the store first so the abort's rejection sees status already idle;
    // previous result stays untouched (replace-on-arrival semantics).
    useSimulationDataStore.getState().markCancelled();
    abortRef.current?.abort();
    abortRef.current = null;
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
