import { describe, expect, it } from "vitest";

import {
  RESIDUAL_LABEL,
  closureFooter,
  contributionRows,
  deltaBpByTenor,
  excludedTenors,
  pillarRates,
} from "./daily-recon-math";
import type { MarketDataResponse } from "./api-types";

/**
 * RECON-DAILY math pins. The component does no arithmetic of its own, so
 * these fixtures ARE the panel's numbers: exact-match pillar mapping (no
 * interpolated risk), Δbp in bp, M3 = M1 × M2 with null-exclusion (never
 * zero-fill), and the closure footer identity.
 */

const COLS = ["1D", "3M", "6M", "9M", "1Y", "1.5Y", "2Y", "4Y", "30Y"] as const;

function snap(over: Partial<MarketDataResponse> = {}): MarketDataResponse {
  return {
    valuation_date: "2026-07-14",
    cd_rate: 0.025,
    on_rate: null,
    swap_quotes: [
      { tenor_years: 1, tenor_months: 6, rate: 0.026 },
      { tenor_years: 1, tenor_months: 9, rate: 0.0265 },
      { tenor_years: 1, tenor_months: null, rate: 0.027 },
      { tenor_years: 2, tenor_months: 18, rate: 0.0275 },
      { tenor_years: 2, tenor_months: null, rate: 0.028 },
      { tenor_years: 4, tenor_months: null, rate: 0.029 },
      { tenor_years: 30, tenor_months: null, rate: 0.031 },
      // Quotes with no KRD column — must be ignored, not guessed into one.
      { tenor_years: 11, tenor_months: null, rate: 0.030 },
      { tenor_years: 15, tenor_months: null, rate: 0.0305 },
    ],
    ...over,
  };
}

describe("pillarRates — exact-match tenor grid", () => {
  it("maps CD91D→3M, month-quotes→6M/9M/1.5Y, year-quotes→NY, and ignores 11Y/15Y", () => {
    const rates = pillarRates(snap());
    expect(rates["3M"]).toBe(0.025);
    expect(rates["6M"]).toBe(0.026);
    expect(rates["9M"]).toBe(0.0265);
    expect(rates["1Y"]).toBe(0.027);
    expect(rates["1.5Y"]).toBe(0.0275);
    expect(rates["2Y"]).toBe(0.028);
    expect(rates["4Y"]).toBe(0.029);
    expect(rates["30Y"]).toBe(0.031);
    // No O/N pillar in the snapshot → 1D is UNMAPPED, not zero.
    expect(rates["1D"]).toBeUndefined();
    expect(rates["11Y"]).toBeUndefined();
    expect(rates["15Y"]).toBeUndefined();
  });

  it("maps 1D only when on_rate is present", () => {
    expect(pillarRates(snap({ on_rate: 0.024 }))["1D"]).toBe(0.024);
  });
});

describe("deltaBpByTenor", () => {
  const close = snap();
  const asOf = snap({
    valuation_date: "2026-07-15",
    cd_rate: 0.0252, // +2.0bp
    swap_quotes: [
      { tenor_years: 1, tenor_months: 6, rate: 0.026 }, // 0.0bp
      { tenor_years: 1, tenor_months: 9, rate: 0.0264 }, // −1.0bp
      { tenor_years: 1, tenor_months: null, rate: 0.027 },
      { tenor_years: 2, tenor_months: 18, rate: 0.0275 },
      { tenor_years: 2, tenor_months: null, rate: 0.028 },
      { tenor_years: 4, tenor_months: null, rate: 0.02885 }, // −1.5bp
      // 30Y quote MISSING at D → unmapped, not "unchanged".
    ],
  });

  it("computes signed bp moves and nulls for pillars absent at either date", () => {
    const d = deltaBpByTenor(COLS, close, asOf);
    expect(d["3M"]).toBeCloseTo(2.0, 6);
    expect(d["9M"]).toBeCloseTo(-1.0, 6);
    expect(d["6M"]).toBeCloseTo(0.0, 6);
    expect(d["4Y"]).toBeCloseTo(-1.5, 6);
    expect(d["30Y"]).toBeNull(); // missing at D
    expect(d["1D"]).toBeNull(); // missing at both
  });
});

describe("contributionRows / excludedTenors — M3 = M1 × M2", () => {
  const deltaBp: Record<string, number | null> = {
    "1D": null,
    "3M": 2.0,
    "4Y": -1.5,
    "30Y": null,
  };
  const cols = ["1D", "3M", "4Y", "30Y"] as const;
  const pvbpRows = [
    { sector: "국고채", "1D": 500_000, "3M": 0, "4Y": 2_000_000, "30Y": 0, total: 2_500_000 },
    { sector: "IRS", "1D": 0, "3M": 1_000_000, "4Y": 0, "30Y": 0, total: 1_000_000 },
    { sector: "합계", "1D": 500_000, "3M": 1_000_000, "4Y": 2_000_000, "30Y": 0, total: 3_500_000 },
  ];

  it("multiplies cell-wise and EXCLUDES null-Δbp columns from row totals", () => {
    const rows = contributionRows(cols, pvbpRows, deltaBp);
    const ktb = rows[0];
    expect(ktb.cells["1D"]).toBeNull(); // excluded, not zero
    expect(ktb.cells["4Y"]).toBeCloseTo(-3_000_000, 3);
    expect(ktb.total).toBeCloseTo(-3_000_000, 3); // 1D mass NOT summed
    const irs = rows[1];
    expect(irs.cells["3M"]).toBeCloseTo(2_000_000, 3);
    expect(irs.total).toBeCloseTo(2_000_000, 3);
    // 합계 row total = the panel's Assumed figure.
    expect(rows[2].total).toBeCloseTo(-1_000_000, 3);
  });

  it("names only unmapped tenors that carry non-zero KRD mass", () => {
    const ex = excludedTenors(cols, pvbpRows[2], deltaBp);
    expect(ex).toEqual([{ tenor: "1D", krd: 500_000 }]);
    // 30Y is unmapped but massless — nothing was excluded there.
  });
});

describe("closureFooter", () => {
  it("realized = 채권평가 + 스왑평가; 잔차 = realized − assumed; % of |realized|", () => {
    const f = closureFooter(-1_000_000, -2_500_000, 1_800_000);
    expect(f.assumed).toBe(-1_000_000);
    expect(f.realized).toBe(-700_000);
    expect(f.residual).toBe(300_000);
    expect(f.residualPct).toBeCloseTo((300_000 / 700_000) * 100, 6);
  });

  it("suppresses the percentage (null) when realized is exactly zero", () => {
    expect(closureFooter(50, 0, 0).residualPct).toBeNull();
  });
});

describe("잔차-naming pin (owner core rule)", () => {
  it("the residual slot is 잔차 and may never contain a theta/carry word", () => {
    expect(RESIDUAL_LABEL).toBe("잔차");
    expect(RESIDUAL_LABEL).not.toMatch(/테타|theta|carry|캐리/i);
  });
});
