"use client";

/**
 * Entry Signals tab workspace. Two columns:
 *  - left: Price/SMA -> Z-Score oscillator -> Backtest equity curve, three
 *    charts stacked and time-axis synced (use-synced-time-scales.ts).
 *  - right: Signal watchlist grid -> Backtest trades & summary.
 * Follows the same dockview conventions as the other workspaces (components
 * map, DockviewTab/DockviewActions, per-workspace localStorage layout, sidebar
 * panel-accordion registration).
 */

import { memo, useCallback, useEffect, useRef } from "react";
import {
  DockviewReact,
  type DockviewReadyEvent,
  type DockviewApi,
  type IDockviewPanelHeaderProps,
  type IDockviewHeaderActionsProps,
} from "dockview-react";
import { DockviewTab } from "@/components/layout/dockview-tab";
import { DockviewActions } from "@/components/layout/dockview-actions";
import { useWorkspacePanelsStore } from "@/stores/workspace-panels-store";
import type { ManagedPanelDef } from "@/lib/workspace-panels";
import { PricePanel } from "./price-panel";
import { ZScoreOscillatorPanel } from "./zscore-oscillator-panel";
import { EquityCurvePanel } from "./equity-curve-panel";
import { SignalGridPanel } from "./signal-grid-panel";
import { BacktestPanel } from "./backtest-panel";
import "dockview-react/dist/styles/dockview.css";

const PricePanelMemo = memo(function PricePanelMemo() {
  return <PricePanel />;
});
const ZScorePanelMemo = memo(function ZScorePanelMemo() {
  return <ZScoreOscillatorPanel />;
});
const EquityPanelMemo = memo(function EquityPanelMemo() {
  return <EquityCurvePanel />;
});
const SignalsPanelMemo = memo(function SignalsPanelMemo() {
  return <SignalGridPanel />;
});
const BacktestPanelMemo = memo(function BacktestPanelMemo() {
  return <BacktestPanel />;
});

const components = {
  price: () => <PricePanelMemo />,
  zscore: () => <ZScorePanelMemo />,
  equity: () => <EquityPanelMemo />,
  signals: () => <SignalsPanelMemo />,
  backtest: () => <BacktestPanelMemo />,
};

const defaultTabComponent = (props: IDockviewPanelHeaderProps) => <DockviewTab {...props} />;
const rightHeaderActionsComponent = (props: IDockviewHeaderActionsProps) => <DockviewActions {...props} />;

const STORAGE_KEY = "dockview-layout:entry-signals-v1";
const WORKSPACE_ID = "entry-signals";

const MANAGED_PANELS: ManagedPanelDef[] = [
  { id: "es-price", title: "Price / Spread", component: "price" },
  { id: "es-zscore", title: "Z-Score Oscillator", component: "zscore", referencePanelId: "es-price", direction: "below" },
  { id: "es-equity", title: "Backtest — Cumulative P&L", component: "equity", referencePanelId: "es-zscore", direction: "below" },
  { id: "es-signals", title: "Signals (Watchlist)", component: "signals", referencePanelId: "es-price", direction: "right" },
  { id: "es-backtest", title: "Backtest — Trades & Summary", component: "backtest", referencePanelId: "es-signals", direction: "below" },
];

function addDefaultPanels(api: DockviewApi) {
  api.clear();
  const price = api.addPanel({ id: "es-price", component: "price", title: "Price / Spread", initialHeight: 240 });
  const zscore = api.addPanel({
    id: "es-zscore",
    component: "zscore",
    title: "Z-Score Oscillator",
    position: { referencePanel: price, direction: "below" },
  });
  api.addPanel({
    id: "es-equity",
    component: "equity",
    title: "Backtest — Cumulative P&L",
    position: { referencePanel: zscore, direction: "below" },
  });
  const signals = api.addPanel({
    id: "es-signals",
    component: "signals",
    title: "Signals (Watchlist)",
    position: { referencePanel: price, direction: "right" },
  });
  api.addPanel({
    id: "es-backtest",
    component: "backtest",
    title: "Backtest — Trades & Summary",
    position: { referencePanel: signals, direction: "below" },
  });
}

export function EntrySignalsWorkspace() {
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
