"use client";

import { useCallback, useEffect, useRef } from "react";
import { DockviewReact, type DockviewApi, DockviewReadyEvent, IDockviewPanelProps } from "dockview-react";
import { PositionsGrid } from "./positions-grid";
import { DetailsPanel } from "./details-panel";
import { FilterBar } from "./filter-bar";
import { useWorkspacePanelsStore } from "@/stores/workspace-panels-store";
import type { ManagedPanelDef } from "@/lib/workspace-panels";

const components = {
  positions: (props: IDockviewPanelProps) => <PositionsGrid />,
  details: (props: IDockviewPanelProps) => <DetailsPanel />,
};

const STORAGE_KEY = "dockview-layout:portfolio-v1";
const WORKSPACE_ID = "portfolio";

const MANAGED_PANELS: ManagedPanelDef[] = [
  { id: "positions", title: "Positions", component: "positions" },
  { id: "details", title: "Position Details", component: "details", referencePanelId: "positions", direction: "right" },
];

function addDefaultPanels(api: DockviewApi) {
  api.clear();
  api.addPanel({ id: "positions", component: "positions", title: "Positions" });
  api.addPanel({
    id: "details",
    component: "details",
    title: "Position Details",
    position: { referencePanel: "positions", direction: "right" },
  });
}

export function PortfolioWorkspace() {
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
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", background: "var(--bg-base)" }}>
      <div style={{ flexShrink: 0 }}>
        <FilterBar />
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <DockviewReact className="dockview-theme-dark" components={components} onReady={onReady} />
      </div>
    </div>
  );
}
