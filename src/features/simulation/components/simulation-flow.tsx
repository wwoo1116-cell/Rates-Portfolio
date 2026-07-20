"use client";

/**
 * SimulationFlow (s15 T3) — the staged single flow that replaced the crammed
 * four-panel dockview layout: Configure → Running → Results, inside the tab.
 *
 * Stage resolution:
 *  - status === "running"             → Running interstitial (elapsed + cancel)
 *  - stage === "results" AND lastRun  → Results (chips + curves hero + TR card)
 *  - otherwise                        → Configure
 *
 * SIM2-6 (owner feedback): `stage` lives in the PORT STORE, not component
 * state — leaving the Simulation tab and returning restores exactly what was
 * on screen (Results stays Results rendering the persisted run; Configure
 * keeps every edited input; previewMode persists by SIM2-1 spec). The
 * running→success landing moved into the store's ingestResult, so a run
 * finishing while the tab is unmounted still lands on Results — the request
 * outlives the component (mutation writes to the module-level store). A user
 * cancel returns to Configure (markCancelled). 재실행=대체 (s15) unchanged:
 * a re-run REPLACES the previous result only when the new one arrives.
 */
import { useSimulationPort } from "../hooks/use-simulation";
import { useSimulationDataStore } from "../store/simulation-data-store";
import { ConfigureStage } from "./stages/configure-stage";
import { RunningStage } from "./stages/running-stage";
import { ResultsStage } from "./stages/results-stage";

export function SimulationFlow() {
  const { status, lastRun, error } = useSimulationPort();
  const stage = useSimulationDataStore((s) => s.stage);
  const setStage = useSimulationDataStore((s) => s.setStage);

  if (status === "running") return <RunningStage />;

  if (stage === "results" && lastRun) return <ResultsStage onEdit={() => setStage("configure")} />;

  return (
    <div className="flex h-full w-full flex-col">
      {status === "error" && error && (
        <p className="mx-4 mt-3 bg-sem-danger-soft px-3 py-2 text-micro text-sem-danger">
          시뮬레이션 오류 — {error}
        </p>
      )}
      <div className="min-h-0 flex-1">
        <ConfigureStage />
      </div>
    </div>
  );
}
