"use client";

/**
 * RECON2-RH — the M2 Δbp row as a time series (range mode, RH mount only).
 *
 * A VIEW over the SAME M2 machinery, structurally: every point is read from
 * `ReconRangeRow.deltaBp` — the exact object the range loop's single Δbp
 * computation produced (and the assumed leg consumed). This file deliberately
 * imports neither the recon math module nor any API client; a forked
 * recomputation anywhere fails scripts/check_deltabp_reuse.test.ts (which
 * matches the forbidden identifiers by name — hence the paraphrases here).
 *
 * Display rules:
 *  - Default = ALL tenor pillars on simultaneously (owner ruling); the chips
 *    are FILTERS on top of that, tenor-only (the snapshot data carries a
 *    single curve family — no family axis exists here).
 *  - Series labels use the day-offset vocabulary: D+1 / D+91 / D+182 / D+273
 *    / D+1Y / D+18M / … / D+30Y (91 = the CD91D convention; chips carry the
 *    same labels with the KRD column name as their title).
 *  - Legibility under 16 concurrent series WITHOUT new hues (master-palette
 *    rules; maturity ramp has exactly 3 steps): each series wears its
 *    maturity-bucket color from the EXISTING ramp tokens (--chart-maturity-*:
 *    단기 <1Y / 중기 1–3Y / 장기 >3Y, lineWidth 1), and hovering a chip
 *    highlights that one tenor in the EXISTING Tangerine accent
 *    (--chart-tangerine — the hue this app already uses for a second curve
 *    against blue, and not a P&L hue) at lineWidth 3. Badges follow the s14
 *    collision policy: 16 series ≫ limit, so only the 3Y series is `primary`.
 *  - Calendar honesty (s15): the axis is real calendar days; weekends and
 *    holidays between reconciliation days are whitespace slots. An unmapped
 *    tenor-day (null Δbp) and a window-mismatch day (no deltaBp map at all)
 *    are whitespace too — never zero. A measured 0.0bp IS a value point at
 *    0.0 (the 48a6b15 zero-vs-unmapped rule).
 */
import { useMemo, useState } from "react";

import { SeriesChart, type SeriesChartSeriesDef } from "@/components/charts/series-chart";
import { CHART_SERIES_COLORS, MATURITY_RAMP } from "@/lib/chart-colors";
import { cn } from "@/lib/utils";
import type { ReconRangeRow } from "@/hooks/use-recon-range";
import { TENOR_COLS } from "./pvbp-sensitivity-table";

/** KRD column → day-offset series label (D+1 / D+91 / D+1Y style). Fixed
 * table over the known 16 columns — no parsing, no derived math. */
export const TENOR_DAY_LABELS: Record<string, string> = {
  "1D": "D+1",
  "3M": "D+91", // CD91D convention
  "6M": "D+182",
  "9M": "D+273",
  "1Y": "D+1Y",
  "1.5Y": "D+18M",
  "2Y": "D+2Y",
  "3Y": "D+3Y",
  "4Y": "D+4Y",
  "5Y": "D+5Y",
  "6Y": "D+6Y",
  "7Y": "D+7Y",
  "8Y": "D+8Y",
  "9Y": "D+9Y",
  "10Y": "D+10Y",
  "30Y": "D+30Y",
};

/** Tenor years for bucketing only (fixed lookup — not a parser). */
const TENOR_YEARS: Record<string, number> = {
  "1D": 1 / 365, "3M": 0.25, "6M": 0.5, "9M": 0.75, "1Y": 1, "1.5Y": 1.5, "2Y": 2,
  "3Y": 3, "4Y": 4, "5Y": 5, "6Y": 6, "7Y": 7, "8Y": 8, "9Y": 9, "10Y": 10, "30Y": 30,
};

/** Maturity-ramp bucket color for a tenor — the EXISTING 3-step ramp
 * (chart-colors MATURITY_RAMP: 단기 <1Y, 중기 1–3Y inclusive, 장기 >3Y). */
export function tenorBucketColor(col: string): string {
  const t = TENOR_YEARS[col] ?? 0;
  if (t < 1) return MATURITY_RAMP.short;
  if (t <= 3) return MATURITY_RAMP.mid;
  return MATURITY_RAMP.long;
}

