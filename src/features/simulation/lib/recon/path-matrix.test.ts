/**
 * RECON-SCEN — path-matrix pins:
 *  - PATH_PILLARS is the full engine KRD pillar set (15, no abbreviation);
 *  - factorAt mirrors the engine _factor (waypoint calendar lerp; trivial
 *    ramp/step fallback);
 *  - without 금통위 events every family/zone reduces to factor × terminal;
 *  - with events: swap short end = BOK bp DIRECT (recon-lane model), bond
 *    short end = normalized staircase FACTOR × terminal (bond-lane model);
 *  - family identity (F2 pin): for τ ≥ 1Y a family row equals the base(국채)
 *    row + factor × its constant spread — derived via the request's own
 *    generateShockCurves nodes, never re-derived math;
 *  - samplePathDays byte-mirrors buildTimePath's day axis.
 */
import { describe, expect, it } from "vitest";

import type { SimulateRequest } from "../../api/simulate-dto";
import { buildSimulateRequest, generateShockCurves } from "../scenario-curves";
import { buildTimePath } from "../scenario-preview";
import { DEFAULT_SCENARIO_PARAMS, EMPTY_SIMULATION_INPUTS } from "../../types/simulation-port";
import {
  PATH_PILLARS,
  buildPathMatrix,
  createPathEvaluator,
  pillarYears,
  samplePathDays,
  sectorToFamily,
} from "./path-matrix";
import { loadFixture } from "./fixtures";

const KRD_NAMES = [
  "1D", "3M", "6M", "9M", "1Y", "1.5Y", "2Y", "3Y",
  "4Y", "5Y", "6Y", "7Y", "8Y", "9Y", "10Y",
];

function req(overrides: Partial<SimulateRequest>): SimulateRequest {
  return {
    positions: [],
    shockCurves: generateShockCurves(30, 0, 0, 0, { 특은채: 0, 은행채: 0, 카드채: 0, 회사채: 0 }, 0, 0),
    dailyShockCurves: { bondCurves: {}, swapCurve: [] },
    fundingEvents: [],
    simDays: 180,
    shockType: "ramp",
    shockMode: "matrix",
    baseShockBp: 30,
    baseDate: "2026-07-16",
    irsCurves: [],
    customPath: [
      { day: 0, bp: 0 },
      { day: 180, bp: 30 },
    ],
    ...overrides,
  };
}

describe("PATH_PILLARS / mappings", () => {
  it("is the full engine KRD pillar set — quant_engine.KRD_NAMES, every column", () => {
    expect(PATH_PILLARS.map((p) => p.label)).toEqual(KRD_NAMES);
  });

  it("pillarYears parses grid buckets beyond the pillar set (30Y)", () => {
    expect(pillarYears("30Y")).toBe(30);
    expect(pillarYears("1.5Y")).toBe(1.5);
    expect(pillarYears("합계")).toBeNull();
  });

  it("sectorToFamily mirrors get_sector_curve_key (+ swap for IRS/OIS)", () => {
    expect(sectorToFamily("국고채")).toBe("국채");
    expect(sectorToFamily("통안채")).toBe("국채");
    expect(sectorToFamily("시은채")).toBe("은행채");
    expect(sectorToFamily("특은채")).toBe("특은채");
    expect(sectorToFamily("공사채")).toBe("특은채");
    expect(sectorToFamily("여전채")).toBe("카드채");
    expect(sectorToFamily("회사채")).toBe("회사채");
    expect(sectorToFamily("IRS")).toBe("swap");
    expect(sectorToFamily("OIS")).toBe("swap");
  });
});

describe("factorAt (engine _factor mirror)", () => {
  it("waypoint calendar lerp / baseShock — linear fixture midpoint", () => {
    const { request } = loadFixture("linear");
    const ev = createPathEvaluator(request);
    // waypoints {0,0},{22,2.5},{45,5}: day 11 → 1.25bp → factor 0.25.
    expect(ev.factorAt(11)).toBeCloseTo(1.25 / 5, 12);
    expect(ev.factorAt(22)).toBeCloseTo(0.5, 12);
    expect(ev.factorAt(45)).toBe(1);
    expect(ev.factorAt(60)).toBe(1); // clamped past the last waypoint
  });

  it("trivial fallbacks: calendar ramp / step when no usable waypoints", () => {
    const ramp = createPathEvaluator(req({ customPath: [], simDays: 100 }));
    expect(ramp.factorAt(25)).toBeCloseTo(0.25, 12);
    const step = createPathEvaluator(req({ customPath: [], shockType: "step" }));
    expect(step.factorAt(0)).toBe(0);
    expect(step.factorAt(1)).toBe(1);
  });
});

