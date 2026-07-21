import { describe, expect, it } from "vitest";

import {
  BLOTTER_STALE_THRESHOLD_DAYS,
  RESIDUAL_CAPTION,
  RESIDUAL_LABEL,
  bridgeLadder,
  contributionRows,
  deltaBpByTenor,
  dv01Meta,
  excludedTenors,
  isBlotterStale,
  pillarRates,
} from "./daily-recon-math";
import type { MarketDataResponse } from "./api-types";

/**
 * RECON-DAILY / FB3 math pins. The component does no arithmetic of its own,
 * so these fixtures ARE the panel's numbers: exact-match pillar mapping (no
 * interpolated risk), Δbp in bp, M3 = M1 × (−M2) with null-exclusion (never
 * zero-fill), and the FB3 bridge-ladder identities (±₩1 per term).
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

  it("multiplies cell-wise with the P&L sign KRD×(−Δbp) and EXCLUDES null-Δbp columns [CHANGED, FB3]", () => {
    // [CHANGED, FB3] sign fix: first-order P&L = KRD × (−Δbp) — the realized
    // buckets' own convention (long DV01 loses when yields rise). The old
    // ×(+Δbp) values were inverted; every expectation below flipped sign.
    const rows = contributionRows(cols, pvbpRows, deltaBp);
    const ktb = rows[0];
    expect(ktb.cells["1D"]).toBeNull(); // excluded, not zero
    expect(ktb.cells["4Y"]).toBeCloseTo(3_000_000, 3); // yields fell → long gains
    expect(ktb.total).toBeCloseTo(3_000_000, 3); // 1D mass NOT summed
    const irs = rows[1];
    expect(irs.cells["3M"]).toBeCloseTo(-2_000_000, 3); // yields rose → loses
    expect(irs.total).toBeCloseTo(-2_000_000, 3);
    // 합계 row total = the panel's Assumed figure.
    expect(rows[2].total).toBeCloseTo(1_000_000, 3);
  });

  it("names only unmapped tenors that carry non-zero KRD mass", () => {
    const ex = excludedTenors(cols, pvbpRows[2], deltaBp);
    expect(ex).toEqual([{ tenor: "1D", krd: 500_000 }]);
    // 30Y is unmapped but massless — nothing was excluded there.
  });

  it("A3.4 honest-zero vs no-KRD: KRD present + Δbp 0.0 → numeric 0; KRD absent → null", () => {
    // 2Y: KRD present (2M) and a REAL 0.0bp move → honest ₩0 (renders 0, not —).
    // 5Y: no KRD mass (0) but Δbp present → null (— reserved for no-KRD).
    // 7Y: unmapped Δbp (null) with KRD mass → null (— for "don't know").
    const cols2 = ["2Y", "5Y", "7Y"] as const;
    const dbp: Record<string, number | null> = { "2Y": 0.0, "5Y": -3.0, "7Y": null };
    const rows = contributionRows(cols2, [
      { sector: "국고채", "2Y": 2_000_000, "5Y": 0, "7Y": 4_000_000, total: 6_000_000 },
    ], dbp);
    const r = rows[0];
    expect(r.cells["2Y"]).toBe(0); // honest ₩0 — numeric, not null
    expect(Object.is(r.cells["2Y"], -0)).toBe(false); // and not the JS −0
    expect(r.cells["5Y"]).toBeNull(); // no KRD mass → —
    expect(r.cells["7Y"]).toBeNull(); // unmapped Δbp → —
    // The honest 0 and the null cells all contribute 0 mass — total unchanged.
    expect(r.total).toBe(0);
  });
});

describe("dv01Meta / isBlotterStale — FB5-A A3.2/A3.3 basis metadata", () => {
  const pvbpRows = [
    { sector: "국고채", "3Y": 1, total: 1, dv01_sources: { reval: 12, sheet_fallback: 2 } },
    { sector: "여전채", "3Y": 1, total: 1, dv01_sources: { sheet_frn: 3 } },
    {
      sector: "합계",
      "3Y": 2,
      total: 2,
      dv01_sources: { reval: 12, sheet_fallback: 2, sheet_frn: 3 },
      blotter_as_of: "2026-03-23",
      frn_positions: ["FRN-1", "FRN-2", "FRN-3"],
    },
  ];

  it("reads the 합계 row's mixed-basis counts, blotter as-of, and FRN count", () => {
    const meta = dv01Meta(pvbpRows);
    expect(meta.sources).toEqual({ reval: 12, sheet_fallback: 2, sheet_frn: 3 });
    expect(meta.blotterAsOf).toBe("2026-03-23");
    expect(meta.frnCount).toBe(3);
  });

  it("degrades to empty/null when there is no 합계 row or no bond metadata", () => {
    expect(dv01Meta(undefined)).toEqual({ sources: {}, blotterAsOf: null, frnCount: 0 });
    expect(dv01Meta([{ sector: "합계", total: 0 }])).toEqual({
      sources: {},
      blotterAsOf: null,
      frnCount: 0,
    });
  });

  it("isBlotterStale: a frozen 2026-03-23 blotter is stale against a July close, fresh export is not", () => {
    // Current export: blotter 2026-03-23 vs a July D−1 close → months of lag.
    expect(isBlotterStale("2026-03-23", "2026-07-14")).toBe(true);
    // Fresh export: as-of ≈ the priced close (same day / within threshold) → hidden.
    expect(isBlotterStale("2026-07-13", "2026-07-14")).toBe(false);
    expect(isBlotterStale("2026-07-14", "2026-07-14")).toBe(false);
    // Just over the threshold flips it.
    const justOver = BLOTTER_STALE_THRESHOLD_DAYS + 1;
    expect(justOver).toBeGreaterThan(BLOTTER_STALE_THRESHOLD_DAYS);
    // Null inputs are never stale (nothing honest to say).
    expect(isBlotterStale(null, "2026-07-14")).toBe(false);
    expect(isBlotterStale("2026-03-23", null)).toBe(false);
  });
});

describe("bridgeLadder (FB3 — replaces the old two-term closure footer)", () => {
  it("holds the ladder identities exactly: 예상=테타+Assumed, Realized=테타+평가, 잔차=Realized−예상", () => {
    const f = bridgeLadder(700_000, 1_000_000, -2_500_000, 2_000_000);
    expect(f.theta).toBe(700_000);
    expect(f.assumed).toBe(1_000_000);
    expect(f.expected).toBe(1_700_000); // theta + assumed, exact
    expect(f.realized).toBe(200_000); // theta + bondMtm + swapMtm, exact
    expect(f.residual).toBe(-1_500_000); // realized − expected
    // …which is identically (mtm − assumed): the theta rung cancels — the
    // terms are mutually exclusive and collectively account for the bucket.
    expect(f.residual).toBe(-2_500_000 + 2_000_000 - 1_000_000);
    expect(f.residualPct).toBeCloseTo((-1_500_000 / 200_000) * 100, 6);
  });

  it("±₩1 grain: the ladder is closed under integer-won inputs (no rounding leak)", () => {
    const f = bridgeLadder(123_456_789, -987_654_321, 55_555_555, -1_234_567);
    expect(f.expected - f.theta - f.assumed).toBe(0);
    expect(f.realized - f.theta - (55_555_555 - 1_234_567)).toBe(0);
    expect(f.realized - f.expected - f.residual).toBe(0);
  });

  it("suppresses the percentage (null) when realized is exactly zero", () => {
    expect(bridgeLadder(-50, 50, 25, 25).residualPct).toBeNull();
  });
});

describe("잔차-naming pin (owner core rule, FB3 wording)", () => {
  it("the residual slot is 잔차, captioned 컨벡시티(+베이시스), never a theta/carry word", () => {
    expect(RESIDUAL_LABEL).toBe("잔차");
    expect(RESIDUAL_LABEL).not.toMatch(/테타|theta|carry|캐리/i);
    expect(RESIDUAL_CAPTION).toBe("컨벡시티(+베이시스)");
    expect(RESIDUAL_CAPTION).not.toMatch(/테타|theta|carry|캐리/i);
  });
});
