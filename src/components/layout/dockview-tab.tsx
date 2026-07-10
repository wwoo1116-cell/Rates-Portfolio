"use client";

import { memo, useEffect, useState } from "react";
import { type IDockviewPanelHeaderProps } from "dockview-react";
import { cn } from "@/lib/utils";

export const DockviewTab = memo(function DockviewTab(props: IDockviewPanelHeaderProps) {
  const [active, setActive] = useState(props.api.isActive);

  useEffect(() => {
    const disposable = props.api.onDidActiveChange(() => {
      setActive(props.api.isActive);
    });
    return () => disposable.dispose();
  }, [props.api]);

  return (
    <div
      className={cn(
        "flex h-full items-center gap-2 px-2 text-body-strong transition-colors",
        active ? "text-fg-primary" : "text-fg-secondary"
      )}
    >
      <span className="truncate">{props.api.title}</span>
    </div>
  );
});