describe("cumBpAt", () => {
  it("without 금통위 events: factor × terminal for every family and zone", () => {
    const { request } = loadFixture("shaped");
    const ev = createPathEvaluator(request);
    for (const family of ["국채", "회사채", "swap"] as const) {
      for (const { t } of PATH_PILLARS) {
        expect(ev.cumBpAt(family, t, 22)).toBeCloseTo(ev.terminalBp(family, t) * ev.factorAt(22), 10);
      }
    }
  });

  it("family identity (F2 pin): family row = base row + factor × constant spread for τ ≥ 1Y", () => {
    const { request } = loadFixture("shaped"); // 회사채 credit spread 4bp, IRS spread 3bp
    const ev = createPathEvaluator(request);
    for (const day of [5, 22, 34, 45]) {
      const fac = ev.factorAt(day);
      for (const t of [1, 3, 5, 10]) {
        expect(ev.cumBpAt("회사채", t, day) - ev.cumBpAt("국채", t, day)).toBeCloseTo(4 * fac, 10);
        expect(ev.cumBpAt("swap", t, day) - ev.cumBpAt("국채", t, day)).toBeCloseTo(3 * fac, 10);
      }
    }
  });

  it("금통위 staircase: swap short end = BOK bp DIRECT; bond short end = normalized factor × terminal", () => {
    const r = req({
      simDays: 90,
      customPath: [
        { day: 0, bp: 0 },
        { day: 90, bp: 30 },
      ],
      fundingEvents: [
        { date: "2026-08-01", shiftBp: -25 }, // day 16
        { date: "2026-09-01", shiftBp: -25 }, // day 47
      ],
      shockCurves: generateShockCurves(30, 0, 0, 0, { 특은채: 0, 은행채: 0, 카드채: 0, 회사채: 0 }, 0, -50),
    });
    const ev = createPathEvaluator(r);
    expect(ev.hasBokEvents).toBe(true);
    // Between the events (day 30): one −25bp step realized.
    expect(ev.bokCumBpAt(30)).toBe(-25);
    // Swap 3M pillar: the BOK cumulative DIRECT (recon _cum_shock_r).
    expect(ev.cumBpAt("swap", 0.25, 30)).toBe(-25);
    // Bond 1D pillar: normalized staircase factor (−25/−50) × terminal(1D).
    const terminal1d = ev.terminalBp("국채", 1 / 365); // = shortEnd = −50
    expect(terminal1d).toBeCloseTo(-50, 10);
    expect(ev.cumBpAt("국채", 1 / 365, 30)).toBeCloseTo(0.5 * -50, 10);
    // ≥1Y stays on the designed factor for both.
    expect(ev.cumBpAt("swap", 3, 30)).toBeCloseTo(ev.terminalBp("swap", 3) * ev.factorAt(30), 10);
    expect(ev.cumBpAt("국채", 3, 30)).toBeCloseTo(ev.terminalBp("국채", 3) * ev.factorAt(30), 10);
  });
});

describe("samplePathDays / buildPathMatrix", () => {
  it("byte-mirrors buildTimePath's day axis for the default params", () => {
    const request = buildSimulateRequest(
      { ...EMPTY_SIMULATION_INPUTS, baseDate: "2026-07-16" },
      DEFAULT_SCENARIO_PARAMS,
    );
    const days = samplePathDays(request);
    const expected = buildTimePath(DEFAULT_SCENARIO_PARAMS, "2026-07-16").map((p) => p.day);
    expect(days).toEqual(expected);
  });

  it("국채 3Y matrix row equals the designed waypoint path (the anchor identity)", () => {
    const { request } = loadFixture("linear");
    const m = buildPathMatrix(request, "국채", [0, 11, 22, 45]);
    const i3y = m.pillars.findIndex((p) => p.label === "3Y");
    // terminal(국채, 3Y) node is s=0 → row == lerped bp path itself.
    expect(m.cumBp.map((r) => Number(r[i3y].toFixed(6)))).toEqual([0, 1.25, 2.5, 5]);
  });
});
