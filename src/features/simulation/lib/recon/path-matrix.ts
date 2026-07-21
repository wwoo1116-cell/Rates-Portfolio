/**
 * RECON-SCEN M2 — the designed scenario path as a day × tenor cumulative-Δbp
 * matrix. ONE source of truth: the Results 대사 view (M3's assumed lane) and
 * the Configure 시계열형 multi-series preview (F2) both read THIS module, and
 * it is composed ONLY from the existing path machinery — waypoint lerp
 * (scenario-preview.lerpWaypoints — the same lerp the backend's _factor
 * applies), the BOK staircase (scenario-curves.deriveFundingSteps +
 * scenario-preview.lookupFunding), and the terminal shock-curve interpolation
 * (input-curve-preview.shockAtTenor over the request's generateShockCurves
 * nodes). No re-derived math.
 *
 * Input is the REQUEST shape (SimulateRequest), not live params: the Results
 * view evaluates the path of the run that actually happened
 * (lastRunRequest), and Configure feeds the request buildSimulateRequest
 * would ship — structural payload identity, not a parallel formula.
 *
 * Tenor stitching mirrors the engine's documented zone rules
 * (krw-fi-pms-backend services/simulation/chart.py):
 *  - bond families — calculate_daily_mtm zones (chart.py ~120-132):
 *      τ < 3M   : normalized BOK staircase factor (_short_factor)
 *      3M–1Y    : linear factor blend, w = (τ−0.25)/0.75
 *      ≥ 1Y     : the designed path factor (_factor)
 *    applied as  effFactor × terminal_family(τ).
 *  - swap family — the recon loop's _cum_shock_r (chart.py ~295-316):
 *      no BOK events → terminal_swap(τ) × factor for every τ; with events the
 *      short end is the BOK cumulative bp DIRECT (not normalized × terminal),
 *      blended into the ramp by the same w.
 *  Without 금통위 events both models reduce to factor × terminal(τ) exactly.
 *
 * Known, deliberate divergence (documented in RECON_SCEN_REPORT.md): for a
 * TRIVIAL path (customPath exactly on the target×day/simDays line) the
 * engine's swap lanes use a BIZ-DAY-RANKED ramp (chart.py _ramp_factor_r)
 * while this module keeps the FE's calendar semantics (buildTimePath). The
 * FE always ships explicit waypoints, and any user-shaped path is non-trivial
 * → both sides use the identical calendar waypoint lerp. The gap only exists
 * on the untouched default ramp and lands in the 잔차 path, where it belongs.
 */
import type { SimulateRequest } from "../../api/simulate-dto";
import { deriveFundingSteps } from "../scenario-curves";
import { lerpWaypoints, lookupFunding } from "../scenario-preview";
import { shockAtTenor } from "../input-curve-preview";

/** Full engine KRD pillar set — mirrors quant_engine.KRD_NAMES/KRD_TENORS
 * (backend engine/quant_engine.py:41-42). Every column, no abbreviation
 * (the Home PVBP table's N-1/N-2 lesson). */
export const PATH_PILLARS: readonly { label: string; t: number }[] = [
  { label: "1D", t: 1 / 365 },
  { label: "3M", t: 0.25 },
  { label: "6M", t: 0.5 },
  { label: "9M", t: 0.75 },
  { label: "1Y", t: 1.0 },
  { label: "1.5Y", t: 1.5 },
  { label: "2Y", t: 2.0 },
  { label: "3Y", t: 3.0 },
  { label: "4Y", t: 4.0 },
  { label: "5Y", t: 5.0 },
  { label: "6Y", t: 6.0 },
  { label: "7Y", t: 7.0 },
  { label: "8Y", t: 8.0 },
  { label: "9Y", t: 9.0 },
  { label: "10Y", t: 10.0 },
] as const;

/** Tenor-bucket label → years for grid columns beyond PATH_PILLARS (e.g. the
 * blotter's 30Y bucket). Mirrors input-curve-preview.tenorToYears plus the
 * backend's parse_tenor_to_years tolerance. */
