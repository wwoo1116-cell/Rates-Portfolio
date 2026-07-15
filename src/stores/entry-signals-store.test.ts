/**
 * Pins the v0 -> v1 persist migration for saved spreads.
 *
 * This runs against real localStorage written by earlier builds ("entry-signals-storage"),
 * so getting it wrong doesn't fail loudly -- it rehydrates a spread with
 * `legs: undefined` and either crashes buildInstrumentSeries or, worse, drops
 * someone's watchlist. The sign convention matters just as much: v0's value was
 * (legB − legA), so legB must come back as +1 and legA as −1.
 */
import { describe, expect, it } from "vitest";

import { buildInstrumentSeries, spreadLabel, type SelectedInstrument } from "@/lib/rv-instruments";
import type { CreditSeriesResultOut, RateHistoryPointOut } from "@/lib/api-client";
import { migrateInstrumentV0 } from "./entry-signals-store";

const legA = { sector: "IRS", rating: null, tenor: "3Y" };
const legB = { sector: "IRS", rating: null, tenor: "5Y" };
const V0_SPREAD = { kind: "spread", id: "S:IRS||3Y~IRS||5Y", legA, legB };

describe("migrateInstrumentV0", () => {
  it("maps legB -> +1 and legA -> -1, preserving the (B − A) sign", () => {
    const migrated = migrateInstrumentV0(V0_SPREAD);
    expect(migrated?.kind).toBe("spread");
    if (migrated?.kind !== "spread") throw new Error("unreachable");
    expect(migrated.legs).toEqual([
      { leg: legB, weight: 1 },
      { leg: legA, weight: -1 },
    ]);
  });

  it("keeps the label identical to what v0 rendered", () => {
    const migrated = migrateInstrumentV0(V0_SPREAD);
    if (migrated?.kind !== "spread") throw new Error("unreachable");
    // v0's hard-coded label was `${legLabel(legB)} − ${legLabel(legA)}`.
    expect(spreadLabel(migrated.legs)).toBe("IRS 5Y − IRS 3Y");
  });

  it("re-prices a migrated spread to the same bp value v0 produced", () => {
    const migrated = migrateInstrumentV0(V0_SPREAD) as SelectedInstrument;
    const points = [
      {
        valuation_date: "2026-07-01",
        cd_rate: 0.03,
        on_rate: null,
        base_rate: null,
        tenor_rates: { "3Y": 0.032, "5Y": 0.0355 },
      },
    ] as RateHistoryPointOut[];
    const [series] = buildInstrumentSeries([migrated], points, [] as CreditSeriesResultOut[]);
    expect(series.lineData[0].value).toBeCloseTo(35, 9); // (0.0355 − 0.032) × 10000
  });

  it("regenerates the id away from the v0 format", () => {
    const migrated = migrateInstrumentV0(V0_SPREAD);
    // The v0 id encoded neither weights nor leg count, so it cannot survive.
    expect(migrated?.id).not.toBe(V0_SPREAD.id);
    expect(migrated?.id).toBe("S:1*IRS||5Y~-1*IRS||3Y");
  });

  it("passes outrights through untouched", () => {
    const outright = { kind: "outright", id: "O:IRS||3Y", leg: legA };
    expect(migrateInstrumentV0(outright)).toEqual(outright);
  });

  it("leaves an already-migrated v1 spread alone (idempotent)", () => {
    // Guards the fromVersion check: re-running must not double-wrap the legs.
    const v1 = {
      kind: "spread",
      id: "S:1*IRS||5Y~-1*IRS||3Y",
      legs: [
        { leg: legB, weight: 1 },
        { leg: legA, weight: -1 },
      ],
    };
    expect(migrateInstrumentV0(v1)).toEqual(v1);
  });

  it("returns null for a null focused instrument", () => {
    expect(migrateInstrumentV0(null)).toBeNull();
  });
});
