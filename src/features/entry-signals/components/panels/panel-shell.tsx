"use client";

import { useState, type ReactNode } from "react";
import type { IChartApi } from "lightweight-charts";
import { Input } from "@/components/ui/input";
import { useSharedHoverTime, timeToX } from "../../hooks/use-synced-time-scales";

/**
 * Numeric field that keeps its own draft text (so the user can clear it while
 * typing) and only commits finite values upstream. Reverts to the last valid
 * value on blur if left empty/invalid.
 */
export function NumberField({
  label,
  value,
  step,
  min,
  suffix,
  onCommit,
  className,
}: {
  label: string;
  value: number;
  step?: string;
  min?: number;
  suffix?: string;
  onCommit: (n: number) => void;
  className?: string;
}) {
  const [text, setText] = useState(String(value));
  // Reset the draft when the committed value changes externally, using the
  // render-time "adjust state on prop change" pattern (no effect needed).
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setText(String(value));
  }
  return (
    <Input
      label={label}
      type="number"
      step={step}
      min={min}
      suffix={suffix}
      value={text}
      className={className}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value !== "" && Number.isFinite(n)) onCommit(n);
      }}
      onBlur={() => {
        const n = Number(text);
        if (text === "" || !Number.isFinite(n)) setText(String(value));
      }}
    />
  );
}

/** Centered muted message for empty / not-ready panels. */
export function PanelEmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full w-full items-center justify-center p-4 text-center">
      <span className="text-micro text-fg-muted" style={{ letterSpacing: "0.04em", maxWidth: 320 }}>
        {children}
      </span>
    </div>
  );
}

/** Header row for a panel body (title + optional right-side content). */
export function PanelHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-label font-bold uppercase text-fg-muted">{title}</span>
      {right}
    </div>
  );
}

/**
 * Thin vertical guide drawn at the shared hovered date, so hovering one synced
 * chart marks the same date on its siblings. Suppressed on the chart that is
 * itself being hovered (that one renders the full CrosshairReticle instead).
 */
export function SyncedTimeGuide({
  chart,
  suppressed,
}: {
  chart: IChartApi | null;
  suppressed: boolean;
}) {
  const hoverTime = useSharedHoverTime();
  if (suppressed || !hoverTime || !chart) return null;
  const x = timeToX(chart, hoverTime);
  if (x == null) return null;
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        left: x,
        top: 0,
        bottom: 0,
        width: 1,
        background: "var(--border-strong)",
        pointerEvents: "none",
        zIndex: 7,
      }}
    />
  );
}
