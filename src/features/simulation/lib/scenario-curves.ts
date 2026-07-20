/**
 * Class B (shared-pure) — request-assembly logic lifted OUT of the source's
 * ScenarioSimulator component (generateShockCurves + fundingSteps derivation +
 * the /api/simulate payload build) into pure functions, per protocol §1.3
 * ("the request-body assembly moves inside the port … so the screen only sets params").
 *
 * Ported verbatim in behavior from rates-simulator-main/components/ScenarioSimulator.tsx.
 * Pure + deterministic → unit-testable without a DOM (S2/S3 once a runner is chosen).
 */
import type { ShockCurves } from "../types/portfolio";
import type { ScenarioParams, SimulationInputs } from "../types/simulation-port";
import type { SimulateRequest } from "../api/simulate-dto";

type CreditSpreads = { 특은채: number; 은행채: number; 카드채: number; 회사채: number };

/** Source's `toNum`: parse a free-text numeric input, 0 on NaN. */
export const toNum = (s: string): number => {
  const v = parseFloat(s);
  return isNaN(v) ? 0 : v;
};

/**
 * Term-structure shock curves for KTB + credit sectors + swap, from the base 3Y
 * shock, tenor spreads, credit spreads, IRS spread, and the short-end (BOK) shock.
 * Byte-for-byte the source's generateShockCurves.
 */
export function generateShockCurves(
  baseShockBp: number,
  spread1y: number,
  spread10y: number,
  spread30y: number,
  credit: CreditSpreads,
  irsSpread: number,
  shortEndBp: number,
): ShockCurves {
  const shortSpread = shortEndBp - baseShockBp;
  const sixMSpread = shortSpread + ((spread1y - shortSpread) * (0.5 - 0.25)) / (1.0 - 0.25);
  const nodes = [
    { t: 1 / 365, s: shortSpread },
    { t: 0.25, s: shortSpread },
    { t: 0.5, s: sixMSpread },
    { t: 1, s: spread1y },
    { t: 2, s: (spread1y * (3 - 2)) / (3 - 1) },
    { t: 3, s: 0 },
    { t: 5, s: (spread10y * (5 - 3)) / (10 - 3) },
    { t: 7, s: (spread10y * (7 - 3)) / (10 - 3) },
    { t: 10, s: spread10y },
    { t: 20, s: spread10y + (spread30y - spread10y) * 0.5 },
    { t: 30, s: spread30y },
  ];
  const ktb = nodes.map(({ t, s }) => ({ t, val: baseShockBp + s }));
  const bondCurves: ShockCurves["bondCurves"] = {
    국채: ktb,
    특은채: ktb.map((p) => ({ t: p.t, val: p.val + credit.특은채 })),
    은행채: ktb.map((p) => ({ t: p.t, val: p.val + credit.은행채 })),
    카드채: ktb.map((p) => ({ t: p.t, val: p.val + credit.카드채 })),
    회사채: ktb.map((p) => ({ t: p.t, val: p.val + credit.회사채 })),
  };
  const swapCurve = ktb.map((p) => ({ t: p.t, val: p.val + irsSpread }));
  return { bondCurves, swapCurve };
}

/** Cumulative BOK base-rate step path from the 금통위 events. Source `fundingSteps`. */
export function deriveFundingSteps(
  shortEndEvents: ScenarioParams["shortEndEvents"],
  baseDate: string,
  simDays: number,
): { day: number; cumBp: number }[] {
  if (!baseDate) return [];
  const base = new Date(baseDate);
  const events = shortEndEvents
    .filter((ev) => ev.date)
    .map((ev) => ({
      day: Math.round((new Date(ev.date).getTime() - base.getTime()) / 86400000),
      shiftBp: toNum(ev.shiftBp),
    }))
    .filter((ev) => ev.day >= 0 && ev.day <= simDays)
    .sort((a, b) => a.day - b.day);
  if (!events.length) return [];
  const pts: { day: number; cumBp: number }[] = [{ day: 0, cumBp: 0 }];
  let cum = 0;
  for (const ev of events) {
    pts.push({ day: ev.day - 1, cumBp: cum });
    cum += ev.shiftBp;
    pts.push({ day: ev.day, cumBp: cum });
  }
  if (pts[pts.length - 1].day < simDays) pts.push({ day: simDays, cumBp: cum });
  return pts;
}

/** Final short-end (BOK) cumulative shock — last funding step, else 0 (rate unchanged). */
export function shortEndBpFromSteps(fundingSteps: { day: number; cumBp: number }[]): number {
  return fundingSteps.length > 0 ? fundingSteps[fundingSteps.length - 1].cumBp : 0;
}

/**
 * Assemble the full POST /api/simulate request from the port's ambient inputs +
 * user scenario params — the source's runSimulation payload, now pure. This is what
 * the port's runCurrent() calls, so the screen never builds the wire payload itself.
 */
export function buildSimulateRequest(inputs: SimulationInputs, params: ScenarioParams): SimulateRequest {
  const fundingSteps = deriveFundingSteps(params.shortEndEvents, inputs.baseDate, params.simDays);
  const shortEndBp = shortEndBpFromSteps(fundingSteps);

  const credit: CreditSpreads = {
    특은채: toNum(params.creditSpreads["특은채"] ?? "0"),
    은행채: toNum(params.creditSpreads["은행채"] ?? "0"),
    카드채: toNum(params.creditSpreads["카드채"] ?? "0"),
    회사채: toNum(params.creditSpreads["회사채"] ?? "0"),
  };

  const shockCurves = generateShockCurves(
    toNum(params.baseShockBp),
    toNum(params.spread1y),
    toNum(params.spread10y),
    toNum(params.spread30y),
    credit,
    toNum(params.irsSpread),
    shortEndBp,
  );

  return {
    positions: inputs.positions,
    shockCurves,
    dailyShockCurves: inputs.dailyShockCurves ?? { bondCurves: {}, swapCurve: [] },
    // s15: omitted unless explicitly configured — the backend then derives
    // funding from its 기준금리+10bp constant (single source; no stepping).
    ...(inputs.fundingRate !== undefined ? { fundingRate: inputs.fundingRate } : {}),
    fundingEvents: params.shortEndEvents
      .filter((ev) => ev.date)
      .map((ev) => ({ date: ev.date, shiftBp: toNum(ev.shiftBp) })),
    simDays: params.simDays,
    shockType: "ramp",
    shockMode: "matrix",
    baseShockBp: toNum(params.baseShockBp),
    baseDate: inputs.baseDate,
    irsCurves: inputs.irsParRates,
    customPath: params.waypoints,
    sigma_bp: sanitizeSigmaBp(params.sigmaBp),
    // SIM2-5: additive opt-in; false is byte-equivalent to omitting it
    // backend-side (BE default False).
    fundingStepping: params.fundingStepping ?? false,
  };
}

/** σ for the fan chart, sanitized to the backend's (0, 25] contract — an
 * unparseable or out-of-range value falls back to the 2.0 default rather than
 * shipping a payload the backend would 422 (the config input clamps too; this
 * guards store states written by other paths). */
export function sanitizeSigmaBp(raw: string): number {
  const v = toNum(raw);
  return v > 0 && v <= 25 ? v : 2.0;
}
