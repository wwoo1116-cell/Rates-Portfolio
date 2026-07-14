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
