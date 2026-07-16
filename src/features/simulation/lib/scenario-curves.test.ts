import { describe, expect, it } from "vitest";

import { DEFAULT_SCENARIO_PARAMS, EMPTY_SIMULATION_INPUTS } from "../types/simulation-port";
import {
  buildSimulateRequest,
  deriveFundingSteps,
  generateShockCurves,
  shortEndBpFromSteps,
  toNum,
} from "./scenario-curves";

const NO_CREDIT = { 특은채: 0, 은행채: 0, 카드채: 0, 회사채: 0 };
const at = (curve: { t: number; val: number }[], t: number) => curve.find((p) => p.t === t)?.val;

describe("toNum", () => {
  it("parses numerics and defaults NaN/empty to 0", () => {
    expect(toNum("3.5")).toBe(3.5);
    expect(toNum("-25")).toBe(-25);
    expect(toNum("")).toBe(0);
    expect(toNum("abc")).toBe(0);
  });
});

describe("generateShockCurves", () => {
  it("builds the five bond sectors + swap curve with 11 tenor nodes", () => {
    const { bondCurves, swapCurve } = generateShockCurves(30, 0, 0, 0, NO_CREDIT, 0, 0);
    expect(Object.keys(bondCurves)).toEqual(["국채", "특은채", "은행채", "카드채", "회사채"]);
    expect(bondCurves.국채).toHaveLength(11);
    expect(swapCurve).toHaveLength(11);
  });

  it("anchors the 3Y node at the base shock and interpolates the short end from BOK", () => {
    // base 30bp, shortEndBp 0 -> shortSpread -30; 3Y anchored at base, 3M pulled to 0, 6M blended.
    const { bondCurves } = generateShockCurves(30, 0, 0, 0, NO_CREDIT, 0, 0);
    expect(at(bondCurves.국채, 3)).toBe(30);
    expect(at(bondCurves.국채, 0.25)).toBe(0);
    expect(at(bondCurves.국채, 0.5)).toBeCloseTo(10, 6);
    expect(at(bondCurves.국채, 1)).toBe(30);
  });

  it("adds credit spreads on top of the KTB curve and IRS spread on the swap curve", () => {
    const { bondCurves, swapCurve } = generateShockCurves(
      30, 0, 0, 0, { ...NO_CREDIT, 특은채: 7 }, 5, 0,
    );
    expect(at(bondCurves.특은채, 3)).toBe(37); // 국채(30) + credit 7
    expect(at(swapCurve, 3)).toBe(35); // 국채(30) + IRS 5
  });
});

describe("deriveFundingSteps / shortEndBpFromSteps", () => {
  it("returns no steps when there are no dated events", () => {
    expect(deriveFundingSteps([], "2026-01-01", 180)).toEqual([]);
    expect(shortEndBpFromSteps([])).toBe(0);
  });

  it("builds a cumulative step path and the final short-end shock", () => {
    const steps = deriveFundingSteps(
      [{ id: 0, date: "2026-01-31", shiftBp: "-25" }],
      "2026-01-01",
      180,
    );
    expect(steps[0]).toEqual({ day: 0, cumBp: 0 });
    expect(steps.at(-1)).toEqual({ day: 180, cumBp: -25 });
    expect(shortEndBpFromSteps(steps)).toBe(-25);
  });
});

describe("buildSimulateRequest", () => {
  it("assembles a valid /api/simulate payload from inputs + params", () => {
    const inputs = { ...EMPTY_SIMULATION_INPUTS, baseDate: "2026-01-01" };
    const req = buildSimulateRequest(inputs, DEFAULT_SCENARIO_PARAMS);

    expect(req.shockType).toBe("ramp");
    expect(req.shockMode).toBe("matrix");
    expect(req.simDays).toBe(180);
    expect(req.baseShockBp).toBe(30); // string "30" -> number
    expect(req.baseDate).toBe("2026-01-01");
    expect(req.customPath).toBe(DEFAULT_SCENARIO_PARAMS.waypoints);
    expect(req.fundingEvents).toEqual([]); // no dated events
    expect(req.shockCurves.bondCurves.국채).toHaveLength(11);
    expect(req.sigma_bp).toBe(2.0); // s13 default — backend-identical to omitting it
  });

  it("OMITS fundingRate by default (s15 T1: backend derives 기준금리+10bp)", () => {
    const req = buildSimulateRequest(
      { ...EMPTY_SIMULATION_INPUTS, baseDate: "2026-01-01" },
      DEFAULT_SCENARIO_PARAMS,
    );
    // The key must be genuinely absent, not undefined/null — the wire payload
    // decides which funding semantics the backend applies.
    expect("fundingRate" in req).toBe(false);
  });

  it("still passes an explicit fundingRate through (legacy payloads)", () => {
    const req = buildSimulateRequest(
      { ...EMPTY_SIMULATION_INPUTS, baseDate: "2026-01-01", fundingRate: 0.042 },
      DEFAULT_SCENARIO_PARAMS,
    );
    expect(req.fundingRate).toBe(0.042);
  });

  it("converts dated 금통위 events into fundingEvents", () => {
    const req = buildSimulateRequest(
      { ...EMPTY_SIMULATION_INPUTS, baseDate: "2026-01-01" },
      { ...DEFAULT_SCENARIO_PARAMS, shortEndEvents: [{ id: 1, date: "2026-02-01", shiftBp: "-25" }] },
    );
    expect(req.fundingEvents).toEqual([{ date: "2026-02-01", shiftBp: -25 }]);
  });

  it("carries the user σ and sanitizes junk to the 2.0 default (s13)", () => {
    const inputs = { ...EMPTY_SIMULATION_INPUTS, baseDate: "2026-01-01" };
    const at = (sigmaBp: string) =>
      buildSimulateRequest(inputs, { ...DEFAULT_SCENARIO_PARAMS, sigmaBp }).sigma_bp;

    expect(at("4")).toBe(4);
    expect(at("0.5")).toBe(0.5);
    expect(at("25")).toBe(25);
    // out-of-contract store states must not ship a 422-able payload
    expect(at("0")).toBe(2.0);
    expect(at("-3")).toBe(2.0);
    expect(at("26")).toBe(2.0);
    expect(at("abc")).toBe(2.0);
  });
});
