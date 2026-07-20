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
  "#E75353", // --chart-scarlet (S12: renamed from "--chart-berry" — this
  //            legacy red accent was never the MS Berry family, and the name
  //            collided with the now-locked Berry semantic)
] as const;

// Spreads reuse the same token palette (tangerine/scarlet) -- dashed line
// style (not a distinct hue) is what separates them from the rate-level lines.
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

/* ============================================================
   MASTER CHART PALETTE (S7) — MS 2022 accessibility system.
   Literal mirrors of tokens.css's --ms-* / --chart-* custom
   properties (canvas can't resolve var(); see file header).
   This module is the ONLY place chart code obtains these colors.
   Rules (DESIGN.md §2 "Chart Palette"):
   - Jade/Berry hue families are LOCKED to signed/directional
     semantics — app-wide, exclusively (S12 owner decision). They
     may appear ONLY through the semantic exports below (PNL_COLORS,
     HEAT_*); sector maps, series palettes, and non-signed ramps must
     never reference them. Enforced by
     scripts/check_semantic_color_lockdown.test.ts.
     (This REVOKES the old S7 exception that let SIM_SERIES_COLORS
     .carry reuse Jade-80 — carry is Aqua now.)
   - Sector hues are cool-family only (Blue/Navy/Aqua).
   One sanctioned exception:
   1. SIM_SERIES_COLORS keeps Purple-40/Tangerine-80 (and now Aqua
      for carry) despite the cool-family sector rule — that rule
      scopes to SECTOR encodings, and no sectors appear on the
      Simulation chart, so these hues stay isolated there for
      series discriminability.
   ============================================================ */

const MS = {
  blue: "#187ABA",      blue80: "#4695C8",
  blue40: "#A3CAE3",    blue20: "#D1E4F1",
  navy80: "#335574",    navy40: "#99AAB9",   navy20: "#CCD5DC",
  aqua: "#4CCACD",      aqua60: "#94DFE1",
  jade80: "#65C581",    jade40: "#B2E2C0",
  purple40: "#C2ADEB",
  berry80: "#DC398C",   berry40: "#ED9CC5",
  tangerine80: "#FB9B63",
} as const;

/** Backend sector keys exactly as returned by the allocation/analytics
 * endpoints (allocation_history_service.py; the 기타 catch-all is unpriceable
 * there and never reaches the response). */
export type SectorKey =
  | "국고채" | "통안채" | "공사채" | "특은채" | "시은채" | "여전채" | "회사채";

/** Global fixed sector mapping — identical in every view. Never assign by
 * index: a sector keeps its hue no matter how the response orders keys. */
export const SECTOR_COLORS: Record<SectorKey, string> = {
  국고채: MS.blue,     // --chart-sector-ktb      mid, saturated
  통안채: MS.navy40,   // --chart-sector-msb      light, desaturated
  공사채: MS.aqua,     // --chart-sector-agency   bright, saturated
  특은채: MS.navy80,   // --chart-sector-specbank dark — LARGE FILLS ONLY (≈2.2:1
  //                      vs --bg-surface; sanctioned for stacked-bar slices
  //                      where neighboring slices form the effective background;
  //                      never lines, markers, or text — DESIGN.md caveat)
  시은채: MS.blue80,   // --chart-sector-combank  mid
  여전채: MS.aqua60,   // --chart-sector-cardcap  very light cyan
  회사채: MS.navy20,   // --chart-sector-corp     near-white, desaturated
};

/** Credit-descending display order for stacks AND legends — matches the PVBP
 * table row-order decision. */
export const SECTOR_ORDER: readonly SectorKey[] = [
  "국고채", "통안채", "공사채", "특은채", "시은채", "여전채", "회사채",
];

/** Neutral fallback for keys outside the fixed mapping — visibly gray so a
 * mis-keyed sector reads as "unmapped", never as some other sector. */
const UNKNOWN_KEY_COLOR = "#5C7080"; // --fg-dim

