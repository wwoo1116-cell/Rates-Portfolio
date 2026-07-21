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
import { DailyReconPanel } from "@/features/home/daily-recon-panel";
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

// RECON-DAILY: the SAME shared component as Home's 일별 대사 tab (one
// component + one endpoint set + one shared date pick = no mount divergence),
// with the Rates-History-only range mode (per-day residual strip) enabled.
const DailyReconPanelMemo = memo(function DailyReconPanelMemo() {
  return <DailyReconPanel showRange />;
});

const components = {
  rates: (props: IDockviewPanelProps) => <RateHistoryPanel {...props} />,
  pnltrace: (props: IDockviewPanelProps) => <PnlTracePanelMemo {...props} />,
  spreadposition: (props: IDockviewPanelProps) => <SpreadPositionPanelMemo {...props} />,
  dailyrecon: () => <DailyReconPanelMemo />,
};

const defaultTabComponent = (props: IDockviewPanelHeaderProps) => <DockviewTab {...props} />;
const rightHeaderActionsComponent = (props: IDockviewHeaderActionsProps) => (
  <DockviewActions {...props} />
);

// v2 (RECON-DAILY): added the 일별 대사 하위탭 to the defaults — the bump
// makes it appear for users with a saved v1 layout (same rationale as the
// Home workspace's v8 bump).
const STORAGE_KEY = "dockview-layout:rates-history-v2";
const WORKSPACE_ID = "rates-history";

const MANAGED_PANELS: ManagedPanelDef[] = [
  { id: "rh-rates-panel", title: "Rate History", component: "rates" },
  {
    id: "rh-dailyrecon-panel",
    title: "일별 대사",
    component: "dailyrecon",
    referencePanelId: "rh-rates-panel",
    direction: "within",
  },
];

function addDefaultPanels(api: DockviewApi) {
  api.clear();
  const ratesPanel = api.addPanel({
    id: "rh-rates-panel",
    component: "rates",
    title: "Rate History",
  });
  api.addPanel({
    id: "rh-dailyrecon-panel",
    component: "dailyrecon",
    title: "일별 대사",
    position: { referencePanel: ratesPanel, direction: "within" },
    // Rate History stays the tab a user lands on; recon is the drill-in.
    inactive: true,
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
