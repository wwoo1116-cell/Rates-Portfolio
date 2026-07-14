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
import { PvbpSensitivityTable } from "./pvbp-sensitivity-table";
import { BookDailyPnlTable } from "./book-daily-pnl-table";
import { BookSummaryCard } from "./book-summary-card";
import { DockviewTab } from "@/components/layout/dockview-tab";
import { DockviewActions } from "@/components/layout/dockview-actions";
import { useWorkspacePanelsStore } from "@/stores/workspace-panels-store";
import type { ManagedPanelDef } from "@/lib/workspace-panels";
import "dockview-react/dist/styles/dockview.css";

const StatusPanel = memo(function StatusPanel() {
  return <StatusView />;
});

const PvbpSensitivityPanel = memo(function PvbpSensitivityPanel() {
  return <PvbpSensitivityTable />;
});

const BookDailyPnlPanel = memo(function BookDailyPnlPanel() {
  return <BookDailyPnlTable />;
});

const BookSummaryPanel = memo(function BookSummaryPanel() {
  return <BookSummaryCard />;
});

const components = {
  status: (props: IDockviewPanelProps) => <StatusPanel {...props} />,
  pvbp: (props: IDockviewPanelProps) => <PvbpSensitivityPanel {...props} />,
  bookpnl: (props: IDockviewPanelProps) => <BookDailyPnlPanel {...props} />,
  booksummary: (props: IDockviewPanelProps) => <BookSummaryPanel {...props} />,
};

const defaultTabComponent = (props: IDockviewPanelHeaderProps) => <DockviewTab {...props} />;
const rightHeaderActionsComponent = (props: IDockviewHeaderActionsProps) => (
  <DockviewActions {...props} />
);

// v6: Removed redundant "Risk Heatmap" panel (which was client-side Tenor x DV01), 
// as it is superseded by the new backend-computed "PVBP Sensitivity" panel.
const STORAGE_KEY = "dockview-layout:home-v6";
const WORKSPACE_ID = "home";

const MANAGED_PANELS: ManagedPanelDef[] = [
  { id: "home-status-panel", title: "Status", component: "status" },
  {
    id: "home-pvbp-panel",
    title: "PVBP (DV01) Sensitivity",
    component: "pvbp",
    referencePanelId: "home-status-panel",
    direction: "below",
  },
  {
    id: "home-bookpnl-panel",
    title: "Daily P&L by Book",
    component: "bookpnl",
    referencePanelId: "home-pvbp-panel",
    direction: "right",
  },
  {
    id: "home-booksummary-panel",
    title: "Book Summary",
    component: "booksummary",
    referencePanelId: "home-pvbp-panel",
    direction: "right",
  },
];

function addDefaultPanels(api: DockviewApi) {
  api.clear();
  const statusPanel = api.addPanel({
    id: "home-status-panel",
    component: "status",
    title: "Status",
    initialHeight: 160,
  });
  const pvbpPanel = api.addPanel({
    id: "home-pvbp-panel",
    component: "pvbp",
    title: "PVBP (DV01) Sensitivity",
    position: { referencePanel: statusPanel, direction: "below" },
  });
  const bookpnlPanel = api.addPanel({
    id: "home-bookpnl-panel",
    component: "bookpnl",
    title: "Daily P&L by Book",
    position: { referencePanel: pvbpPanel, direction: "right" },
  });
  api.addPanel({
    id: "home-booksummary-panel",
    component: "booksummary",
    title: "Book Summary",
    position: { referencePanel: bookpnlPanel, direction: "below" },
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
