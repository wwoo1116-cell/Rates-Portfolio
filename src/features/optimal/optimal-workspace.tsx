"use client";

import { useCallback, useEffect, useRef } from "react";
import { DockviewReact, type DockviewApi, DockviewReadyEvent, IDockviewPanelProps } from "dockview-react";
import { ConstraintsForm } from "./constraints-form";
import { ResultsDashboard } from "./results-dashboard";
import { useWorkspacePanelsStore } from "@/stores/workspace-panels-store";
import type { ManagedPanelDef } from "@/lib/workspace-panels";

const components = {
  constraints: (props: IDockviewPanelProps) => <ConstraintsForm />,
  results: (props: IDockviewPanelProps) => <ResultsDashboard />,
};

const STORAGE_KEY = "dockview-layout:optimal-v1";
const WORKSPACE_ID = "optimal";

const MANAGED_PANELS: ManagedPanelDef[] = [
  { id: "constraints", title: "Constraints Formulation", component: "constraints" },
  { id: "results", title: "Optimization Results", component: "results", referencePanelId: "constraints", direction: "right" },
];

function addDefaultPanels(api: DockviewApi) {
  api.clear();
  api.addPanel({ id: "constraints", component: "constraints", title: "Constraints Formulation" });
  api.addPanel({
    id: "results",
    component: "results",
    title: "Optimization Results",
    position: { referencePanel: "constraints", direction: "right" },
  });
}

export function OptimalWorkspace() {
  const apiRef = useRef<DockviewApi | null>(null);
  const register = useWorkspacePanelsStore((s) => s.register);
  const unregister = useWorkspacePanelsStore((s) => s.unregister);
  const bumpTick = useWorkspacePanelsStore((s) => s.bumpTick);

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
    <div style={{ height: "100%", width: "100%", background: "var(--bg-base)" }}>
      <DockviewReact className="dockview-theme-dark" components={components} onReady={onReady} />
    </div>
  );
}
