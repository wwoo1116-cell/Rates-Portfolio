import type { ReactNode } from "react";

// Badge tone: accent covers "info" and "risk" (non-directional);
// positive/negative for directional only.
export type BadgeTone = "positive" | "negative" | "accent" | "info" | "risk";

const TONE_STYLES: Record<BadgeTone, { bg: string; color: string }> = {
  positive: { bg: "var(--sem-positive-soft)", color: "var(--sem-positive)" },
  negative: { bg: "var(--sem-negative-soft)", color: "var(--sem-negative)" },
  accent:   { bg: "var(--accent-soft)",       color: "var(--accent)"        },
  info:     { bg: "var(--accent-soft)",        color: "var(--accent)"        },
  risk:     { bg: "var(--accent-soft)",        color: "var(--accent)"        },
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
