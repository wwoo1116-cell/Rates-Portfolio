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

/* ============================================================
   MASTER CHART PALETTE (S7) — MS 2022 accessibility system.
   Literal mirrors of tokens.css's --ms-* / --chart-* custom
   properties (canvas can't resolve var(); see file header).
   This module is the ONLY place chart code obtains these colors.
   Rules (DESIGN.md §2 "Chart Palette"):
   - Jade/Berry hue families are RESERVED for P&L semantics.
   - Sector hues are cool-family only (Blue/Navy/Aqua).
   Two sanctioned exceptions:
   1. SIM_SERIES_COLORS.carry reuses Jade-80 inside the Simulation
      Total-Return chart only — no P&L up/down markers coexist
      there, so the hue cannot be misread as sign.
   2. SIM_SERIES_COLORS keeps Purple-40/Tangerine-80 despite the
      cool-family sector rule — that rule scopes to SECTOR
      encodings, and no sectors appear on the Simulation chart,
      so these hues stay isolated there for series discriminability.
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

/** Simulation Total-Return series — composite hierarchy: total emphasized
 * (line width 3), components subdued. Key names match chart-theme.ts /
 * lastRun.chartData fields. See the sanctioned-exception notes above. */
export const SIM_SERIES_COLORS = {
  total: MS.blue20,           // --chart-series-total      합계
  mtm: MS.blue80,             // --chart-series-mtm        채권 MTM
  carry: MS.jade80,           // --chart-series-carry      캐리 (exception 1)
  swapTheta: MS.purple40,     // --chart-series-swaptheta  스왑세타 (exception 2)
  swapValuation: MS.tangerine80, // --chart-series-swapmtm 스왑평가 (exception 2)
} as const;
