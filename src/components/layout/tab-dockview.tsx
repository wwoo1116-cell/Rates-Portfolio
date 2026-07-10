"use client";

import { useCallback, useRef } from "react";
import {
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type IDockviewPanelHeaderProps,
  type IDockviewHeaderActionsProps,
  type DockviewApi,
} from "dockview-react";
import { useThemeStore } from "@/stores/theme-store";
import { DockviewTab } from "@/components/layout/dockview-tab";
import { DockviewActions } from "@/components/layout/dockview-actions";
import "dockview-react/dist/styles/dockview.css";

interface TabDockviewProps {
  panelId: string;
  title: string;
}

import { memo } from "react";

const EmptyPanel = memo(function EmptyPanel(props: IDockviewPanelProps<{ title: string }>) {
  return (
    <div className="h-full w-full flex items-center justify-center bg-bg-secondary text-fg-muted text-body">
      {props.params.title} — panels wired in a later phase
    </div>
  );
});

const components = {
  empty: (props: IDockviewPanelProps) => <EmptyPanel {...props} />,
};
const defaultTabComponent = (props: IDockviewPanelHeaderProps) => <DockviewTab {...props} />;
const rightHeaderActionsComponent = (props: IDockviewHeaderActionsProps) => <DockviewActions {...props} />;

export function TabDockview({ panelId, title }: TabDockviewProps) {
  const theme = useThemeStore((state) => state.theme);
  const apiRef = useRef<DockviewApi | null>(null);

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      apiRef.current = event.api;
      const STORAGE_KEY = `dockview-layout:${panelId}`;

      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          event.api.fromJSON(JSON.parse(saved));
        } else {
          throw new Error("No layout");
        }
      } catch {
        event.api.clear();
        event.api.addPanel({
          id: panelId,
          component: "empty",
          title,
          params: { title },
        });
      }

      event.api.onDidLayoutChange(() => {
        if (!apiRef.current) return;
        const layout = apiRef.current.toJSON();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
      });
    },
    [panelId, title],
  );

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
