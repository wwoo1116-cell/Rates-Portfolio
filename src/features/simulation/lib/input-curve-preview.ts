/**
 * Class B (shared-pure) — demo-sprint input-curve preview math. Turns the base
 * market quotes for a valuation date (bond par yields per tenor + IRS par
 * quotes) into the SHOCKED term-structure the two-pane Simulation preview
 * draws: base quote + the scenario's horizon-end shock, interpolated at each
 * quote tenor from the same generateShockCurves nodes the /api/simulate
 * payload carries. Pure display math — no bootstrap, no engine call; the
 * engine's own bootstrapping is untouched.
 *
 * Blank-quote policy: a missing quote stays `null` end-to-end (rendered as a
 * gap / "—"), never a silent +0.
 */
import type { ScenarioParams } from "../types/simulation-port";
import type { SimulateRequest } from "../api/simulate-dto";
import {
  deriveFundingSteps,
  generateShockCurves,
  shortEndBpFromSteps,
  toNum,
} from "./scenario-curves";
import { createPathEvaluator, sectorToFamily } from "./recon/path-matrix";

/** One term-structure pillar: tenor in years + its display label. */
export interface CurvePillar {
  t: number;
  label: string;
}

/** "3M" → 0.25, "1Y" → 1, "91D" → 91/365. Unknown formats → null. */
export function tenorToYears(tenor: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*([DMY])$/i.exec(tenor.trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  if (unit === "Y") return n;
  if (unit === "M") return n / 12;
  return n / 365;
}

/** 0.25 → "3M", 0.5 → "6M", 1 → "1Y", 1.5 → "18M". */
export function yearsToTenorLabel(t: number): string {
  if (t >= 1 && Number.isInteger(t)) return `${t}Y`;
  const months = Math.round(t * 12);
  if (Math.abs(t * 12 - months) < 1e-6 && months > 0) return `${months}M`;
  return `${Math.round(t * 365)}D`;
}

/** Linear interpolation of the shock node curve (bp) at tenor t, clamped to
 * the end nodes. Nodes are the ascending output of generateShockCurves. */
export function shockAtTenor(nodes: { t: number; val: number }[], t: number): number {
  if (!nodes.length) return 0;
  if (t <= nodes[0].t) return nodes[0].val;
  if (t >= nodes[nodes.length - 1].t) return nodes[nodes.length - 1].val;
  for (let i = 0; i < nodes.length - 1; i++) {
    if (t >= nodes[i].t && t <= nodes[i + 1].t) {
      const r = (t - nodes[i].t) / (nodes[i + 1].t - nodes[i].t);
      return nodes[i].val + r * (nodes[i + 1].val - nodes[i].val);
    }
  }
  return 0;
}

/** Base quote for one pillar: DECIMAL rate (0.0282) or null when missing. */
export interface BaseQuote {
  t: number;
  label: string;
  rate: number | null;
}

export interface InputCurvePreview {
  /** Union of both curves' pillars, ascending — the shared x-axis. */
  pillars: CurvePillar[];
  /** Shocked rates in %, aligned to `pillars`. undefined = this source does
   * not carry the pillar (the line connects through); null = carried but no
   * value on the date (a gap + "—", blank policy). */
  bondPct: (number | null | undefined)[];
  swapPct: (number | null | undefined)[];
  /** Final short-end (BOK) cumulative shock actually applied, in bp. */
  shortEndBp: number;
}

/**
 * FB4 T2 — is the designed scenario SHAPED in time (a D+n scrubber is
 * meaningful) or effectively parallel-in-time (one terminal overlay)? Shaped
 * = the customPath deviates from the exact linear ramp (the engine's SIM2-4
 * activation predicate, mirrored) OR 금통위 events step the short end.
 */
export function isShapedScenario(req: SimulateRequest): boolean {
  const base = req.baseShockBp ?? 0;
  const shapedPath =
    !!req.customPath &&
    req.customPath.length >= 2 &&
    base !== 0 &&
    req.customPath.some((p) => Math.abs(p.bp - (base * p.day) / req.simDays) > 1e-9);
  return shapedPath || (req.fundingEvents ?? []).length > 0;
}

/** One family lane of the FB4 커브형 preview: the SOLID base curve and the
 * DASHED scenario overlay, both % values aligned to the shared pillar axis
 * (undefined = family doesn't carry the pillar; null = carried, no quote —
 * the established blank policy). */
export interface FamilyPreviewSeries {
  /** Chip key (sector vocabulary: 국고채/통안채/IRS/회사채/여전채). */
  key: string;
  basePct: (number | null | undefined)[];
  shockedPct: (number | null | undefined)[];
}

export interface ScenarioOverlayPreview {
  pillars: CurvePillar[];
  series: FamilyPreviewSeries[];
}

/**
 * FB4 T2 — base curves × families with the scenario overlay at time slice
 * D+`day`. The overlay is a VIEW over the SAME machinery the request uses:
 * per pillar, shocked% = base% + cumBpAt(family, τ, day)/100 where cumBpAt is
 * lib/recon/path-matrix's request evaluator — waypoint lerp, BOK staircase
 * and short-end stitching included, NO math re-derived here (reuse-guard
 * pinned). At day = simDays on a linear path this reduces exactly to the
 * horizon-end shock the old two-line preview drew.
 *
 * Family → shock curve mapping is the engine's own (sectorToFamily /
 * get_sector_curve_key): 국고채·통안채 ride the 국채 curve, 여전채 the 카드채
 * curve, IRS the swap curve — each family's BASE quotes stay its own.
 */
export function buildScenarioOverlay(
  req: SimulateRequest,
  day: number,
  families: Array<{ key: string; quotes: BaseQuote[] }>,
): ScenarioOverlayPreview {
  const ev = createPathEvaluator(req);

  const byT = new Map<number, CurvePillar>();
  for (const f of families) {
    for (const q of f.quotes) {
      if (!byT.has(q.t)) byT.set(q.t, { t: q.t, label: q.label });
    }
  }
  const pillars = [...byT.values()].sort((a, b) => a.t - b.t);

  const series: FamilyPreviewSeries[] = families.map((f) => {
    const rateByT = new Map(f.quotes.map((q) => [q.t, q.rate]));
    const curveFamily = sectorToFamily(f.key);
    const basePct: (number | null | undefined)[] = [];
    const shockedPct: (number | null | undefined)[] = [];
    for (const { t } of pillars) {
      if (!rateByT.has(t)) {
        basePct.push(undefined);
        shockedPct.push(undefined);
        continue;
      }
      const rate = rateByT.get(t);
      if (rate === null || rate === undefined) {
        basePct.push(null);
        shockedPct.push(null);
        continue;
      }
      const base = rate * 100;
      basePct.push(base);
      shockedPct.push(base + ev.cumBpAt(curveFamily, t, day) / 100);
    }
    return { key: f.key, basePct, shockedPct };
  });

  return { pillars, series };
}

/**
 * Assemble the preview: per-pillar shocked % = base×100 + shockBp(t)/100.
 * The shock is the horizon-end scenario shock — the same 국채/swap node curves
 * buildSimulateRequest ships (KTB nodes for the bond curve, +IRS spread for
 * the swap curve).
 */
export function buildInputCurvePreview(
  params: ScenarioParams,
  baseDate: string,
  bondBase: BaseQuote[],
  swapBase: BaseQuote[],
): InputCurvePreview {
  const fundingSteps = deriveFundingSteps(params.shortEndEvents, baseDate, params.simDays);
  const shortEndBp = shortEndBpFromSteps(fundingSteps);
  const shock = generateShockCurves(
    toNum(params.baseShockBp),
    toNum(params.spread1y),
    toNum(params.spread10y),
    toNum(params.spread30y),
    {
      특은채: toNum(params.creditSpreads["특은채"] ?? "0"),
      은행채: toNum(params.creditSpreads["은행채"] ?? "0"),
      카드채: toNum(params.creditSpreads["카드채"] ?? "0"),
      회사채: toNum(params.creditSpreads["회사채"] ?? "0"),
    },
    toNum(params.irsSpread),
    shortEndBp,
  );

  const byT = new Map<number, CurvePillar>();
  for (const q of [...bondBase, ...swapBase]) {
    if (!byT.has(q.t)) byT.set(q.t, { t: q.t, label: q.label });
  }
  const pillars = [...byT.values()].sort((a, b) => a.t - b.t);

  const shocked = (
    base: BaseQuote[],
    nodes: { t: number; val: number }[],
  ): (number | null | undefined)[] => {
    const rateByT = new Map(base.map((q) => [q.t, q.rate]));
    return pillars.map(({ t }) => {
      if (!rateByT.has(t)) return undefined; // pillar from the other curve
      const rate = rateByT.get(t);
      if (rate === null || rate === undefined) return null; // carried, no value
      return rate * 100 + shockAtTenor(nodes, t) / 100;
    });
  };

  return {
    pillars,
    bondPct: shocked(bondBase, shock.bondCurves.국채),
    swapPct: shocked(swapBase, shock.swapCurve),
    shortEndBp,
  };
}