/** y=0 baseline on P&L charts — recessive guide, not a data series. Canvas
 * literal for the same reason as everything else in this file. */
export const ZERO_LINE_COLOR = "#5C7080"; // --fg-dim

/** Canvas literals for chart CHROME (axis text, labels, neutral lines) —
 * hoisted verbatim from inline component hexes so the S7 no-raw-hex guard
 * has one reviewable home. The *Stale entries mirror PRE-Blueprint token
 * values that the components have been painting all along; re-aligning them
 * to the live tokens is a visual change and a pending owner decision
 * (HANDOFF_chart_colors.md), not something this refactor smuggles in. */
export const CHART_CHROME_COLORS = {
  accentLine: "#3B82F6", // --accent (PnL trace / spread-PnL cumulative lines)
  axisTextStale: "#6b7888", // pre-Blueprint --fg-muted (tenor-curve axis, heatmap sector labels)
  neutralTextStale: "#a0aab8", // pre-Blueprint --fg-secondary (heatmap zero-flow cells)
  leafLabelStale: "#e8ecf0", // pre-Blueprint --fg-primary (heatmap leaf labels)
  // Loading/error scrims over an lw-chart canvas. rgb(22,28,38) IS the stale
  // #161c26 canvas background lw-chart-base still paints (pixel-parity
  // pending owner decision) — the scrim must match the canvas beneath it,
  // not --bg-surface, or the overlay reads as a mis-toned box.
  scrimLightStale: "rgba(22, 28, 38, 0.75)",
  scrimHeavyStale: "rgba(22, 28, 38, 0.85)",
} as const;

const warnedKeys = new Set<string>();
function warnUnknownKey(kind: string, key: string): void {
  if (process.env.NODE_ENV === "production" || warnedKeys.has(key)) return;
  warnedKeys.add(key);
  console.warn(
    `[chart-colors] Unknown ${kind} key "${key}" — falling back to neutral. ` +
      "Backend keys and the fixed mapping have drifted; update SECTOR_COLORS/MATURITY_BUCKET_COLORS.",
  );
}

/** SECTOR_COLORS lookup that fails loudly (dev warn + neutral fallback) on an
 * unknown key instead of silently assigning by index. */
export function sectorColor(key: string): string {
  const c = (SECTOR_COLORS as Record<string, string>)[key];
  if (c) return c;
  warnUnknownKey("sector", key);
  return UNKNOWN_KEY_COLOR;
}

/** Maturity ramp — single Blue hue, luminance-stepped, longer = lighter. */
export const MATURITY_RAMP = {
  short: MS.blue,   // --chart-maturity-short  단기 <1Y
  mid: MS.blue80,   // --chart-maturity-mid    중기 1~3Y
  long: MS.blue40,  // --chart-maturity-long   장기 ≥3Y
} as const;

/** Backend maturity-bucket labels (allocation_history_service.MATURITY_BUCKETS)
 * → ramp steps. Same loud-fallback contract as sectorColor. */
export const MATURITY_BUCKET_COLORS: Record<string, string> = {
  "단기(1년 미만)": MATURITY_RAMP.short,
  "중기(1~3년)": MATURITY_RAMP.mid,
  "장기(3년 이상)": MATURITY_RAMP.long,
};

export function maturityColor(key: string): string {
  const c = MATURITY_BUCKET_COLORS[key];
  if (c) return c;
  warnUnknownKey("maturity", key);
  return UNKNOWN_KEY_COLOR;
}

/** P&L semantic pair — replaces green/red on every chart surface.
 * pos/neg for lines, markers, small text; *Fill for area fills. */
export const PNL_COLORS = {
  pos: MS.jade80,       // --chart-pnl-pos
  posFill: MS.jade40,   // --chart-pnl-pos-fill
  neg: MS.berry80,      // --chart-pnl-neg
  negFill: MS.berry40,  // --chart-pnl-neg-fill
} as const;

