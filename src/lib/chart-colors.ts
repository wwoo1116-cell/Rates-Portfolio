/**
 * Literal hex values mirroring tokens.css's --chart-* custom properties.
 * lightweight-charts renders to canvas, which can't resolve CSS custom
 * properties (var(--chart-ocean)) the way DOM styles can -- lw-chart-base.tsx
 * hardcodes its own colors for the same reason. Single dark theme, no
 * light/dark split for these tokens, so a static literal is safe.
 */
export const CHART_SERIES_COLORS = [
  "#2B95D6", // --chart-ocean
  "#91CCF1", // --chart-aqua
  "#8A9BA8", // --chart-purple
  "#D9822B", // --chart-tangerine
  "#E75353", // --chart-berry
] as const;

// Spreads reuse the same token palette (tangerine/berry) -- dashed line style
// (not a distinct hue) is what separates them from the rate-level lines.
export const SPREAD_SERIES_COLORS = ["#D9822B", "#E75353"] as const;

// Larger palette for the RV selector's dynamic multi-series overlay -- the
// 5-hue CHART_SERIES_COLORS set isn't enough when a user stacks many
// outrights + spreads. 12 visually-distinct Blueprint core hues; colors are
// assigned by a stable hash of each instrument's id (colorForId) rather than
// by loop index, so adding/removing one instrument never reshuffles the
// others' colors.
export const RV_SERIES_COLORS = [
  "#2D72D2", // blue
  "#D9822B", // orange
  "#29A634", // green
  "#9179F2", // indigo
  "#DB2C6F", // rose
  "#00A396", // turquoise
  "#D1980B", // gold
  "#8A9BA8", // gray
  "#147EB3", // cerulean
  "#C22762", // magenta
  "#43BF4D", // lime
  "#634DBF", // violet
] as const;

/** Deterministic color for an instrument id -- stable across add/remove so a
 * series keeps its hue even as the selected set changes. */
export function colorForId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return RV_SERIES_COLORS[Math.abs(h) % RV_SERIES_COLORS.length];
}
