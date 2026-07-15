/**
 * Pins the generalized N-leg spread model (B3).
 *
 * The load-bearing property is the regression one: generalizing legA/legB into
 * a weighted array must leave the 2-leg numbers bit-identical to the old
 * hard-coded `(legB − legA) × 10000`. If that drifts, every saved watchlist
 * silently re-prices.
 */
import { describe, expect, it } from "vitest";

import type { CreditSeriesResultOut, RateHistoryPointOut } from "@/lib/api-client";
import {
  buildInstrumentSeries,
  creditLegsOf,
  spreadId,
  spreadLabel,
  type Leg,
  type SelectedInstrument,
} from "./rv-instruments";

const irsLeg = (tenor: string): Leg => ({ sector: "IRS", rating: null, tenor });

/** IRS points expose tenor_rates; 3M maps to cd_rate (see legValueMap). */
function irsPoints(rows: Array<{ date: string; rates: Record<string, number> }>): RateHistoryPointOut[] {
  return rows.map((r) => ({
    valuation_date: r.date,
    cd_rate: 0.03,
    on_rate: null,
    base_rate: null,
    tenor_rates: r.rates,
  })) as RateHistoryPointOut[];
}

const NO_CREDIT: CreditSeriesResultOut[] = [];

describe("buildInstrumentSeries — 2-leg regression", () => {
  it("reproduces the old (legB − legA) × 10000 exactly", () => {
    // Old model: { legA: 3Y, legB: 5Y } -> (5Y − 3Y) × 10000.
    // New model: legs [{5Y, +1}, {3Y, −1}] must give the identical number.
    const legs = [
      { leg: irsLeg("5Y"), weight: 1 },
      { leg: irsLeg("3Y"), weight: -1 },
    ];
    const inst: SelectedInstrument = { kind: "spread", id: spreadId(legs), legs };
    const points = irsPoints([{ date: "2026-07-01", rates: { "3Y": 0.032, "5Y": 0.0355 } }]);

    const [series] = buildInstrumentSeries([inst], points, NO_CREDIT);
    expect(series.priceScaleId).toBe("left"); // spreads live on the bp axis
    expect(series.lineData).toHaveLength(1);
    // (0.0355 − 0.032) × 10000 = 35bp
    expect(series.lineData[0].value).toBeCloseTo(35, 9);
  });
});

describe("buildInstrumentSeries — 3-leg fly", () => {
  const flyLegs = [
    { leg: irsLeg("3Y"), weight: 1 },
    { leg: irsLeg("5Y"), weight: -2 },
    { leg: irsLeg("10Y"), weight: 1 },
  ];
  const fly: SelectedInstrument = { kind: "spread", id: spreadId(flyLegs), legs: flyLegs };

  it("evaluates w1·X + w2·Y + w3·Z in bp", () => {
    const points = irsPoints([
      { date: "2026-07-01", rates: { "3Y": 0.03, "5Y": 0.035, "10Y": 0.042 } },
    ]);
    const [series] = buildInstrumentSeries([fly], points, NO_CREDIT);
    // (0.03 − 2×0.035 + 0.042) = 0.002 -> 20bp
    expect(series.lineData[0].value).toBeCloseTo(20, 9);
  });

  it("omits a date where any leg is missing rather than mispricing it", () => {
    // 2026-07-02 has no 10Y -- summing only the legs present would silently
    // report a two-leg number as if it were the fly.
    const points = irsPoints([
      { date: "2026-07-01", rates: { "3Y": 0.03, "5Y": 0.035, "10Y": 0.042 } },
      { date: "2026-07-02", rates: { "3Y": 0.031, "5Y": 0.036 } },
    ]);
    const [series] = buildInstrumentSeries([fly], points, NO_CREDIT);
    expect(series.lineData.map((d) => d.time)).toEqual(["2026-07-01"]);
  });

  it("collects every leg for the credit-series request", () => {
    const credit = creditLegsOf([fly]);
    expect(credit).toEqual([]); // IRS legs resolve from rate-history, not credit
    const mixed: SelectedInstrument = {
      kind: "spread",
      id: "x",
      legs: [
        { leg: { sector: "국고채", rating: null, tenor: "3Y" }, weight: 1 },
        { leg: { sector: "회사채", rating: "AA", tenor: "3Y" }, weight: -2 },
        { leg: { sector: "공사채", rating: null, tenor: "5Y" }, weight: 1 },
      ],
    };
    // All three non-IRS legs must be requested -- the 3rd is the one a
    // legA/legB-shaped walk would drop.
    expect(creditLegsOf([mixed]).map((l) => l.sector)).toEqual(["국고채", "회사채", "공사채"]);
  });
});

describe("spreadId", () => {
  it("distinguishes packages that differ only by weight", () => {
    const a = spreadId([
      { leg: irsLeg("5Y"), weight: 1 },
      { leg: irsLeg("3Y"), weight: -1 },
    ]);
    const b = spreadId([
      { leg: irsLeg("5Y"), weight: 2 },
      { leg: irsLeg("3Y"), weight: -1 },
    ]);
    // A 1:1 spread and a 2:1 weighted one are different instruments; colliding
    // them would let one silently overwrite the other in the watchlist.
    expect(a).not.toBe(b);
  });
});

describe("spreadLabel", () => {
  it("keeps the historical 'B − A' rendering for a 2-leg", () => {
    expect(
      spreadLabel([
        { leg: irsLeg("5Y"), weight: 1 },
        { leg: irsLeg("3Y"), weight: -1 },
      ]),
    ).toBe("IRS 5Y − IRS 3Y");
  });

  it("renders a fly with its coefficient", () => {
    expect(
      spreadLabel([
        { leg: irsLeg("3Y"), weight: 1 },
        { leg: irsLeg("5Y"), weight: -2 },
        { leg: irsLeg("10Y"), weight: 1 },
      ]),
    ).toBe("IRS 3Y − 2×IRS 5Y + IRS 10Y");
  });
});
