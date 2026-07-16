"use client";

/**
 * Entry Signals tab — staged flow since s17 (owner directive: configure
 * first, honest loading, then results; same shape as the Simulation pass):
 *
 *   1. Configure — everything the user tunes (pair/watchlist, signal params,
 *      backtest params) + the live price/spread preview. configure-stage.tsx
 *   2. Running   — honest interstitial (elapsed + real phase + cancel; the
 *      backend has no progress stream and none is faked). running-stage.tsx
 *   3. Results   — live monitoring (z-score, signals grid) beside the PINNED
 *      backtest snapshot; 조건 수정 round-trips to Configure. results-stage.tsx
 *
 * The stage lives in entry-signals-store (not persisted — every session
 * starts at Configure). This replaced the five-panel dockview layout; the old
 * "dockview-layout:entry-signals-v1" localStorage key is simply orphaned, and
 * this workspace no longer registers with the sidebar panel accordion (there
 * are no re-arrangeable panels to list).
 */

import { useEntrySignalsStore } from "@/stores/entry-signals-store";
import { ConfigureStage } from "./configure-stage";
import { RunningStage } from "./running-stage";
import { ResultsStage } from "./results-stage";

export function EntrySignalsWorkspace() {
  const stage = useEntrySignalsStore((s) => s.stage);
  return (
    <div className="h-full w-full">
      {stage === "configure" ? <ConfigureStage /> : stage === "running" ? <RunningStage /> : <ResultsStage />}
    </div>
  );
}
