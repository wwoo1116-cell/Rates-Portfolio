import type { ReactNode } from "react";
import { Maximize2, Settings, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface WorkspacePanelProps {
  title: string;
  onSettings?: () => void;
  onMaximize?: () => void;
  onClose?: () => void;
  children: ReactNode;
  className?: string;
}

export function WorkspacePanel({
  title,
  onSettings,
  onMaximize,
  onClose,
  children,
  className,
}: WorkspacePanelProps) {
  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex h-8 shrink-0 items-center gap-2 bg-bg-header-dark px-3">
        <span className="flex-1 truncate text-body-strong text-white">{title}</span>
        {onSettings && (
          <button
            type="button"
            onClick={onSettings}
            aria-label="Panel settings"
            className="text-fg-muted hover:text-fg-secondary"
          >
            <Settings size={14} strokeWidth={1.5} />
          </button>
        )}
        {onMaximize && (
          <button
            type="button"
            onClick={onMaximize}
            aria-label="Maximize panel"
            className="text-fg-muted hover:text-fg-secondary"
          >
            <Maximize2 size={14} strokeWidth={1.5} />
          </button>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="text-fg-muted hover:text-fg-secondary"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 bg-bg-secondary">{children}</div>
    </div>
  );
}
