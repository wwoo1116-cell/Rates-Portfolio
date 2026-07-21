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

/**
 * N1 — anchor-tenor re-expression (option (a), owner-final). The wire stays
 * 3Y-normalized: base_wire = X − s_rel(τa), wp_wire = wpAnchor × base_wire/X.
 * Identity at 3Y is pinned BYTE-level against the committed golden fixture
 * (generated from the PRE-N1 builder at 2c0311f — see n1-golden-config.ts).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { anchorConversionError, tenorSpreadAt, ANCHOR_FLOOR_BP } from "./scenario-curves";
import { N1_GOLDEN_INPUTS, N1_GOLDEN_PARAMS } from "./n1-golden-config";
import { createPathEvaluator } from "./recon/path-matrix";

const GOLDEN = readFileSync(join(__dirname, "__fixtures__", "n1-golden-request.json"), "utf8");

describe("N1 anchor re-expression", () => {
  it("anchor ABSENT: reproduces the pre-N1 golden request byte-for-byte", () => {
    const req = buildSimulateRequest(N1_GOLDEN_INPUTS, N1_GOLDEN_PARAMS);
    expect(JSON.stringify(req, null, 2) + "\n").toBe(GOLDEN);
  });

  it("anchor '3Y' explicit: same bytes, and customPath keeps the exact waypoint objects", () => {
    const params = { ...N1_GOLDEN_PARAMS, anchorTenor: "3Y" as const };
    const req = buildSimulateRequest(N1_GOLDEN_INPUTS, params);
    expect(JSON.stringify(req, null, 2) + "\n").toBe(GOLDEN);
    // Reference identity — the 3Y path is the legacy code path, not a copy.
    expect(req.customPath).toBe(params.waypoints);
  });

  it("anchor 5Y: wire base = X − spread10y×2/7, anchor node lands exactly on X, waypoints rescale", () => {
    const params = { ...N1_GOLDEN_PARAMS, anchorTenor: "5Y" as const }; // X=30, spread10y=12
    const req = buildSimulateRequest(N1_GOLDEN_INPUTS, params);
    const sRel = (12 * 2) / 7;
    expect(req.baseShockBp).toBeCloseTo(30 - sRel, 10);
    expect(at(req.shockCurves.bondCurves.국채, 5)).toBeCloseTo(30, 10);
    const scale = req.baseShockBp / 30;
    expect(req.customPath!.map((w) => w.day)).toEqual([0, 45, 120, 180]);
    expect(req.customPath![1].bp).toBeCloseTo(18 * scale, 10);
    expect(req.customPath![3].bp).toBeCloseTo(30 * scale, 10);
  });

  it("anchor 10Y / 1Y: s_rel is the exact node spread (spread10y / spread1y)", () => {
    const r10 = buildSimulateRequest(N1_GOLDEN_INPUTS, { ...N1_GOLDEN_PARAMS, anchorTenor: "10Y" });
    expect(r10.baseShockBp).toBeCloseTo(30 - 12, 10);
    expect(at(r10.shockCurves.bondCurves.국채, 10)).toBeCloseTo(30, 10);
    const r1 = buildSimulateRequest(N1_GOLDEN_INPUTS, { ...N1_GOLDEN_PARAMS, anchorTenor: "1Y" });
    expect(r1.baseShockBp).toBeCloseTo(30 - -5, 10);
    expect(at(r1.shockCurves.bondCurves.국채, 1)).toBeCloseTo(30, 10);
  });

  it("preserves the ABSOLUTE short-end (BOK) shock under a non-3Y anchor", () => {
    // Golden config carries two -25bp events → shortEndBp -50 regardless of anchor.
    const legacy = buildSimulateRequest(N1_GOLDEN_INPUTS, N1_GOLDEN_PARAMS);
    const anchored = buildSimulateRequest(N1_GOLDEN_INPUTS, { ...N1_GOLDEN_PARAMS, anchorTenor: "10Y" });
    expect(at(anchored.shockCurves.bondCurves.국채, 1 / 365)).toBeCloseTo(
      at(legacy.shockCurves.bondCurves.국채, 1 / 365)!,
      10,
    );
  });

  it("the designed path survives the round trip through the M2 path-matrix evaluator", () => {
    // Design on 5Y: the evaluator over the CONVERTED wire request must return
    // the drawn waypoint values on the 국채 5Y pillar — the F2/M2 machinery
    // needs no re-derivation (it consumes the same request).
    const req = buildSimulateRequest(N1_GOLDEN_INPUTS, { ...N1_GOLDEN_PARAMS, anchorTenor: "5Y" });
    const ev = createPathEvaluator(req);
    expect(ev.cumBpAt("국채", 5, 45)).toBeCloseTo(18, 6);
    expect(ev.cumBpAt("국채", 5, 120)).toBeCloseTo(22, 6);
    expect(ev.cumBpAt("국채", 5, 180)).toBeCloseTo(30, 6);
  });

  it("NaN-guard: a transient X=0 non-3Y state builds finite numbers (preview safety)", () => {
    const req = buildSimulateRequest(N1_GOLDEN_INPUTS, {
      ...N1_GOLDEN_PARAMS,
      anchorTenor: "5Y",
      baseShockBp: "0",
    });
    expect(Number.isFinite(req.baseShockBp)).toBe(true);
    for (const w of req.customPath!) expect(Number.isFinite(w.bp)).toBe(true);
  });
});

describe("N1 degeneracy floor (anchorConversionError)", () => {
  it("never blocks anchor 3Y — including the pre-existing X==0 legacy state", () => {
    expect(anchorConversionError(N1_GOLDEN_PARAMS)).toBeNull();
    expect(anchorConversionError({ ...N1_GOLDEN_PARAMS, anchorTenor: "3Y", baseShockBp: "0" })).toBeNull();
  });

  it("blocks X==0 under a non-3Y anchor with the honest cause", () => {
    const err = anchorConversionError({ ...N1_GOLDEN_PARAMS, anchorTenor: "5Y", baseShockBp: "0" });
    expect(err).toMatch(/목표 변동 0bp/);
    expect(err).toMatch(/5Y/);
  });

  it("blocks |base_wire| < 0.5bp (target ≈ tenor spread) and names the numbers", () => {
    // anchor 10Y, spread10y 12 → X=12 cancels exactly; X=12.4 → 0.4bp; X=12.6 → 0.6bp passes.
    const p = (baseShockBp: string) =>
      anchorConversionError({ ...N1_GOLDEN_PARAMS, anchorTenor: "10Y" as const, baseShockBp });
    expect(p("12")).toMatch(/상쇄/);
    expect(p("12.4")).toMatch(new RegExp(`${ANCHOR_FLOOR_BP}bp`));
    expect(p("12.6")).toBeNull();
  });

  it("tenorSpreadAt matches the generateShockCurves node formula", () => {
    expect(tenorSpreadAt("3Y", -5, 12)).toBe(0);
    expect(tenorSpreadAt("1Y", -5, 12)).toBe(-5);
    expect(tenorSpreadAt("5Y", -5, 12)).toBeCloseTo((12 * 2) / 7, 12);
    expect(tenorSpreadAt("10Y", -5, 12)).toBe(12);
  });
});
