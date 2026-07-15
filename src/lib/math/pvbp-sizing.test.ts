/**
 * Pins the PVBP sizing convention (B4).
 *
 * The central claim is that nᵢ = c·wᵢ/pᵢ makes net PVBP = c·Σwᵢ, so the package
 * is neutral exactly when the weights cancel — and that this works unchanged
 * for a 2-leg spread and a 3-leg fly. Holding nᵢ ∝ wᵢ instead would force
 * every size to zero, so these tests are what stop that convention from being
 * "simplified" back into the broken one.
 */
import { describe, expect, it } from "vitest";

import {
  approxModifiedDuration,
  parseTenorYears,
  pvbpPerUnitNotional,
  sizeManual,
  sizePvbpNeutral,
  spreadPnlPath,
  type SizingLeg,
} from "./pvbp-sizing";

describe("parseTenorYears", () => {
  it.each([
    ["3Y", 3],
    ["10Y", 10],
    ["1.5Y", 1.5],
    ["3M", 0.25],
    ["18M", 1.5],
  ])("%s -> %s", (tenor, years) => {
    expect(parseTenorYears(tenor)).toBeCloseTo(years, 12);
  });

  it("returns null for junk rather than NaN-poisoning the sizing", () => {
    expect(parseTenorYears("")).toBeNull();
    expect(parseTenorYears("BOK")).toBeNull();
    expect(parseTenorYears("0Y")).toBeNull();
  });
});

describe("approxModifiedDuration", () => {
  it("matches the textbook par-bond value", () => {
    // 10Y par bond at 4%: (1 − 1.04^−10)/0.04 = 8.1109
    expect(approxModifiedDuration(10, 0.04)).toBeCloseTo(8.1109, 4);
  });

  it("tends to T as the yield approaches zero (0/0 limit)", () => {
    // Naively evaluating (1 − (1+y)^−T)/y at y=0 is NaN.
    expect(approxModifiedDuration(5, 0)).toBeCloseTo(5, 12);
    expect(approxModifiedDuration(5, 1e-9)).toBeCloseTo(5, 6);
  });

  it("is shorter than the tenor for a positive yield", () => {
    expect(approxModifiedDuration(10, 0.04)).toBeLessThan(10);
  });
});

/** Legs whose PVBPs deliberately differ, so ∝wᵢ and ∝wᵢ/pᵢ can't coincide. */
function fly(): SizingLeg[] {
  return [
    { label: "3Y", weight: 1, pvbpUnit: pvbpPerUnitNotional(3, 0.03) },
    { label: "5Y", weight: -2, pvbpUnit: pvbpPerUnitNotional(5, 0.035) },
    { label: "10Y", weight: 1, pvbpUnit: pvbpPerUnitNotional(10, 0.04) },
  ];
}

function twoLeg(): SizingLeg[] {
  return [
    { label: "5Y", weight: 1, pvbpUnit: pvbpPerUnitNotional(5, 0.035) },
    { label: "3Y", weight: -1, pvbpUnit: pvbpPerUnitNotional(3, 0.03) },
  ];
}

describe("sizePvbpNeutral — 2-leg", () => {
  it("zeroes net PVBP and shorts the negative-weight leg", () => {
    const res = sizePvbpNeutral(twoLeg(), 0, 1_000_000_000);
    expect(res.warning).toBeUndefined();
    expect(res.netPvbp).toBeCloseTo(0, 6);
    expect(res.legs[0].notional).toBeCloseTo(1_000_000_000, 6); // anchor honoured
    expect(res.legs[1].notional).toBeLessThan(0); // weight −1 -> short
  });

  it("gives the two legs equal and opposite PVBP", () => {
    const res = sizePvbpNeutral(twoLeg(), 0, 1_000_000_000);
    expect(res.legs[0].pvbp).toBeCloseTo(-res.legs[1].pvbp, 6);
  });
});

