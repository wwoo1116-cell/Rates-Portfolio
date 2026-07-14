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
export const CHART_COLORS = {
  fgMuted: "#8A9BA8", // --fg-muted  (SMA line)
  fgDim: "#5C7080", // --fg-dim    (±σ bands, warn thresholds)
  accent: "#137CBD", // --accent    (zero line)
  positive: "#0F9960", // --sem-positive (cheap / entry-long)
  negative: "#DB3737", // --sem-negative (rich / entry-short)
} as const;
