/**
 * Canvas-literal design colors for the Entry Signals charts.
 *
 * lightweight-charts renders to <canvas>, which cannot resolve CSS custom
 * properties (var(--...)) the way DOM styles can, so series / SMA / band /
 * threshold-line / marker colors must be literal hex. These mirror tokens.css
 * EXACTLY and are centralized here (one place to review) rather than scattered
 * inline -- the same rationale and pattern as src/lib/chart-colors.ts.
 * Keep in sync with tokens.css if those tokens ever change.
 */
import { PNL_COLORS } from "@/lib/chart-colors";

export const CHART_COLORS = {
  fgMuted: "#8A9BA8", // --fg-muted  (SMA line)
  fgDim: "#5C7080", // --fg-dim    (±σ bands, warn thresholds)
  accent: "#3B82F6", // --accent    (zero line)
  // Chart P&L pair (S7): Jade/Berry replace green/red on chart surfaces —
  // entry-long / win markers and entry-short / loss markers + ±σ entry lines.
  positive: PNL_COLORS.pos, // --chart-pnl-pos (cheap / entry-long)
  negative: PNL_COLORS.neg, // --chart-pnl-neg (rich / entry-short)
} as const;
