"use client";

import { memo, useEffect, useState } from "react";
import { Maximize2, Minimize2, Settings, X } from "lucide-react";
import { type IDockviewHeaderActionsProps } from "dockview-react";

export const DockviewActions = memo(function DockviewActions(props: IDockviewHeaderActionsProps) {
  const [isMaximized, setIsMaximized] = useState(props.group.api.isMaximized());

  useEffect(() => {
    const disposable = props.containerApi.onDidMaximizedGroupChange((event) => {
      if (event.group === props.group) {
        setIsMaximized(event.isMaximized);
      }
    });
    return () => disposable.dispose();
  }, [props.containerApi, props.group]);

  return (
    <div className="flex h-full items-center gap-1 px-2 text-fg-muted">
      <button
        type="button"
        aria-label="Panel settings"
        className="flex h-6 w-6 items-center justify-center rounded hover:bg-bg-tertiary hover:text-fg-primary transition-colors"
      >
        <Settings size={14} strokeWidth={1.5} />
      </button>
      <button
        type="button"
        aria-label={isMaximized ? "Restore panel" : "Maximize panel"}
        className="flex h-6 w-6 items-center justify-center rounded hover:bg-bg-tertiary hover:text-fg-primary transition-colors"
        onClick={() => {
          if (props.group.api.isMaximized()) {
            props.group.api.exitMaximized();
            setIsMaximized(false);
          } else {
            props.group.api.maximize();
            setIsMaximized(true);
          }
        }}
      >
        {isMaximized ? (
          <Minimize2 size={14} strokeWidth={1.5} />
        ) : (
          <Maximize2 size={14} strokeWidth={1.5} />
        )}
      </button>
      <button
        type="button"
        aria-label="Close panel"
        className="flex h-6 w-6 items-center justify-center rounded hover:bg-sem-negative hover:text-fg-primary transition-colors"
        onClick={() => {
          if (props.group.activePanel) {
            props.group.activePanel.api.close();
          }
        }}
      >
        <X size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
});
