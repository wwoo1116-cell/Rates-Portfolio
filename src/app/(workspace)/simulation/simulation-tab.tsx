"use client";

/**
 * Phase 3 — Simulation tab mount host (app-layer integration glue).
 *
 * This is the sanctioned slice <-> app-shell seam: it may import app internals
 * (dockview, workspace-panels-store, theme-store, layout tab/actions) AND the
 * simulation slice's public surface (@/features/simulation). The slice's panels
 * themselves stay pure (port-only) — the boundary rule keeps them from importing
 * these app internals; this file does the wiring.
 *
 * Mounts the screen as dockview panels (Scenario Config | Curve View | Distribution |
 * Results) matching Home/Portfolio conventions, with:
 *   - layout persistence keyed `dockview-layout:simulation.layout.v1` (§3.1)
 *   - chart panels via next/dynamic({ ssr:false }) — SSR boundary for S5 canvas (§3.2)
 *   - minimum panel dimensions declared at registration (§3.3)
 *   - per-panel focus region + ResizeObserver-driven resize (dockview handles the latter)
 */
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import dynamic from "next/dynamic";
import {
  DockviewReact,
  type DockviewReadyEvent,
  type DockviewApi,
  type IDockviewPanelProps,
  type IDockviewPanelHeaderProps,
  type IDockviewHeaderActionsProps,
} from "dockview-react";
import { useThemeStore } from "@/stores/theme-store";
import { useWorkspacePanelsStore } from "@/stores/workspace-panels-store";
import { useBondPositionsStore } from "@/stores/bond-positions-store";
import type { ManagedPanelDef } from "@/lib/workspace-panels";
import { DockviewTab } from "@/components/layout/dockview-tab";
import { DockviewActions } from "@/components/layout/dockview-actions";
import {
  ScenarioConfigPanel,
  ResultsGridPanel,
  useSimulationDataStore,
} from "@/features/simulation";
import { buildSimulationInputs } from "./position-bridge";
import "dockview-react/dist/styles/dockview.css";

// Chart panels: SSR-disabled dynamic imports. Today they render staged placeholders;
// in S5 they become lightweight-charts/d3 components that touch canvas/window, and
// this ssr:false boundary is what keeps `next build` free of hydration/SSR errors.
const CurveViewPanel = dynamic(
  () => import("@/features/simulation/components/panels/curve-view-panel").then((m) => m.CurveViewPanel),
  { ssr: false },
);
const DistributionChartPanel = dynamic(
  () =>
    import("@/features/simulation/components/panels/distribution-chart-panel").then(
      (m) => m.DistributionChartPanel,
    ),
  { ssr: false },
);

type PanelApi = IDockviewPanelProps["api"];

/** Wraps a panel body with its dockview minimum-size constraints (§3.3) and a
 * focus region (aria-labelled group), consistent with the other workspace tabs. */
function PanelHost({
  api,
  title,
  minWidth,
  minHeight,
  children,
}: {
  api: PanelApi;
  title: string;
  minWidth: number;
  minHeight: number;
  children: ReactNode;
}) {
  useEffect(() => {
    api.setConstraints({ minimumWidth: minWidth, minimumHeight: minHeight });
  }, [api, minWidth, minHeight]);
  return (
    <div role="group" aria-label={title} tabIndex={-1} className="h-full w-full outline-none">
      {children}
    </div>
  );
}

const components = {
  "scenario-config": (p: IDockviewPanelProps) => (
    <PanelHost api={p.api} title="Scenario Config" minWidth={320} minHeight={200}>
      <ScenarioConfigPanel />
    </PanelHost>
  ),
  "curve-view": (p: IDockviewPanelProps) => (
    <PanelHost api={p.api} title="Curve View" minWidth={280} minHeight={200}>
      <CurveViewPanel />
    </PanelHost>
  ),
  "distribution-chart": (p: IDockviewPanelProps) => (
    <PanelHost api={p.api} title="Distribution" minWidth={280} minHeight={200}>
      <DistributionChartPanel />
    </PanelHost>
  ),
  "results-grid": (p: IDockviewPanelProps) => (
    <PanelHost api={p.api} title="Results" minWidth={280} minHeight={160}>
      <ResultsGridPanel />
    </PanelHost>
  ),
};

