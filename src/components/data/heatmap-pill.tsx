// HeatmapPill: renders a value as a colored bar fill.
// Uses --accent (#F58220) alpha scale for non-directional data.
// Directional (bidirectional): negative uses --sem-negative, positive --sem-positive.

interface HeatmapPillProps {
  value: number;
  min: number;
  max: number;
  /** bidirectional: green/red by sign. unidirectional: accent alpha scale. */
  direction?: "bidirectional" | "unidirectional";
}

export function HeatmapPill({
  value,
  min,
  max,
  direction = "bidirectional",
}: HeatmapPillProps) {
  const range = Math.max(Math.abs(min), Math.abs(max)) || 1;
  const t = Math.min(Math.abs(value) / range, 1);

  let bgColor: string;
  let textColor: string;

  if (direction === "bidirectional") {
    if (value > 0) {
      bgColor = `rgba(15, 153, 96,${(0.10 + t * 0.50).toFixed(2)})`;
      textColor = "var(--sem-positive)";
    } else if (value < 0) {
      bgColor = `rgba(219, 55, 55,${(0.10 + t * 0.50).toFixed(2)})`;
      textColor = "var(--sem-negative)";
    } else {
      bgColor = "transparent";
      textColor = "var(--fg-muted)";
    }
  } else {
    // Unidirectional: accent alpha only
    bgColor = `rgba(59, 130, 246,${(0.06 + t * 0.60).toFixed(2)})`;
    textColor = value !== 0 ? "var(--accent)" : "var(--fg-muted)";
  }

  const sign = value > 0 ? "+" : "";
  const display =
    Math.abs(value) >= 1000
      ? `${sign}${Math.round(value).toLocaleString()}`
      : `${sign}${value.toFixed(1)}`;

  return (
    <span
      data-num
      style={{
        display: "block",
        textAlign: "right",
        padding: "1px 6px",
        background: bgColor,
        color: textColor,
        fontFamily: "var(--font-mono)",
        fontVariantNumeric: "tabular-nums",
        fontSize: "var(--text-sm)",
        lineHeight: 1.6,
      }}
    >
      {display}
    </span>
  );
}
