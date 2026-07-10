"use client";

import { memo, useCallback, useEffect, useRef } from "react";
import {
  DockviewReact,
  type DockviewReadyEvent,
  type DockviewApi,
  type IDockviewPanelProps,
  type IDockviewPanelHeaderProps,
  type IDockviewHeaderActionsProps,
} from "dockview-react";
import { StatusView } from "./status-view";
import { RiskHeatmap } from "./risk-heatmap";
import { RateHistoryChart } from "./rate-history-chart";
import { PnlTracePanel } from "./pnl-trace-panel";
import { DockviewTab } from "@/components/layout/dockview-tab";
import { DockviewActions } from "@/components/layout/dockview-actions";
import { useWorkspacePanelsStore } from "@/stores/workspace-panels-store";
import type { ManagedPanelDef } from "@/lib/workspace-panels";
import "dockview-react/dist/styles/dockview.css";

const StatusPanel = memo(function StatusPanel() {
  return <StatusView />;
});

const RiskHeatmapPanel = memo(function RiskHeatmapPanel() {
  return <RiskHeatmap />;
});

// Not memoized (unlike the other two): needs the live dockview api to open
// the PnL Trace panel on date-click, which changes identity per DockviewReady.
function RateHistoryPanel(props: IDockviewPanelProps) {
  return <RateHistoryChart api={props.containerApi} />;
}

const components = {
  status: (props: IDockviewPanelProps) => <StatusPanel {...props} />,
  heatmap: (props: IDockviewPanelProps) => <RiskHeatmapPanel {...props} />,
  rates: (props: IDockviewPanelProps) => <RateHistoryPanel {...props} />,
  pnltrace: (props: IDockviewPanelProps) => <PnlTracePanel {...props} />,
};

const defaultTabComponent = (props: IDockviewPanelHeaderProps) => <DockviewTab {...props} />;
const rightHeaderActionsComponent = (props: IDockviewHeaderActionsProps) => <DockviewActions {...props} />;

// v3 -> v4: added the rate-history chart panel -- a new key avoids restoring
// a v3 layout that doesn't know about the new panel id.
const STORAGE_KEY = "dockview-layout:home-v4";
const WORKSPACE_ID = "home";

const MANAGED_PANELS: ManagedPanelDef[] = [
  { id: "home-status-panel", title: "Status", component: "status" },
  { id: "home-heatmap-panel", title: "Risk Heatmap", component: "heatmap", referencePanelId: "home-status-panel", direction: "below" },
  { id: "home-rates-panel", title: "Rate History", component: "rates", referencePanelId: "home-heatmap-panel", direction: "right" },
];

function addDefaultPanels(api: DockviewApi) {
  api.clear();
  const statusPanel = api.addPanel({
    id: "home-status-panel",
    component: "status",
    title: "Status",
    initialHeight: 180,
  });
  const heatmapPanel = api.addPanel({
    id: "home-heatmap-panel",
    component: "heatmap",
    title: "Risk Heatmap",
    position: { referencePanel: statusPanel, direction: "below" },
  });
  api.addPanel({
    id: "home-rates-panel",
    component: "rates",
    title: "Rate History",
    position: { referencePanel: heatmapPanel, direction: "right" },
  });
}

export function HomeWorkspace() {
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
    <div className="h-full w-full">
      <DockviewReact
        className="dockview-theme-dark"
        components={components}
        defaultTabComponent={defaultTabComponent}
        rightHeaderActionsComponent={rightHeaderActionsComponent}
        onReady={onReady}
      />
    </div>
  );
}
