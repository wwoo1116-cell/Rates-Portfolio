/**
 * Class B (shared-pure) — scenario preview computation lifted from the source
 * ScenarioPreviewChart (time-path view). Pure/deterministic; feeds the Curve View
 * panel's lightweight-charts series without a DOM.
 */
import type { ScenarioParams } from "../types/simulation-port";
import { deriveFundingSteps, toNum } from "./scenario-curves";

/** Linear interpolation of the 국채 3Y bp path across sorted waypoints. */
export function lerpWaypoints(day: number, sorted: { day: number; bp: number }[]): number {
  if (!sorted.length) return 0;
  if (day <= sorted[0].day) return sorted[0].bp;
  if (day >= sorted[sorted.length - 1].day) return sorted[sorted.length - 1].bp;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (day >= sorted[i].day && day <= sorted[i + 1].day) {
      const r = (day - sorted[i].day) / (sorted[i + 1].day - sorted[i].day);
      return sorted[i].bp + r * (sorted[i + 1].bp - sorted[i].bp);
    }
  }
  return 0;
}

/** Step lookup of cumulative BOK base-rate change at a given day. */
export function lookupFunding(day: number, steps: { day: number; cumBp: number }[]): number {
  let cum = 0;
  for (const s of steps) {
    if (s.day <= day) cum = s.cumBp;
    else break;
  }
  return cum;
}

export interface PreviewPoint {
  day: number;
  gov3y: number;
  /** Cumulative BOK base-rate path; null when there are no 금통위 events. */
  policyRate: number | null;
}

/**
 * Sampled 국채 3Y bp path (+ optional policy-rate path) over the horizon — the
 * source's timeData. Sampling densifies around waypoints and event days.
 */
export function buildTimePath(params: ScenarioParams, baseDate: string): PreviewPoint[] {
  const sorted = [...params.waypoints].sort((a, b) => a.day - b.day);
  const maxDay = sorted.length > 0 ? sorted[sorted.length - 1].day : params.simDays;
  const fundingSteps = deriveFundingSteps(params.shortEndEvents, baseDate, params.simDays);
  const hasFunding = fundingSteps.length > 0;
  const baseShockBp = toNum(params.baseShockBp);

  const daySet = new Set<number>([0]);
  const step = Math.max(1, Math.floor(maxDay / 60));
  for (let d = step; d < maxDay; d += step) daySet.add(d);
  daySet.add(maxDay);
  sorted.forEach((w) => daySet.add(w.day));
  fundingSteps.forEach((s) => {
    if (s.day > 0) daySet.add(s.day - 1);
    daySet.add(s.day);
  });

  return [...daySet]
    .filter((d) => d >= 0)
    .sort((a, b) => a - b)
    .map((day) => {
      const bp = sorted.length >= 2 ? lerpWaypoints(day, sorted) : (day / params.simDays) * baseShockBp;
      return {
        day,
        gov3y: parseFloat(bp.toFixed(2)),
        policyRate: hasFunding ? lookupFunding(day, fundingSteps) : null,
      };
    });
}
