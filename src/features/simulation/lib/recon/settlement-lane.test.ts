/**
 * RECON-SCEN T4b pins:
 *  - realized tie: for periods whose fixing was already set at baseDate the
 *    scenario equals realized history, so the projected settlements equal the
 *    HAND-COMPUTED realized values — notional × (fixed − float) × days/365 —
 *    and are identical across all three (different-scenario) fixtures;
 *  - the projected lane and the engine's settle lane agree window-for-window;
 *  - settlement days only (honest empties otherwise);
 *  - dead-man: stripping the projected events while the engine lane still
 *    carries cash surfaces a mismatch, never a silent pass.
 */
import { describe, expect, it } from "vitest";

import { buildSettlementLane } from "./settlement-lane";
import { cloneFixture, loadFixture } from "./fixtures";

// Realized settlements, hand-computed from the fixture contracts (see
// scripts/recon-fixtures/generate_fixtures.py):
//  IRS-PAY  pay-fixed 2.85% vs known CD fixing 2.60%, 100억, period
//           2026-01-20 → 2026-04-20 (90 actual days):
//           (0.0260 − 0.0285) × 1e10 × 90/365 = −6,164,383.56 → −6,164,384
//  IRS-REC  receive-fixed 2.70% vs known fixing 2.55%, 100억, period
//           2026-02-08 → 2026-05-08 (89 actual days at the engine's
//           schedule-adjusted payment date):
//           (0.0270 − 0.0255) × 1e10 × 89/365 = +3,657,534.25 → +3,657,534
const REALIZED_PAY = Math.round(((2.6 - 2.85) / 100) * 1e10 * (90 / 365));
const REALIZED_REC = Math.round(((2.7 - 2.55) / 100) * 1e10 * (89 / 365));

describe("settlement lane (T4b, swaps only)", () => {
  it("projected settlements equal the realized (already-fixed) values — the lane-A tie", () => {
    const { response } = loadFixture("settlement");
    const lane = buildSettlementLane(response);
    expect(lane.days.length).toBe(2);

    const [d1, d2] = lane.days;
    expect(d1).toMatchObject({ day: 19, date: "2026-04-20" });
    expect(d1.rows.map((r) => [r.positionId, r.settledCf])).toEqual([["IRS-PAY", REALIZED_PAY]]);
    expect(REALIZED_PAY).toBe(-6_164_384);

    expect(d2).toMatchObject({ day: 37, date: "2026-05-08" });
    expect(d2.rows.map((r) => [r.positionId, r.settledCf])).toEqual([["IRS-REC", REALIZED_REC]]);
    expect(REALIZED_REC).toBe(3_657_534);
  });

  it("already-fixed settlements are scenario-independent: identical across all three fixtures", () => {
    const lanes = (["settlement", "linear", "shaped"] as const).map((n) =>
      buildSettlementLane(loadFixture(n).response),
    );
    for (const lane of lanes) {
      expect(lane.days.map((d) => [d.day, d.projectedNet])).toEqual([
        [19, REALIZED_PAY],
        [37, REALIZED_REC],
      ]);
    }
  });

  it("projected lane reconciles with the engine settle lane window-for-window (±₩1)", () => {
    const { response } = loadFixture("settlement");
    const lane = buildSettlementLane(response);
    expect(lane.allMatch).toBe(true);
    // Exactly the two cash-bearing windows appear — non-settlement recon days
    // are honest empties, not zero rows.
    expect(lane.windows.map((w) => [w.reconDay, w.engineSettleCf, w.projectedSum])).toEqual([
      [19, REALIZED_PAY, REALIZED_PAY],
      [37, REALIZED_REC, REALIZED_REC],
    ]);
  });

  it("no settlements → empty lane, no windows (honest empty state)", () => {
    const fx = cloneFixture(loadFixture("settlement"));
    fx.response.irsSettlementEvents = [];
    for (const r of fx.response.irsDailyReconciliation ?? []) r.settleCf = 0;
    const lane = buildSettlementLane(fx.response);
    expect(lane.days).toEqual([]);
    expect(lane.windows).toEqual([]);
    expect(lane.allMatch).toBe(true);
  });

  it("dead-man: engine cash without projected events is a MISMATCH, never a silent pass", () => {
    const fx = cloneFixture(loadFixture("settlement"));
    fx.response.irsSettlementEvents = [];
    const lane = buildSettlementLane(fx.response);
    expect(lane.days).toEqual([]);
    expect(lane.windows.length).toBe(2); // the engine lane still carries cash
    expect(lane.allMatch).toBe(false);
  });
});
