import { HTMLAttributes } from "react";

interface PriceDisplayProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  value: number;
  precision?: number;
  /** Trailing dim label, e.g. "%", "bp", "KRW". See DESIGN.md "Signature Component: PriceDisplay". */
  unit?: string;
  /** "display" for hero KPI tiles (--text-2xl); "body" (default) for grid cells / inline use. */
  size?: "display" | "body";
}

/**
 * DESIGN.md's big-figure notation: the digit string splits into three visual
 * weights -- base (dim), a 3-digit big figure (bold, full emphasis), unit
 * (dim). Example: 3.4567 with unit="%" -> "3.4" dim / "567" bold / "%" dim.
 * The first fractional digit stays with the base; the next up to 3 digits
 * become the big figure; anything left over past that joins the dim tail
 * ahead of the unit.
 */
export function PriceDisplay({ value, precision = 4, unit = "", size = "body", style, ...props }: PriceDisplayProps) {
  const isNegative = value < 0;
  const strValue = Math.abs(value).toFixed(precision);

  const [integerPart, fractionalPart = ""] = strValue.split(".");
  const base = fractionalPart.slice(0, 1);
  const bigFigure = fractionalPart.slice(1, 4);
  const tail = fractionalPart.slice(4);

  const bigFigureStyle: React.CSSProperties =
    size === "display"
      ? { fontWeight: 700, fontSize: "var(--text-2xl)", color: "var(--fg-primary)" }
      : { fontWeight: 600, color: "var(--fg-primary)" };

  // "display" (hero KPI tiles) keeps its own established convention of a
  // smaller trailing unit next to the oversized big figure. Everywhere else
  // (grid cells, e.g. the RATE column) the whole string must render at one
  // identical font-size/family -- emphasis on the big figure comes from
  // font-weight and color alone, never a size step, per DESIGN.md.
  const tailStyle: React.CSSProperties =
    size === "display" ? { color: "var(--fg-dim)", fontSize: "0.85em" } : { color: "var(--fg-dim)" };

  return (
    <span
      className="num"
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        justifyContent: "flex-end",
        fontFamily: "var(--font-ui)",
        ...style,
      }}
      {...props}
    >
      {isNegative && <span style={{ color: "var(--sem-negative)" }}>-</span>}
      <span style={{ color: "var(--fg-dim)" }}>
        {integerPart}
        {base && `.${base}`}
      </span>
      {bigFigure && <span style={bigFigureStyle}>{bigFigure}</span>}
      <span style={tailStyle}>
        {tail}
        {unit}
      </span>
    </span>
  );
}
