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
import { PNL_COLORS, SIM_SERIES_COLORS } from "@/lib/chart-colors";

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
    /** 조달비용 (HARDEN-1 component-curves hero). */ funding: string;
  };
  /** Preview-chart categorical palette — was ['#2B95D6','#91CCF1','#D9822B','#E75353','#8A9BA8','#137CBD']. */
  previewPalette: string[];
  /** Signed P&L pair (Jade/Berry, S7/iv3 universal): pos/neg for lines &
   * labels, posFill/negFill (the 40-step) for bar/area bodies. */
  pnl: { pos: string; neg: string; posFill: string; negFill: string };
}

export function getSimulationChartTheme(): SimulationChartTheme {
  const ocean = resolveCssVar("--chart-ocean", "#2B95D6");
  const aqua = resolveCssVar("--chart-aqua", "#91CCF1");
  // iv3: token renamed --chart-berry → --chart-scarlet by s12 (the legacy red
  // accent was never the MS Berry family); same hex, name rewired.
  const berry = resolveCssVar("--chart-scarlet", "#E75353");
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
    // Break-even marker carries chart-P&L-positive (Jade), not the app sem
    // token — Jade/Berry replace green/red on chart surfaces (S7).
    bepLine: resolveCssVar("--chart-pnl-pos", PNL_COLORS.pos),
    dotStroke: resolveCssVar("--bg-base", "#293742"),
    // Total-Return series — MS-palette composite hierarchy (S7): 합계
    // emphasized on Blue-20, components subdued. Tokens --chart-series-*;
    // fallbacks are their lib/chart-colors.ts mirrors.
    series: {
      mtm: resolveCssVar("--chart-series-mtm", SIM_SERIES_COLORS.mtm),
      carry: resolveCssVar("--chart-series-carry", SIM_SERIES_COLORS.carry),
      swapTheta: resolveCssVar("--chart-series-swaptheta", SIM_SERIES_COLORS.swapTheta),
      swapValuation: resolveCssVar("--chart-series-swapmtm", SIM_SERIES_COLORS.swapValuation),
      total: resolveCssVar("--chart-series-total", SIM_SERIES_COLORS.total),
      funding: resolveCssVar("--chart-series-funding", SIM_SERIES_COLORS.funding),
    },
    previewPalette: [ocean, aqua, tangerine, berry, purple, accent],
    pnl: {
      pos: resolveCssVar("--chart-pnl-pos", PNL_COLORS.pos),
      neg: resolveCssVar("--chart-pnl-neg", PNL_COLORS.neg),
      posFill: resolveCssVar("--chart-pnl-pos-fill", PNL_COLORS.posFill),
      negFill: resolveCssVar("--chart-pnl-neg-fill", PNL_COLORS.negFill),
    },
  };
}
