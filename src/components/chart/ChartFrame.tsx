"use client";

/**
 * ChartFrame (S10): shared wrapper giving every chart two hover controls,
 * top-right —
 *   1. Maximize: re-parents the wrapped chart into a full-viewport portal
 *      overlay (ESC or the close button exits). Re-parenting REMOUNTS the
 *      child subtree, so lightweight-charts hosts re-create their canvas at
 *      the overlay size — a true re-render, never a scaled bitmap. Hosts must
 *      therefore rebuild their series when their LwChartBase remounts (the
 *      established onChartReady ref-reset pattern; hosts whose data effect
 *      keys off a `chart` state var get this for free).
 *   2. Detach: opens /chart/[chartId] in a separate browser window (same
 *      dark-token theme). Self-fetching charts need no state; others pass
 *      `detachState` (see detach.ts + chart-registry.tsx).
 *
 * Adoption is one line: replace the chart's `position: relative` container
 * with <ChartFrame chartId title className>. The frame div IS the relative
 * container, so absolutely-positioned overlays (reticles, tooltips, loading
 * scrims) keep working unchanged, embedded rendering is identical, and the
 * controls simply float above (z-30, visible on hover/focus).
 *
 * Simulation-tab charts are deliberately NOT wrapped in this session —
 * Session B adopts ChartFrame at integration.
 */

import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Maximize2, X } from "lucide-react";
import { openDetachedChart } from "./detach";

export interface ChartFrameProps {
  /** Stable id — also the /chart/[chartId] detach route key (chart-registry). */
  chartId: string;
  /** Shown in the maximize overlay header and the detached window. */
  title: string;
  /** JSON-serializable props snapshot for the detached window's renderer.
   * Pass a function to snapshot lazily at click time. Omit for charts whose
   * registry entry self-fetches. */
  detachState?: unknown | (() => unknown);
  /** Layout classes for the frame container (it is always position:relative). */
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

function ControlButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-[22px] w-[22px] items-center justify-center border border-border-subtle bg-bg-overlay text-fg-muted transition-colors hover:text-fg-primary"
    >
      {children}
    </button>
  );
}

export function ChartFrame({
  chartId,
  title,
  detachState,
  className,
  style,
  children,
}: ChartFrameProps) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!maximized) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMaximized(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [maximized]);

  const handleDetach = useCallback(() => {
    openDetachedChart(chartId, typeof detachState === "function" ? detachState() : detachState);
  }, [chartId, detachState]);

  const controls = (
    <div className="pointer-events-auto flex gap-1">
      {!maximized && (
        <ControlButton label={`Maximize ${title}`} onClick={() => setMaximized(true)}>
          <Maximize2 size={12} strokeWidth={1.5} />
        </ControlButton>
      )}
      <ControlButton label={`Open ${title} in new window`} onClick={handleDetach}>
        <ExternalLink size={12} strokeWidth={1.5} />
      </ControlButton>
      {maximized && (
        <ControlButton label="Close maximized view (ESC)" onClick={() => setMaximized(false)}>
          <X size={12} strokeWidth={1.5} />
        </ControlButton>
      )}
    </div>
  );

  return (
    <div className={`group/chartframe relative ${className ?? ""}`} style={style}>
      {maximized ? (
        <>
          {/* Placeholder keeps the embedded slot's layout while the chart
              lives in the overlay (the container's size comes from its
              parent, so nothing shifts). */}
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-micro text-fg-dim" style={{ letterSpacing: "0.04em" }}>
              Maximized — ESC to return
            </span>
          </div>
          {createPortal(
            <div
              role="dialog"
              aria-label={`${title} — maximized`}
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 1000,
                display: "flex",
                flexDirection: "column",
                background: "var(--bg-base)",
              }}
            >
              <header
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  height: 36,
                  padding: "0 12px",
                  flexShrink: 0,
                  borderBottom: "1px solid var(--border-dim)",
                }}
              >
                <span className="text-body-strong text-fg-primary">{title}</span>
                <span className="text-micro text-fg-dim" style={{ letterSpacing: "0.04em" }}>
                  ESC to close
                </span>
                <div style={{ flex: 1 }} />
                {controls}
              </header>
              <div style={{ flex: 1, minHeight: 0, position: "relative", margin: 12 }}>
                {children}
              </div>
            </div>,
            document.body,
          )}
        </>
      ) : (
        <>
          {children}
          <div className="absolute right-1.5 top-1.5 z-30 opacity-0 transition-opacity focus-within:opacity-100 group-hover/chartframe:opacity-100">
            {controls}
          </div>
        </>
      )}
    </div>
  );
}
