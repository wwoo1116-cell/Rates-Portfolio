/**
 * Plain single-string financial formatters, for values that should render as
 * one cohesive number + unit (Home's Status panel) -- as opposed to
 * PriceDisplay's DESIGN.md "big figure" rate-quote notation (base/big-figure/
 * tail split across separate spans), which is only correct for rate/price
 * quotes like the grid's Rate column, not for duration/PnL/notional figures.
 */

const KRW_FORMATTER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** e.g. 3.395 -> "3.40 Y". */
export function formatDuration(years: number): string {
  return `${years.toFixed(2)} Y`;
}

/** e.g. -193301705.4 -> "-193,300,000 KRW". Truncated (not rounded) to the
 * nearest 10,000 KRW (만원 단위 절삭) -- KRW has no minor unit, and figures this
 * large don't need won-level precision. */
export function formatKrw(value: number): string {
  const truncated = Math.trunc(value / 10_000) * 10_000;
  return `${KRW_FORMATTER.format(truncated)} KRW`;
}

/** Notional is stored in units of 100M KRW (the app-wide "100M KRW"/억 convention
 * -- see PortfolioPositionIn.notional, positions-grid.tsx's Notional column).
 * e.g. 200 (100M KRW) -> "20,000M KRW". */
export function formatNotionalKrw(notional100M: number): string {
  const millions = notional100M * 100;
  return `${KRW_FORMATTER.format(Math.round(millions))}M KRW`;
}

/** Raw KRW in Korean short-scale units, for space-constrained readouts (Home's
 * data ribbon) where formatKrw's full digit string would blow the line:
 * e.g. 1.23e12 -> "1.23조", 5.4e9 -> "54.0억".
 *
 * Values under 1억 fall through to plain grouped digits -- below that the unit
 * prefix stops buying anything. This is a display-only abbreviation; anything
 * doing arithmetic wants the raw number. */
export function formatKrwCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(value / 1e12).toFixed(2)}조`;
  if (abs >= 1e8) return `${(value / 1e8).toFixed(1)}억`;
  return KRW_FORMATTER.format(Math.round(value));
}

/** Chart y-axis KRW formatter (canonical SeriesChart, S7): ≥1e8 -> "N.N억",
 * ≥1e4 -> "N만" (grouped), below that plain grouped digits -- never a raw
 * float like "10000000000.00" on an axis. Differs from formatKrwCompact by
 * adding the 만 tier: P&L axes live in the 1e4..1e8 band where 억-only
 * formatting collapses every tick to "0.0억". */
export function formatKrwAxis(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e8) return `${(value / 1e8).toFixed(1)}억`;
  if (abs >= 1e4) return `${KRW_FORMATTER.format(Math.round(value / 1e4))}만`;
  return KRW_FORMATTER.format(Math.round(value));
}

/** formatKrwAxis with an explicit sign for positive values ("+3.2억",
 * "-450만") — for SIGNED KRW chart surfaces (MtM/P&L) where the axis ticks,
 * tooltip rows, and last-value badges must all carry the sign and never show
 * sub-만원 digits (S10 Portfolio MtM formatting decision). */
export function formatKrwAxisSigned(value: number): string {
  return value > 0 ? `+${formatKrwAxis(value)}` : formatKrwAxis(value);
}