export function pillarYears(label: string): number | null {
  const hit = PATH_PILLARS.find((p) => p.label === label);
  if (hit) return hit.t;
  const m = /^(\d+(?:\.\d+)?)\s*([DMY])$/i.exec(label.trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  const u = m[2].toUpperCase();
  return u === "Y" ? n : u === "M" ? n / 12 : n / 365;
}

/** Shock-curve family keys as the request's shockCurves carries them. */
export type CurveFamilyKey = "국채" | "특은채" | "은행채" | "카드채" | "회사채" | "swap";

/** Position sector → shock-curve family — mirrors the backend's
 * get_sector_curve_key (services/simulation/daily_valuation.py:16-23);
 * IRS/OIS ride the swap curve. */
export function sectorToFamily(sector: string): CurveFamilyKey {
  const s = sector || "";
  if (s === "IRS" || s === "OIS") return "swap";
  if (s.includes("국고") || s.includes("통안") || s.includes("국채")) return "국채";
  if (s.includes("시은") || s.includes("은행")) return "은행채";
  if (s.includes("특은") || s.includes("공사")) return "특은채";
  if (s.includes("여전") || s.includes("카드")) return "카드채";
  if (s.includes("회사")) return "회사채";
  return "국채";
}

export interface PathEvaluator {
  /** Designed path factor at a day — waypoint lerp / baseShock; the engine's
   * _factor mirror (trivial fallback: calendar ramp / step). */
  factorAt: (day: number) => number;
  /** Cumulative BOK(금통위) bp at a day (0 when the request has no events). */
  bokCumBpAt: (day: number) => number;
  /** Terminal (horizon-end) shock in bp for a family at tenor τ. */
  terminalBp: (family: CurveFamilyKey, tenorYears: number) => number;
  /** The matrix cell: cumulative Δbp of `family` at tenor τ on `day`. */
  cumBpAt: (family: CurveFamilyKey, tenorYears: number, day: number) => number;
  /** True when the request carries 금통위 funding events. */
  hasBokEvents: boolean;
}

const EMPTY_NODES: { t: number; val: number }[] = [];

export function createPathEvaluator(req: SimulateRequest): PathEvaluator {
  const simDays = req.simDays > 0 ? req.simDays : 1;
  const baseShock = req.baseShockBp ?? 0;
  const sorted = [...(req.customPath ?? [])].sort((a, b) => a.day - b.day);

  // BOK staircase — deriveFundingSteps is the ONE staircase source (its
  // shortEndEvents shape adapted from the wire's fundingEvents).
  const steps = deriveFundingSteps(
    (req.fundingEvents ?? []).map((ev, i) => ({ id: i, date: ev.date, shiftBp: String(ev.shiftBp) })),
    req.baseDate,
    simDays,
  );
  const hasBokEvents = steps.length > 0;
  const bokTotal = hasBokEvents ? steps[steps.length - 1].cumBp : 0;

  const factorAt = (day: number): number => {
    if (sorted.length >= 2 && baseShock !== 0) return lerpWaypoints(day, sorted) / baseShock;
    // Engine _factor fallback (chart.py:142-155): calendar ramp / step.
    return req.shockType === "step" ? (day > 0 ? 1 : 0) : day / simDays;
  };

  const bokCumBpAt = (day: number): number => (hasBokEvents ? lookupFunding(day, steps) : 0);

  // Normalized BOK staircase factor — engine _short_factor (chart.py:455-460).
  const shortFactorAt = (day: number): number =>
    hasBokEvents && bokTotal !== 0 ? bokCumBpAt(day) / bokTotal : factorAt(day);

  const familyNodes = (family: CurveFamilyKey): { t: number; val: number }[] => {
    if (family === "swap") return req.shockCurves?.swapCurve ?? EMPTY_NODES;
    return req.shockCurves?.bondCurves?.[family] ?? req.shockCurves?.bondCurves?.["국채"] ?? EMPTY_NODES;
  };

  const terminalBp = (family: CurveFamilyKey, tenorYears: number): number =>
    shockAtTenor(familyNodes(family), tenorYears);

  const cumBpAt = (family: CurveFamilyKey, tenorYears: number, day: number): number => {
    const fac = factorAt(day);
    const terminal = terminalBp(family, tenorYears);
    if (!hasBokEvents) return terminal * fac; // both zone models reduce to this
    if (family === "swap") {
      // Recon-lane model (_cum_shock_r): BOK bp DIRECT at the short end.
      const rampBp = terminal * fac;
      const bok = bokCumBpAt(day);
      if (tenorYears <= 0.25) return bok;
      if (tenorYears < 1.0) {
        const w = (tenorYears - 0.25) / 0.75;
        return bok * (1 - w) + rampBp * w;
      }
      return rampBp;
    }
    // Bond model (calculate_daily_mtm zones): normalized staircase FACTOR.
    const sf = shortFactorAt(day);
    if (tenorYears < 0.25) return sf * terminal;
    if (tenorYears < 1.0) {
      const w = (tenorYears - 0.25) / 0.75;
      return (sf * (1 - w) + fac * w) * terminal;
    }
    return fac * terminal;
  };

  return { factorAt, bokCumBpAt, terminalBp, cumBpAt, hasBokEvents };
}

/** Day sampling for preview surfaces — byte-mirror of buildTimePath's daySet
 * (scenario-preview.ts): ~60 grid steps densified at waypoints and BOK step
 * edges, capped at the last waypoint day. */
export function samplePathDays(req: SimulateRequest): number[] {
  const simDays = req.simDays > 0 ? req.simDays : 1;
  const sorted = [...(req.customPath ?? [])].sort((a, b) => a.day - b.day);
  const maxDay = sorted.length > 0 ? sorted[sorted.length - 1].day : simDays;
  const steps = deriveFundingSteps(
    (req.fundingEvents ?? []).map((ev, i) => ({ id: i, date: ev.date, shiftBp: String(ev.shiftBp) })),
    req.baseDate,
    simDays,
  );
  const daySet = new Set<number>([0]);
  const step = Math.max(1, Math.floor(maxDay / 60));
  for (let d = step; d < maxDay; d += step) daySet.add(d);
  daySet.add(maxDay);
  sorted.forEach((w) => daySet.add(w.day));
  steps.forEach((s) => {
    if (s.day > 0) daySet.add(s.day - 1);
    daySet.add(s.day);
  });
  return [...daySet].filter((d) => d >= 0).sort((a, b) => a - b);
}

export interface PathMatrix {
  days: number[];
  pillars: readonly { label: string; t: number }[];
  /** cumBp[dayIdx][pillarIdx] — cumulative Δbp of `family` at that pillar. */
  cumBp: number[][];
  family: CurveFamilyKey;
}

/** The M2 matrix for one family (default 국채 — "the designed path"). Pass
 * explicit `days` (e.g. the response's business-day axis) or let it use the
 * preview sampling. */
export function buildPathMatrix(
  req: SimulateRequest,
  family: CurveFamilyKey = "국채",
  days: number[] = samplePathDays(req),
): PathMatrix {
  const ev = createPathEvaluator(req);
  return {
    days,
    pillars: PATH_PILLARS,
    cumBp: days.map((d) => PATH_PILLARS.map((p) => ev.cumBpAt(family, p.t, d))),
    family,
  };
}
