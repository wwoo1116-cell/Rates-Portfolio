"use client";

/**
 * Simulation tab mount host (app-layer integration glue).
 *
 * s15 T3: the four-panel dockview layout (Scenario Config | Curve View |
 * Distribution | Results) is replaced by the slice's staged single flow —
 * Configure → Running → Results (see features/simulation/components/
 * simulation-flow.tsx). With no dockview in the tab there is no layout
 * persistence and no workspace-panels registration here anymore; the old
 * `dockview-layout:simulation.layout.v1` localStorage key is simply ignored.
 *
 * This file remains the sanctioned slice <-> app-shell seam: it reads the app
 * ledgers (bond + manual IRS stores) and pushes them into the slice via
 * buildSimulationInputs (S6 bridge, position-bridge.ts). The slice's
 * components stay pure (port-only).
 *
 * SSR boundary: the flow's stages render lightweight-charts (canvas), so the
 * whole flow loads via next/dynamic({ ssr:false }) — same rationale as the
 * per-panel dynamic imports it replaces (§3.2).
 *
 * Two-backend origin: /api/simulate resolves via
 * NEXT_PUBLIC_SIMULATION_API_BASE_URL (falls back to the shared API_BASE).
 */
import { useEffect } from "react";
import dynamic from "next/dynamic";

import { useBondPositionsStore } from "@/stores/bond-positions-store";
import { useManualPositionsStore } from "@/stores/manual-positions-store";
import { useSimulationDataStore } from "@/features/simulation";
import { buildSimulationInputs } from "./position-bridge";

const SimulationFlow = dynamic(
  () => import("@/features/simulation").then((m) => m.SimulationFlow),
  { ssr: false },
);

/** S6 — feeds the port's ambient inputs from the target's real ledgers: bonds
 * (useBondPositionsStore) AND swaps (useManualPositionsStore, s15 T2) via
 * buildSimulationInputs. Bond rows carry real pvbp/duration/entryYield; swap
 * rows carry contract terms with market fields resolved backend-side. */
function useSimulationInputsBridge() {
  const bonds = useBondPositionsStore((s) => s.positions);
  const swaps = useManualPositionsStore((s) => s.positions);
  const setInputs = useSimulationDataStore((s) => s.setInputs);
  // Demo sprint (two-pane): the analyst's explicit valuation-date override
  // participates in input assembly, so a ledger refresh keeps the chosen date.
  const userBaseDate = useSimulationDataStore((s) => s.userBaseDate);
  useEffect(() => {
    setInputs(buildSimulationInputs(bonds, swaps, userBaseDate));
  }, [bonds, swaps, userBaseDate, setInputs]);
}

export function SimulationTab() {
  useSimulationInputsBridge();

  return (
    <div className="h-full w-full">
      <SimulationFlow />
    </div>
  );
}
