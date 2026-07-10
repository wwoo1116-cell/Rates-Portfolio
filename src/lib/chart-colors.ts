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
