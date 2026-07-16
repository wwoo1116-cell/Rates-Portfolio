"use client";

/**
 * SimulationFlow (s15 T3) — the staged single flow that replaced the crammed
 * four-panel dockview layout: Configure → Running → Results, inside the tab.
 *
 * Stage resolution:
 *  - status === "running"            → Running interstitial (elapsed + cancel)
 *  - view === "results" AND lastRun  → Results (chips + fan hero + TR card)
 *  - otherwise                       → Configure
 *
 * `view` is local UI state; the data lives in the port store untouched, so
 * 조건 수정 returns to Configure with every input preserved, and a re-run
 * REPLACES the previous result only when the new one arrives (owner decision:
 * no overlay comparison, no run history). A run finishing while the user sits
 * in Configure lands them on Results via the status effect below.
 */
import { useEffect, useRef, useState } from "react";

import { useSimulationPort } from "../hooks/use-simulation";
import { ConfigureStage } from "./stages/configure-stage";
import { RunningStage } from "./stages/running-stage";
import { ResultsStage } from "./stages/results-stage";

export function SimulationFlow() {
  const { status, lastRun, error } = useSimulationPort();
  const [view, setView] = useState<"configure" | "results">("configure");

  // Land on Results exactly when a run completes (running → success).
  const prevStatus = useRef(status);
  useEffect(() => {
    if (prevStatus.current === "running" && status === "success") setView("results");
    prevStatus.current = status;
  }, [status]);

  if (status === "running") return <RunningStage />;

  if (view === "results" && lastRun) return <ResultsStage onEdit={() => setView("configure")} />;

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