describe("sizePvbpNeutral — 3-leg fly", () => {
  it("zeroes net PVBP with one anchor (the underdetermined case)", () => {
    const res = sizePvbpNeutral(fly(), 0, 1_000_000_000);
    expect(res.warning).toBeUndefined();
    expect(res.netPvbp).toBeCloseTo(0, 6);
  });

  it("honours the anchor exactly", () => {
    const res = sizePvbpNeutral(fly(), 0, 1_000_000_000);
    expect(res.legs[0].notional).toBeCloseTo(1_000_000_000, 6);
  });

  it("solves the belly short and the wings long", () => {
    const res = sizePvbpNeutral(fly(), 0, 1_000_000_000);
    expect(res.legs[0].notional).toBeGreaterThan(0); // +1 wing
    expect(res.legs[1].notional).toBeLessThan(0); // −2 belly
    expect(res.legs[2].notional).toBeGreaterThan(0); // +1 wing
  });

  it("puts PVBP in the weight ratio 1 : −2 : 1, NOT the notionals", () => {
    // This is the convention itself. Sizing ∝ wᵢ would make the NOTIONALS
    // 1:−2:1 and leave net PVBP non-zero; sizing ∝ wᵢ/pᵢ makes the PVBPs
    // 1:−2:1, which is what cancels.
    const res = sizePvbpNeutral(fly(), 0, 1_000_000_000);
    const [a, b, c] = res.legs.map((l) => l.pvbp);
    expect(b / a).toBeCloseTo(-2, 6);
    expect(c / a).toBeCloseTo(1, 6);
    // And the notionals are NOT in 1:−2:1 — the legs have different durations.
    expect(res.legs[1].notional / res.legs[0].notional).not.toBeCloseTo(-2, 2);
  });

  it("anchoring a different leg rescales the package but stays neutral", () => {
    const res = sizePvbpNeutral(fly(), 1, -2_000_000_000); // anchor the belly
    expect(res.netPvbp).toBeCloseTo(0, 6);
    expect(res.legs[1].notional).toBeCloseTo(-2_000_000_000, 6);
  });
});

describe("sizePvbpNeutral — non-cancelling weights", () => {
  it("warns instead of pretending to be neutral", () => {
    // (+1, −1, +1) sums to 1, so net PVBP = c·1 ≠ 0 at any non-zero scale.
    const legs = fly();
    legs[1].weight = -1;
    const res = sizePvbpNeutral(legs, 0, 1_000_000_000);
    expect(res.warning).toContain("가중치 합");
    expect(Math.abs(res.netPvbp)).toBeGreaterThan(0);
  });

  it("refuses a degenerate anchor rather than dividing by zero", () => {
    const legs = fly();
    legs[0].weight = 0;
    const res = sizePvbpNeutral(legs, 0, 1_000_000_000);
    expect(res.warning).toBeTruthy();
    expect(res.legs.every((l) => l.notional === 0)).toBe(true);
  });
});

describe("sizeManual", () => {
  it("reports the net PVBP the user's own sizes produce", () => {
    const legs = twoLeg();
    const res = sizeManual(legs, [1_000_000_000, -1_000_000_000]);
    // Equal notionals on different durations do NOT cancel -- that's exactly
    // what the neutral mode exists to fix.
    expect(Math.abs(res.netPvbp)).toBeGreaterThan(0);
    expect(res.legs[0].notional).toBe(1_000_000_000);
  });
});

describe("spreadPnlPath", () => {
  const legs = sizePvbpNeutral(twoLeg(), 0, 1_000_000_000).legs;
  const yieldsFor = (rows: Array<[string, number, number]>) => [
    new Map(rows.map(([d, a]) => [d, a])),
    new Map(rows.map(([d, , b]) => [d, b])),
  ];

  it("is zero on the entry date", () => {
    const path = spreadPnlPath(legs, yieldsFor([["2026-07-01", 0.035, 0.03]]), "2026-07-01");
    expect(path[0].value).toBeCloseTo(0, 6);
  });

  it("cancels a parallel shift (the point of PVBP neutrality)", () => {
    // Both legs +10bp: net PVBP is 0, so the package P&L must be ~0.
    const path = spreadPnlPath(
      legs,
      yieldsFor([
        ["2026-07-01", 0.035, 0.03],
        ["2026-07-02", 0.036, 0.031],
      ]),
      "2026-07-01",
    );
    expect(path[1].value).toBeCloseTo(0, 6);
  });

  it("registers a curve move", () => {
    // Only the +1 leg sells off -> a real P&L, opposite in sign to the move.
    const path = spreadPnlPath(
      legs,
      yieldsFor([
        ["2026-07-01", 0.035, 0.03],
        ["2026-07-02", 0.036, 0.03],
      ]),
      "2026-07-01",
    );
    expect(path[1].value).toBeLessThan(0); // long leg's yield rose
  });

  it("skips dates before entry and drops incomplete ones", () => {
    const legYields = [
      new Map([
        ["2026-06-30", 0.034],
        ["2026-07-01", 0.035],
        ["2026-07-02", 0.036],
      ]),
      new Map([
        ["2026-06-30", 0.029],
        ["2026-07-01", 0.03],
        // 07-02 missing on leg 2
      ]),
    ];
    const path = spreadPnlPath(legs, legYields, "2026-07-01");
    expect(path.map((p) => p.time)).toEqual(["2026-07-01"]);
  });
});