const defaultTabComponent = (props: IDockviewPanelHeaderProps) => <DockviewTab {...props} />;
const rightHeaderActionsComponent = (props: IDockviewHeaderActionsProps) => <DockviewActions {...props} />;

const STORAGE_KEY = "dockview-layout:simulation.layout.v1";
const WORKSPACE_ID = "simulation";

const MANAGED_PANELS: ManagedPanelDef[] = [
  { id: "sim-config-panel", title: "Scenario Config", component: "scenario-config" },
  { id: "sim-curve-panel", title: "Curve View", component: "curve-view", referencePanelId: "sim-config-panel", direction: "right" },
  { id: "sim-distribution-panel", title: "Distribution", component: "distribution-chart", referencePanelId: "sim-curve-panel", direction: "right" },
  { id: "sim-results-panel", title: "Results", component: "results-grid", referencePanelId: "sim-curve-panel", direction: "below" },
];

function addDefaultPanels(api: DockviewApi) {
  api.clear();
  const config = api.addPanel({
    id: "sim-config-panel",
    component: "scenario-config",
    title: "Scenario Config",
    initialWidth: 360,
  });
  const curve = api.addPanel({
    id: "sim-curve-panel",
    component: "curve-view",
    title: "Curve View",
    position: { referencePanel: config, direction: "right" },
  });
  api.addPanel({
    id: "sim-distribution-panel",
    component: "distribution-chart",
    title: "Distribution",
    position: { referencePanel: curve, direction: "right" },
  });
  api.addPanel({
    id: "sim-results-panel",
    component: "results-grid",
    title: "Results",
    position: { referencePanel: curve, direction: "below" },
  });
}

/** S6 — feeds the port's ambient inputs from the target's real bond ledger
 * (useBondPositionsStore) via buildSimulationInputs. Positions carry real pvbp/
 * duration/entryYield, so the run is enabled whenever the bond ledger is non-empty.
 * Swaps + daily shock matrix + IRS par curve are documented gaps (see position-bridge.ts).
 * Two-backend origin: /api/simulate resolves via NEXT_PUBLIC_SIMULATION_API_BASE_URL
 * (falls back to the shared API_BASE) — set it if the sim backend is a different origin. */
function useSimulationInputsBridge() {
  const bonds = useBondPositionsStore((s) => s.positions);
  const setInputs = useSimulationDataStore((s) => s.setInputs);
  useEffect(() => {
    setInputs(buildSimulationInputs(bonds));
  }, [bonds, setInputs]);
}

export function SimulationTab() {
  const theme = useThemeStore((s) => s.theme);
  const apiRef = useRef<DockviewApi | null>(null);
  const register = useWorkspacePanelsStore((s) => s.register);
  const unregister = useWorkspacePanelsStore((s) => s.unregister);
  const bumpTick = useWorkspacePanelsStore((s) => s.bumpTick);

  useSimulationInputsBridge();

  const handleReset = useCallback(() => {
    if (!apiRef.current) return;
    localStorage.removeItem(STORAGE_KEY);
    addDefaultPanels(apiRef.current);
  }, []);

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      apiRef.current = event.api;

      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          event.api.fromJSON(JSON.parse(saved));
        } else {
          throw new Error("No layout");
        }
      } catch {
        addDefaultPanels(event.api);
      }

      register(WORKSPACE_ID, event.api, MANAGED_PANELS, handleReset);

      event.api.onDidLayoutChange(() => {
        if (!apiRef.current) return;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(apiRef.current.toJSON()));
        bumpTick();
      });
    },
    [register, bumpTick, handleReset],
  );

  useEffect(() => () => unregister(WORKSPACE_ID), [unregister]);

  return (
    <div className="h-full w-full">
      <DockviewReact
        className={theme === "dark" ? "dockview-theme-dark" : "dockview-theme-light"}
        components={components}
        defaultTabComponent={defaultTabComponent}
        rightHeaderActionsComponent={rightHeaderActionsComponent}
        onReady={onReady}
      />
    </div>
  );
}
