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
import { PortfolioOverview } from "./portfolio-overview";
import { PvbpSensitivityTable } from "./pvbp-sensitivity-table";
import { BookDailyPnlTable } from "./book-daily-pnl-table";
import { DockviewTab } from "@/components/layout/dockview-tab";
import { DockviewActions } from "@/components/layout/dockview-actions";
import { useWorkspacePanelsStore } from "@/stores/workspace-panels-store";
import type { ManagedPanelDef } from "@/lib/workspace-panels";
import "dockview-react/dist/styles/dockview.css";

const OverviewPanel = memo(function OverviewPanel() {
  return <PortfolioOverview />;
});

const PvbpSensitivityPanel = memo(function PvbpSensitivityPanel() {
  return <PvbpSensitivityTable />;
});

const BookDailyPnlPanel = memo(function BookDailyPnlPanel() {
  return <BookDailyPnlTable />;
});

const components = {
  overview: (props: IDockviewPanelProps) => <OverviewPanel {...props} />,
  pvbp: (props: IDockviewPanelProps) => <PvbpSensitivityPanel {...props} />,
  bookpnl: (props: IDockviewPanelProps) => <BookDailyPnlPanel {...props} />,
};

const defaultTabComponent = (props: IDockviewPanelHeaderProps) => <DockviewTab {...props} />;
const rightHeaderActionsComponent = (props: IDockviewHeaderActionsProps) => (
  <DockviewActions {...props} />
);

// v6: Removed redundant "Risk Heatmap" panel (which was client-side Tenor x DV01),
// as it is superseded by the new backend-computed "PVBP Sensitivity" panel.
// v7: Merged "Status" + "Book Summary" into one "Portfolio Overview" panel.
// The bump is mandatory, not cosmetic: a saved v6 layout names the `status` and
// `booksummary` components, which no longer exist, so fromJSON would restore
// panels that can never render. A new key means no saved layout, which falls
// through to addDefaultPanels below.
const STORAGE_KEY = "dockview-layout:home-v7";
const WORKSPACE_ID = "home";

const MANAGED_PANELS: ManagedPanelDef[] = [
  { id: "home-overview-panel", title: "Portfolio Overview", component: "overview" },
  {
    id: "home-pvbp-panel",
    title: "PVBP (DV01) Sensitivity",
    component: "pvbp",
    referencePanelId: "home-overview-panel",
    direction: "below",
  },
  {
    id: "home-bookpnl-panel",
    title: "Daily P&L by Book",
    component: "bookpnl",
    referencePanelId: "home-pvbp-panel",
    direction: "right",
  },
];

function addDefaultPanels(api: DockviewApi) {
  api.clear();
  const overviewPanel = api.addPanel({
    id: "home-overview-panel",
    component: "overview",
    title: "Portfolio Overview",
    // Taller than the old Status panel's 160: this one carries the KPI ribbon
    // AND two stacked-bar charts, which need vertical room to be readable.
    initialHeight: 360,
  });
  const pvbpPanel = api.addPanel({
    id: "home-pvbp-panel",
    component: "pvbp",
    title: "PVBP (DV01) Sensitivity",
    position: { referencePanel: overviewPanel, direction: "below" },
  });
  api.addPanel({
    id: "home-bookpnl-panel",
    component: "bookpnl",
    title: "Daily P&L by Book",
    position: { referencePanel: pvbpPanel, direction: "right" },
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