/** rgba() form of a palette hex, for canvas options that need translucency
 * (e.g. dimmed bid/ask companion lines). Keeps alpha variants derivable from
 * the single palette constant instead of hand-baked rgba literals. */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/* Signed-sensitivity heat ramps (S10) — DV01/PVBP/KRD heatmap CELL FILLS.
   Berry = negative, Jade = positive (the reserved P&L hue families), rendered
   as alpha steps of the -80 bases over the dark surface: stronger magnitude →
   stronger step. Replaces the legacy green/red (--sem-*) heatmap fills.
   Cell TEXT is fixed white (HEAT_TEXT_COLOR) on every step regardless of fill
   intensity — never dark text on a light step. */

export const HEAT_TEXT_COLOR = "#FFFFFF"; // --chart-heat-text
export const HEAT_POS_BASE = MS.jade80; // --chart-heat-pos
export const HEAT_NEG_BASE = MS.berry80; // --chart-heat-neg

/** Fill-strength steps, weakest → strongest. The top step is CLAMPED at 0.70:
 * solid Jade-80 would leave white text at ~2.1:1 vs the composited fill,
 * below the 3:1 floor — per the owner rule the ramp drops the failing steps
 * (clamps) rather than switching the text to dark.
 * Gate: scripts/check_heat_ramp_contrast.test.ts checks every step of both
 * families composited over --bg-surface against white text. */
export const HEAT_ALPHA_STEPS = [0.12, 0.26, 0.4, 0.55, 0.7] as const;

export const HEAT_POS_RAMP: readonly string[] = HEAT_ALPHA_STEPS.map((a) =>
  withAlpha(HEAT_POS_BASE, a),
);
export const HEAT_NEG_RAMP: readonly string[] = HEAT_ALPHA_STEPS.map((a) =>
  withAlpha(HEAT_NEG_BASE, a),
);

/** Heatmap cell fill for a signed sensitivity value: |value|/range picks the
 * ramp step, sign picks the family. Zero values and degenerate ranges get no
 * fill (callers keep their muted zero/em-dash treatment). */
export function heatRampFill(value: number, range: number): string {
  if (!Number.isFinite(value) || value === 0 || !(range > 0)) return "transparent";
  const t = Math.min(Math.abs(value) / range, 1);
  const idx = Math.min(HEAT_ALPHA_STEPS.length - 1, Math.floor(t * HEAT_ALPHA_STEPS.length));
  return (value > 0 ? HEAT_POS_RAMP : HEAT_NEG_RAMP)[idx];
}

/** Simulation Total-Return series — composite hierarchy: total emphasized
 * (line width 3), components subdued. Key names match chart-theme.ts /
 * lastRun.chartData fields. See the sanctioned-exception notes above.
 * S12: carry moved Jade-80 → Aqua (the Jade/Berry lockdown revoked the old
 * exception; Aqua is carry's nearest non-signed perceptual neighbor and no
 * sectors appear on the Simulation chart to collide with). */
export const SIM_SERIES_COLORS = {
  total: MS.blue20,           // --chart-series-total      합계
  mtm: MS.blue80,             // --chart-series-mtm        채권 MTM
  carry: MS.aqua,             // --chart-series-carry      캐리
  swapTheta: MS.purple40,     // --chart-series-swaptheta  스왑세타 (exception 1)
  swapValuation: MS.tangerine80, // --chart-series-swapmtm 스왑평가 (exception 1)
  // HARDEN-1 — the fifth component line (조달비용) for the Results
  // component-curves hero. Navy-40: master-palette, non-reserved (Jade/Berry
  // are sign-locked and untouched; the cool-family sector rule scopes to
  // SECTOR encodings), ~6.0:1 vs --bg-surface so the contrast gate passes
  // with no allowlist entry, and desaturated on purpose — funding is a
  // financing-cost line, visually secondary to the four P&L components.
  funding: MS.navy40,         // --chart-series-funding    조달비용
} as const;
