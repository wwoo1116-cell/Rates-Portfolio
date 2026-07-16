/**
 * Shared default policies for chart series (s14) — pure module, no React and
 * no lightweight-charts import, so gates can unit-test the defaults directly.
 *
 * 1. Formatter-by-kind: a series declares WHAT its values are (valueKind) and
 *    the right axis/badge/tooltip formatter follows by default — KRW surfaces
 *    get the signed 억/만 formatter (owner directive: no raw floats or
 *    sub-만원 digits on any KRW chart surface). An explicit `formatter` on
 *    the series def always wins, so pre-s14 hosts are unaffected.
 *
 * 2. Badge collision policy: multi-series panes stacked one last-value badge
 *    per series into an unreadable pile (observed live: 5 overlapping
 *    badges). Above DEFAULT_BADGE_LIMIT series, only series opted in as
 *    `primary` keep their badge — the rest stay readable via crosshair. A
 *    per-series `lastValueBadge` is the hard override in both directions.
 */
import { formatBp, formatKrwAxisSigned } from "@/lib/format";

/** Global formatter for interest rates (e.g., 0.0239 -> 2.3900%). Lived in
 * lw-chart-base since inception; owned here since s14 (re-exported there). */
export const rateFormatter = (v: number) => `${(v * 100).toFixed(4)}%`;

export type SeriesValueKind = "krw" | "rate" | "bp";

const KIND_FORMATTERS: Record<SeriesValueKind, (v: number) => string> = {
  krw: formatKrwAxisSigned,
  rate: rateFormatter,
  bp: formatBp,
};

/** The formatter a series actually renders with: explicit `formatter` wins,
 * then the declared kind's default, then undefined (library/host fallback —
 * only correct for series that are neither KRW, rate, nor bp). */
export function resolveSeriesFormatter(def: {
  formatter?: (v: number) => string;
  valueKind?: SeriesValueKind;
}): ((v: number) => string) | undefined {
  return def.formatter ?? (def.valueKind ? KIND_FORMATTERS[def.valueKind] : undefined);
}

/** Panes with at most this many series show every last-value badge; above it
 * the primary-only policy kicks in. */
export const DEFAULT_BADGE_LIMIT = 2;

/** Whether a series shows its last-value badge under the collision policy. */
export function badgeVisible(
  def: { primary?: boolean; lastValueBadge?: boolean },
  seriesCount: number,
  limit: number = DEFAULT_BADGE_LIMIT,
): boolean {
  return def.lastValueBadge ?? (seriesCount <= limit || def.primary === true);
}