/** Hover-highlight accent: the existing Tangerine series hue (not a new
 * color, not a P&L hue). */
export const HIGHLIGHT_COLOR = CHART_SERIES_COLORS[3];

/** The anchor pillar keeps the only last-value badge under the s14
 * collision policy (primary-only at 16 series). */
const PRIMARY_TENOR = "3Y";

function isoAddDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 86400000).toISOString().slice(0, 10);
}

/** Continuous calendar-day axis from the first to the last reconciliation
 * day — the s15 whitespace rule needs the in-between weekend/holiday slots
 * to exist as whitespace points. */
export function calendarAxis(rows: ReconRangeRow[]): string[] {
  if (rows.length === 0) return [];
  const dates = rows.map((r) => r.asOf).sort();
  const out: string[] = [];
  for (let d = dates[0]; d <= dates[dates.length - 1]; d = isoAddDays(d, 1)) out.push(d);
  return out;
}

/**
 * Series defs for the selected tenors — pure, exported for the parity pins.
 * Point rule per (day, tenor): a value point ONLY when the day has a
 * retained deltaBp map AND that tenor's Δbp is non-null; everything else
 * (weekend/holiday slot, window-mismatch day, unmapped pillar) is a
 * whitespace point. Values are read from the retained map — never computed.
 */
export function buildDeltaBpSeries(
  rows: ReconRangeRow[],
  selected: readonly string[],
  highlighted: string | null,
): SeriesChartSeriesDef[] {
  const axis = calendarAxis(rows);
  const byDay = new Map(rows.map((r) => [r.asOf, r]));
  return TENOR_COLS.filter((c) => selected.includes(c)).map((col) => {
    const isHighlight = highlighted === col;
    return {
      id: col,
      label: TENOR_DAY_LABELS[col] ?? col,
      color: isHighlight ? HIGHLIGHT_COLOR : tenorBucketColor(col),
      lineWidth: isHighlight ? 3 : 1,
      valueKind: "bp" as const,
      primary: col === PRIMARY_TENOR,
      axisTitle: TENOR_DAY_LABELS[col] ?? col,
      data: axis.map((day) => {
        const v = byDay.get(day)?.deltaBp?.[col];
        return v != null ? { time: day, value: v } : { time: day };
      }),
    };
  });
}

export function ReconDeltaBpChart({ rows }: { rows: ReconRangeRow[] }) {
  // Owner ruling: all pillars on by default; chips filter down (≥1 stays).
  const [selected, setSelected] = useState<string[]>([...TENOR_COLS]);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  const series = useMemo(
    () => buildDeltaBpSeries(rows, selected, highlighted),
    [rows, selected, highlighted],
  );

  const toggle = (col: string) =>
    setSelected((cur) =>
      cur.includes(col) ? (cur.length > 1 ? cur.filter((c) => c !== col) : cur) : [...cur, col],
    );

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
        <span className="mr-1 text-label font-bold uppercase text-fg-muted">테너</span>
        {TENOR_COLS.map((col) => (
          <button
            key={col}
            type="button"
            title={col}
            aria-pressed={selected.includes(col)}
            onClick={() => toggle(col)}
            onMouseEnter={() => setHighlighted(col)}
            onMouseLeave={() => setHighlighted((cur) => (cur === col ? null : cur))}
            data-num
            className={cn(
              "border border-border-subtle px-1.5 py-0.5 text-micro",
              selected.includes(col)
                ? "bg-sem-info-ghost text-sem-info shadow-[inset_0_0_0_1px_var(--sem-info)]"
                : "text-fg-muted",
            )}
          >
            {TENOR_DAY_LABELS[col] ?? col}
          </button>
        ))}
      </div>

      <div className="h-56 w-full" data-testid="deltabp-chart-host">
        <SeriesChart series={series} tooltip zeroLine />
      </div>

      <p className="text-micro text-fg-dim">
        M2 Δbp 시계열 — 각 일자의 값은 일별 대사 M2 행과 동일 원천(보존된 동일 객체)입니다.
        스왑/CD 필러 단일 곡선군 (가족 축 없음) · 주말/휴일·창 불일치일·미매핑 필러는
        공백으로 표시 (0 아님) · 칩에 호버하면 해당 테너 강조.
      </p>
    </div>
  );
}
