/**
 * RECON-SCEN M1/M3 pins over REAL engine captures (see fixtures.ts):
 *
 *  - linear fixture (small +5bp parallel shock, near-linear waypoint path):
 *    the 잔차 stays ≈ 0 within the STATED tolerance — |잔차| ≤ max(₩100k,
 *    1.8% × |assumed|) every business day (observed worst: ₩566,157 on a
 *    ₩35.2M swing, 1.61%, final day — position aging + FM convexity, exactly
 *    the linearity gap the on-screen caption states).
 *  - shaped fixture (non-monotone path + tenor/credit/IRS spreads): the 잔차
 *    IS the engine-vs-linear gap, deterministically — final-day value pinned.
 *  - settlement fixture (zero shock): both lanes identically zero — 잔차 0.
 *  - full-pillar coverage: the M1 grid columns carry every engine KRD pillar.
 *  - grid regimes: response-KRD route (golden payloads) ≡ request-derived
 *    route (live bridge, krdMap:{}) cell-for-cell.
 *  - naming guard: the residual is 잔차 — renaming it to anything containing
 *    테타/carry fails here.
 */
import { describe, expect, it } from "vitest";

import { PATH_PILLARS } from "./path-matrix";
import {
  ASSUMED_LABEL,
  ENGINE_LABEL,
  LINEARITY_CAPTION,
  RESIDUAL_LABEL,
  buildKrdGrid,
  buildScenarioRecon,
} from "./scenario-recon";
import { cloneFixture, loadFixture } from "./fixtures";

describe("잔차 naming guard (fixed rule: NEVER 테타/carry)", () => {
  it("the residual label is 잔차 and contains no 테타/carry wording", () => {
    expect(RESIDUAL_LABEL).toBe("잔차");
    for (const label of [RESIDUAL_LABEL, ASSUMED_LABEL, ENGINE_LABEL]) {
      expect(/테타|carry|캐리|theta/i.test(label)).toBe(false);
    }
    // The caption must state the linearity assumption (KRD fixed @ baseDate).
    expect(LINEARITY_CAPTION).toContain("기준일 KRD 고정");
    expect(LINEARITY_CAPTION).toContain(RESIDUAL_LABEL);
    expect(/테타|carry|캐리|theta/i.test(LINEARITY_CAPTION)).toBe(false);
  });
});

describe("M3 — assumed vs engine vs 잔차", () => {
  it("linear fixture: 잔차 ≈ 0 within the stated tolerance on every business day", () => {
    const { request, response } = loadFixture("linear");
    const { points } = buildScenarioRecon(request, response);
    expect(points.length).toBe(32); // day 0 + 31 business days
    expect(points[0].day).toBe(0);
    expect(Math.abs(points[0].assumed)).toBe(0);
    expect(Math.abs(points[0].engine)).toBe(0);
    for (const p of points) {
      expect(Math.abs(p.residual)).toBeLessThanOrEqual(Math.max(100_000, 0.018 * Math.abs(p.assumed)));
    }
    // Deterministic worst (final day) — cross-checked against an independent
    // Python evaluation of the same fixture.
    const last = points[points.length - 1];
    expect(last.day).toBe(44);
    expect(last.assumed).toBeCloseTo(-35_187_852.56, 0);
    expect(last.engine).toBeCloseTo(-34_621_695.06, 0);
    expect(last.residual).toBeCloseTo(566_157.5, 0);
  });

  it("shaped fixture: 잔차 equals the engine-vs-linear gap, pinned", () => {
    const { request, response } = loadFixture("shaped");
    const { points } = buildScenarioRecon(request, response);
    const last = points[points.length - 1];
    expect(last.day).toBe(44);
    expect(last.assumed).toBeCloseTo(-142_542_569.11, 0);
    expect(last.engine).toBeCloseTo(-140_632_640.35, 0);
    expect(last.residual).toBeCloseTo(1_909_928.76, 0);
  });

  it("settlement fixture (zero shock): both lanes zero, 잔차 exactly 0 (settlement cash lives in the theta lane, not valuation)", () => {
    const { request, response } = loadFixture("settlement");
    const { points } = buildScenarioRecon(request, response);
    for (const p of points) {
      expect(Math.abs(p.assumed)).toBeLessThanOrEqual(1);
      expect(Math.abs(p.engine)).toBeLessThanOrEqual(1);
      expect(Math.abs(p.residual)).toBeLessThanOrEqual(1);
    }
  });

  it("dates ride the recon rows' business-day calendar (weekend whitespace by construction)", () => {
    const { request, response } = loadFixture("linear");
    const { points } = buildScenarioRecon(request, response);
    const day1 = points.find((p) => p.day === 1);
    expect(day1?.date).toBe("2026-04-02");
    // 2026-04-04/05 is a weekend — no such days on the axis.
    expect(points.some((p) => p.date === "2026-04-04" || p.date === "2026-04-05")).toBe(false);
  });

  it("swap-excluded run: swap KRD rows leave the assumed lane (like-for-like vs bond-only engine lane)", () => {
    const fx = cloneFixture(loadFixture("linear"));
    fx.response.exclusions = [{ assetClass: "swap", reason: "당일 IRS 호가 없음", asOf: "2026-04-01" }];
    for (const row of fx.response.decompositionDaily ?? []) {
      row.swapMtm = null;
      row.swapCarry = null;
    }
    const withSwaps = buildScenarioRecon(loadFixture("linear").request, loadFixture("linear").response);
    const excluded = buildScenarioRecon(fx.request, fx.response);
    expect(excluded.swapsExcluded).toBe(true);
    const last = excluded.points[excluded.points.length - 1];
    const lastWith = withSwaps.points[withSwaps.points.length - 1];
    // assumed no longer carries the IRS cells (net short-book DV01 ≈ −6k ₩/bp).
    expect(last.assumed).not.toBeCloseTo(lastWith.assumed, 0);
    // engine lane = bondMtm only.
    expect(last.engine).toBeCloseTo(-34_156_045.27, 0);
  });
});

