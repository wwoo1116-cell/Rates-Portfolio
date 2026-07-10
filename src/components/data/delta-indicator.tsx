import { cn } from "@/lib/utils";

export interface DeltaIndicatorProps {
  value: number;
  suffix?: string;
  percentage?: number;
  precision?: number;
  className?: string;
}

export function DeltaIndicator({
  value,
  suffix = "",
  percentage,
  precision = 2,
  className,
}: DeltaIndicatorProps) {
  const positive = value >= 0;
  const sign = positive ? "+" : "";
  const color = positive ? "var(--sem-positive)" : "var(--sem-negative)";

  return (
    <span
      data-num
      className={cn("inline-flex items-center gap-1", className)}
      style={{
        color,
        fontFamily: "var(--font-mono)",
        fontVariantNumeric: "tabular-nums",
        fontSize: "var(--text-sm)",
        fontWeight: 500,
      }}
    >
      <span aria-hidden>{positive ? "▲" : "▼"}</span>
      <span>
        {sign}
        {value.toFixed(precision)}
        {suffix}
        {percentage !== undefined &&
          ` (${percentage >= 0 ? "+" : ""}${percentage.toFixed(precision)}%)`}
      </span>
    </span>
  );
}
