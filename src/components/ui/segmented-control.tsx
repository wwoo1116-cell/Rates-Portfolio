// SegmentedControl shim — Radix ToggleGroup removed.
// New code should use Blueprint SegmentedControl from @blueprintjs/core.
import type { ReactNode } from "react";

interface SegmentedControlProps {
  value?: string;
  onValueChange?: (value: string) => void;
  children?: ReactNode;
  className?: string;
}
interface SegmentedControlItemProps {
  value: string;
  children?: ReactNode;
}

export function SegmentedControl({ children, value, onValueChange, className }: SegmentedControlProps) {
  return (
    <div style={{ display: "inline-flex", border: "1px solid var(--border-subtle)" }} className={className}>
      {children}
    </div>
  );
}

export function SegmentedControlItem({ value: itemValue, children }: SegmentedControlItemProps) {
  return (
    <button
      type="button"
      style={{
        background: "transparent",
        color: "var(--fg-secondary)",
        border: "none",
        padding: "3px 10px",
        fontSize: "var(--text-xs)",
        cursor: "pointer",
        fontFamily: "var(--font-ui)",
      }}
    >
      {children}
    </button>
  );
}
