// Shared directional numeric cell renderer.
// S12: Positive → --chart-pnl-pos (Jade), Negative → --chart-pnl-neg (Berry),
// Zero → --fg-secondary. Jade/Berry is the universal signed pair (owner
// lockdown); the old green/red sem tokens are retired.
// All values rendered in Inter with tabular-nums.

interface NumericCellProps {
  value: number;
  precision?: number;
  prefix?: string;
  suffix?: string;
  /** Show +/- sign. Default true. */
  signed?: boolean;
  /** Text alignment. Default 'right'. */
  align?: "left" | "right" | "center";
  /** Suppress color coding and always use secondary foreground. */
  neutral?: boolean;
}

export function NumericCell({
  value,
  precision = 2,
  prefix = "",
  suffix = "",
  signed = true,
  align = "right",
  neutral = false,
}: NumericCellProps) {
  const sign = signed && value > 0 ? "+" : "";
  const color = neutral
    ? "var(--fg-secondary)"
    : value > 0
      ? "var(--chart-pnl-pos)"
      : value < 0
        ? "var(--chart-pnl-neg)"
        : "var(--fg-secondary)";

  return (
    <span
      data-num
      style={{
        display: "block",
        textAlign: align,
        color,
        fontFamily: "var(--font-mono)",
        fontVariantNumeric: "tabular-nums",
        fontSize: "var(--text-sm)",
      }}
    >
      {prefix}
      {sign}
      {value.toFixed(precision)}
      {suffix}
    </span>
  );
}

/** Compact inline variant for use inside table cells with no block display. */
export function NumericInline({
  value,
  precision = 2,
  suffix = "",
  signed = true,
}: Pick<NumericCellProps, "value" | "precision" | "suffix" | "signed">) {
  const sign = signed && value > 0 ? "+" : "";
  const color =
    value > 0
      ? "var(--chart-pnl-pos)"
      : value < 0
        ? "var(--chart-pnl-neg)"
        : "var(--fg-secondary)";
  return (
    <span
      data-num
      style={{
        color,
        fontFamily: "var(--font-mono)",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {sign}
      {value.toFixed(precision)}
      {suffix}
    </span>
  );
}
