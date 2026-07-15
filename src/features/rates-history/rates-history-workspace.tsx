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
import { RateHistoryChart } from "@/features/home/rate-history-chart";
import { PnlTracePanel } from "@/features/home/pnl-trace-panel";
import {
  SpreadPositionPanel,
  type SpreadPositionPanelParams,
} from "@/features/home/spread-position-panel";
import { DockviewTab } from "@/components/layout/dockview-tab";
import { DockviewActions } from "@/components/layout/dockview-actions";
import { useWorkspacePanelsStore } from "@/stores/workspace-panels-store";
import type { ManagedPanelDef } from "@/lib/workspace-panels";
import "dockview-react/dist/styles/dockview.css";

// Not memoized: needs the live dockview api to open the PnL Trace panel on date-click.
function RateHistoryPanel(props: IDockviewPanelProps) {
  return <RateHistoryChart api={props.containerApi} />;
}

const PnlTracePanelMemo = memo(function PnlTracePanelMemo(props: IDockviewPanelProps) {
  return <PnlTracePanel {...props} />;
});

const SpreadPositionPanelMemo = memo(function SpreadPositionPanelMemo(props: IDockviewPanelProps) {
  return <SpreadPositionPanel params={props.params as SpreadPositionPanelParams} />;
});

const components = {
  rates: (props: IDockviewPanelProps) => <RateHistoryPanel {...props} />,
  pnltrace: (props: IDockviewPanelProps) => <PnlTracePanelMemo {...props} />,
  spreadposition: (props: IDockviewPanelProps) => <SpreadPositionPanelMemo {...props} />,
};

const defaultTabComponent = (props: IDockviewPanelHeaderProps) => <DockviewTab {...props} />;
const rightHeaderActionsComponent = (props: IDockviewHeaderActionsProps) => (
  <DockviewActions {...props} />
);

const STORAGE_KEY = "dockview-layout:rates-history-v1";
const WORKSPACE_ID = "rates-history";

const MANAGED_PANELS: ManagedPanelDef[] = [
  { id: "rh-rates-panel", title: "Rate History", component: "rates" },
];

function addDefaultPanels(api: DockviewApi) {
  api.clear();
  api.addPanel({
    id: "rh-rates-panel",
    component: "rates",
    title: "Rate History",
  });
}

export function RatesHistoryWorkspace() {
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
