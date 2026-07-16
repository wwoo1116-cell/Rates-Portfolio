import type { ReactNode } from "react";
import { PNL_COLORS, withAlpha } from "@/lib/chart-colors";

// Badge tone: accent covers "info" and "risk" (non-directional); danger is
// the error/destructive semantic (S12 — NOT directional); the pnl-* pair is
// the universal Jade/Berry signed/directional convention (S12 owner
// lockdown — the old green/red "positive"/"negative" tones are RETIRED, all
// consumers migrated to pnl-* or danger).
export type BadgeTone =
  | "accent"
  | "info"
  | "risk"
  | "danger"
  | "pnl-positive"
  | "pnl-negative";

const TONE_STYLES: Record<BadgeTone, { bg: string; color: string }> = {
  accent:   { bg: "var(--accent-soft)",     color: "var(--accent)"     },
  info:     { bg: "var(--accent-soft)",     color: "var(--accent)"     },
  risk:     { bg: "var(--accent-soft)",     color: "var(--accent)"     },
  danger:   { bg: "var(--sem-danger-soft)", color: "var(--sem-danger)" },
  // Soft fills derive from the same chart-colors constants the canvases use
  // (0.15 alpha) — no new raw hex, no new tokens.
  "pnl-positive": { bg: withAlpha(PNL_COLORS.pos, 0.15), color: "var(--chart-pnl-pos)" },
  "pnl-negative": { bg: withAlpha(PNL_COLORS.neg, 0.15), color: "var(--chart-pnl-neg)" },
};

export interface BadgeProps {
  tone?: BadgeTone;
  variant?: "soft" | "solid";
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function Badge({
  tone = "accent",
  variant = "soft",
  children,
  className,
  style,
}: BadgeProps) {
  const { bg, color } = TONE_STYLES[tone];
  const isSolid = variant === "solid";
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "1px 6px",
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        fontFamily: "var(--font-ui)",
        backgroundColor: isSolid ? color : bg,
        color: isSolid ? "#fff" : color,
        lineHeight: 1.5,
        ...style,
      }}
    >
      {children}
    </span>
  );
}