describe("M1 — KRD grid @ baseDate", () => {
  it("full-pillar coverage: every engine KRD pillar is a column, in tenor order", () => {
    const { request, response } = loadFixture("linear");
    const grid = buildKrdGrid(request, response);
    expect(grid.pillarLabels.slice(0, PATH_PILLARS.length)).toEqual(PATH_PILLARS.map((p) => p.label));
  });

  it("fixture (golden-style payload with krdMap): grid comes from the response, not derived", () => {
    const { request, response } = loadFixture("linear");
    const grid = buildKrdGrid(request, response);
    expect(grid.derivedBondRows).toBe(false);
    const ktb = grid.rows.find((r) => r.sector === "국고채");
    expect(ktb?.cells["5Y"]).toBe(4_500_000);
    const irs = grid.rows.find((r) => r.sector === "IRS");
    expect(irs).toBeTruthy();
    // The backend's 합계 pseudo-tenor never becomes a column/cell.
    expect(grid.pillarLabels).not.toContain("합계");
    expect(Object.keys(irs!.cells)).not.toContain("합계");
  });

  it("live-bridge regime (krdMap:{} → all-zero bond response rows): bond rows rebuilt from request positions, cell-for-cell identical", () => {
    const golden = buildKrdGrid(loadFixture("linear").request, loadFixture("linear").response);
    const fx = cloneFixture(loadFixture("linear"));
    for (const p of fx.request.positions) {
      if (p.bondType !== "swap") p.krdMap = {};
    }
    for (const row of fx.response.pvbpSensitivity ?? []) {
      if (row.sector !== "IRS" && row.sector !== "OIS") {
        row.tenors = Object.fromEntries(Object.keys(row.tenors).map((k) => [k, 0]));
        row.total = 0;
      }
    }
    const derived = buildKrdGrid(fx.request, fx.response);
    expect(derived.derivedBondRows).toBe(true);
    for (const sector of ["국고채", "회사채"]) {
      const a = golden.rows.find((r) => r.sector === sector);
      const b = derived.rows.find((r) => r.sector === sector);
      expect(b?.cells).toEqual(a?.cells);
    }
    // Swap rows still come from the engine's enriched KRD either way.
    expect(derived.rows.find((r) => r.sector === "IRS")?.cells).toEqual(
      golden.rows.find((r) => r.sector === "IRS")?.cells,
    );
    // And the recon built on the derived grid reproduces the same 잔차.
    const g = buildScenarioRecon(loadFixture("linear").request, loadFixture("linear").response);
    const d = buildScenarioRecon(fx.request, fx.response);
    expect(d.points[d.points.length - 1].residual).toBeCloseTo(
      g.points[g.points.length - 1].residual,
      6,
    );
  });
});
