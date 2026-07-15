/**
 * Single source of truth for the Simulation Screen's chart colors (protocol §2.2:
 * "Chart theme built once in features/simulation/lib/chartTheme.ts reading CSS
 * variables"). Every hardcoded hex the source baked into its recharts JSX is mapped
 * here to a target design token and read from the live CSS custom properties.
 *
 * WHY runtime reads, not Tailwind classes: recharts/lightweight-charts paint to
 * <canvas>/SVG attributes that cannot resolve `var(--x)` (see @/lib/canvas-color).
 * So the chart lib gets resolved hex strings from here; DOM legend swatches use the
 * `bg-chart-*` Tailwind utilities added in Phase 2 instead.
 *
 * Consumed by the Phase-4 (S5) chart rewrite when the two staged recharts components
 * are re-implemented on the target's lightweight-charts + d3 stack.
 */
import { resolveCssVar } from "@/lib/canvas-color";

/** Source hardcoded hex → target token (var name) → literal fallback (SSR/first paint).
 * Fallbacks equal the live tokens.css values, which are byte-identical to the source. */
export interface SimulationChartTheme {
  /** Chart canvas background — matches the panel surface (--bg-surface). */
  background: string;
  /** CartesianGrid stroke — was rgba(16,22,26,0.3). */
  grid: string;
  /** Axis line + tick label fill — was #8A9BA8. */
  axis: string;
  /** Tooltip surface / border / text — was #30404D / rgba(16,22,26,0.3) / #F5F8FA. */
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  /** y=0 baseline — was #5C7080. */
  zeroLine: string;
  /** Break-even reference line — was #0F9960. */
  bepLine: string;
  /** Waypoint dot stroke (ring against panel) — was #293742. */
  dotStroke: string;
  /** Total-Return trace series (ScenarioSimulator). */
  series: {
    /** 채권 MTM — was #E75353. */ mtm: string;
    /** 채권 캐리 — was #2B95D6. */ carry: string;
    /** 스왑세타 — was #8A9BA8. */ swapTheta: string;
    /** 스왑평가 — was #D9822B. */ swapValuation: string;
    /** Total Return — was #137CBD. */ total: string;
  };
  /** Preview-chart categorical palette — was ['#2B95D6','#91CCF1','#D9822B','#E75353','#8A9BA8','#137CBD']. */
  previewPalette: string[];
}

export function getSimulationChartTheme(): SimulationChartTheme {
  const berry = resolveCssVar("--chart-berry", "#E75353");
  const ocean = resolveCssVar("--chart-ocean", "#2B95D6");
  const aqua = resolveCssVar("--chart-aqua", "#91CCF1");
  const purple = resolveCssVar("--chart-purple", "#8A9BA8"); // source called this --chart-violet
  const tangerine = resolveCssVar("--chart-tangerine", "#D9822B");
  const accent = resolveCssVar("--accent", "#3B82F6");

  return {
    background: resolveCssVar("--bg-surface", "#202B33"),
    grid: resolveCssVar("--border-subtle", "rgba(16,22,26,0.30)"),
    axis: resolveCssVar("--fg-muted", "#8A9BA8"),
    tooltipBg: resolveCssVar("--bg-raised", "#30404D"),
    tooltipBorder: resolveCssVar("--border-subtle", "rgba(16,22,26,0.30)"),
    tooltipText: resolveCssVar("--fg-primary", "#F5F8FA"),
    zeroLine: resolveCssVar("--fg-dim", "#5C7080"),
    bepLine: resolveCssVar("--sem-positive", "#0F9960"),
    dotStroke: resolveCssVar("--bg-base", "#293742"),
    series: {
      mtm: berry,
      carry: ocean,
      swapTheta: purple,
      swapValuation: tangerine,
      total: accent,
    },
    previewPalette: [ocean, aqua, tangerine, berry, purple, accent],
  };
}
