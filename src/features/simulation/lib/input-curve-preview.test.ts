/**
 * FB4 T2 — scenario-overlay pins (pure lib):
 *  - NO FORKED MATH: every overlay value equals base + cumBpAt(family,τ,D)/100
 *    from lib/recon/path-matrix's request evaluator — asserted numerically
 *    across families, pillars and time slices (incl. a shaped mid-slice);
 *  - terminal equivalence: at D = simDays the overlay reproduces the OLD
 *    two-line preview (buildInputCurvePreview) byte-for-byte for 국고/IRS —
 *    the pre-FB4 커브형 was the horizon-end special case of the new view;
 *  - isShapedScenario: linear default → false (one overlay), off-line
 *    waypoint or 금통위 events → true (scrubber);
 *  - blank policy: undefined (family doesn't carry the pillar) and null
 *    (carried, no quote) pass through to BOTH base and ghost.
 */
import { describe, expect, it } from "vitest";

import {
  buildInputCurvePreview,
  buildScenarioOverlay,
  isShapedScenario,
  type BaseQuote,
} from "./input-curve-preview";
import { buildSimulateRequest } from "./scenario-curves";
import { createPathEvaluator, sectorToFamily } from "./recon/path-matrix";
import { DEFAULT_SCENARIO_PARAMS, EMPTY_SIMULATION_INPUTS } from "../types/simulation-port";

const INPUTS = { ...EMPTY_SIMULATION_INPUTS, baseDate: "2026-07-15" };

const GOV: BaseQuote[] = [
  { t: 0.25, label: "3M", rate: 0.0252 },
  { t: 1, label: "1Y", rate: 0.026 },
  { t: 3, label: "3Y", rate: 0.0272 },
  { t: 10, label: "10Y", rate: 0.0295 },
  { t: 20, label: "20Y", rate: null }, // carried, no quote → null through
];
const IRS: BaseQuote[] = [
  { t: 0.25, label: "3M", rate: 0.026 },
  { t: 1, label: "1Y", rate: 0.0265 },
  { t: 3, label: "3Y", rate: 0.0278 },
  { t: 10, label: "10Y", rate: 0.0301 },
];
const CARD: BaseQuote[] = [
  { t: 1, label: "1Y", rate: 0.031 },
  { t: 3, label: "3Y", rate: 0.033 },
];

const SHAPED_PARAMS = {
  ...DEFAULT_SCENARIO_PARAMS,
  simDays: 90,
  baseShockBp: "30",
  waypoints: [
    { day: 0, bp: 0 },
    { day: 45, bp: 25 }, // off the 15bp line → shaped
    { day: 90, bp: 30 },
  ],
  spread10y: "8",
  creditSpreads: { ...DEFAULT_SCENARIO_PARAMS.creditSpreads, 카드채: "12" },
  irsSpread: "3",
};

describe("isShapedScenario", () => {
  it("linear default ramp → false; off-line waypoint → true; 금통위 events → true", () => {
    expect(isShapedScenario(buildSimulateRequest(INPUTS, DEFAULT_SCENARIO_PARAMS))).toBe(false);
    expect(isShapedScenario(buildSimulateRequest(INPUTS, SHAPED_PARAMS))).toBe(true);
    expect(
      isShapedScenario(
        buildSimulateRequest(INPUTS, {
          ...DEFAULT_SCENARIO_PARAMS,
          shortEndEvents: [{ id: 0, date: "2026-08-20", shiftBp: "-25" }],
        }),
      ),
    ).toBe(true);
  });
});

describe("buildScenarioOverlay (FB4 T2)", () => {
  const families = [
    { key: "국고채", quotes: GOV },
    { key: "IRS", quotes: IRS },
    { key: "여전채", quotes: CARD },
  ];

  it("NO FORKED MATH: every ghost value == base + evaluator.cumBpAt/100, incl. a shaped mid-slice", () => {
    const req = buildSimulateRequest(INPUTS, SHAPED_PARAMS);
    const ev = createPathEvaluator(req);
    for (const day of [0, 45, 60, 90]) {
      const out = buildScenarioOverlay(req, day, families);
      for (const s of out.series) {
        const fam = sectorToFamily(s.key);
        out.pillars.forEach((p, i) => {
          const base = s.basePct[i];
          const ghost = s.shockedPct[i];
          if (base === undefined || base === null) {
            expect(ghost).toBe(base); // blank policy passes through
            return;
          }
          expect(ghost).toBeCloseTo(base + ev.cumBpAt(fam, p.t, day) / 100, 12);
        });
      }
    }
  });

  it("terminal equivalence: at D=simDays the 국고/IRS ghosts reproduce the OLD preview exactly", () => {
    const req = buildSimulateRequest(INPUTS, SHAPED_PARAMS);
    const out = buildScenarioOverlay(req, SHAPED_PARAMS.simDays, [
      { key: "국고채", quotes: GOV },
      { key: "IRS", quotes: IRS },
    ]);
    const old = buildInputCurvePreview(SHAPED_PARAMS, INPUTS.baseDate, GOV, IRS);
    expect(out.pillars).toEqual(old.pillars);
    const gov = out.series.find((s) => s.key === "국고채")!;
    const irs = out.series.find((s) => s.key === "IRS")!;
    old.bondPct.forEach((v, i) => {
      if (v === undefined || v === null) expect(gov.shockedPct[i]).toBe(v);
      else expect(gov.shockedPct[i]).toBeCloseTo(v, 9);
    });
    old.swapPct.forEach((v, i) => {
      if (v === undefined || v === null) expect(irs.shockedPct[i]).toBe(v);
      else expect(irs.shockedPct[i]).toBeCloseTo(v, 9);
    });
  });

  it("family curve mapping is the engine's own: 여전채 ghost carries the 카드채 credit spread", () => {
    const req = buildSimulateRequest(INPUTS, SHAPED_PARAMS);
    const out = buildScenarioOverlay(req, SHAPED_PARAMS.simDays, families);
    const card = out.series.find((s) => s.key === "여전채")!;
    const gov = out.series.find((s) => s.key === "국고채")!;
    const i3y = out.pillars.findIndex((p) => p.t === 3);
    // Both carry 3Y: the ghosts' SHOCK components differ by exactly the
    // 카드채 credit spread (12bp) at the terminal factor 1.
    const cardShock = (card.shockedPct[i3y]! - card.basePct[i3y]!) * 100;
    const govShock = (gov.shockedPct[i3y]! - gov.basePct[i3y]!) * 100;
    expect(cardShock - govShock).toBeCloseTo(12, 9);
  });

  it("pillar axis is the union across selected families; a family's absent pillar is undefined on BOTH lanes", () => {
    const req = buildSimulateRequest(INPUTS, DEFAULT_SCENARIO_PARAMS);
    const out = buildScenarioOverlay(req, 180, families);
    expect(out.pillars.map((p) => p.label)).toEqual(["3M", "1Y", "3Y", "10Y", "20Y"]);
    const card = out.series.find((s) => s.key === "여전채")!;
    const i3m = 0;
    expect(card.basePct[i3m]).toBeUndefined();
    expect(card.shockedPct[i3m]).toBeUndefined();
    const gov = out.series.find((s) => s.key === "국고채")!;
    const i20y = 4;
    expect(gov.basePct[i20y]).toBeNull(); // carried, no quote
    expect(gov.shockedPct[i20y]).toBeNull();
  });
});
