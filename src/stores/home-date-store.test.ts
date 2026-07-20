import { describe, expect, it } from "vitest";

import { resolveDailyCloseDate } from "./home-date-store";

/**
 * R3B-PLUS T2b — pins for the picked-close-date resolution the Daily P&L
 * request prices off. The load-bearing rule: an off-calendar pick snaps
 * BACKWARD to the latest available date ≤ it, never forward — a future close
 * would be fabricated data, and "the close in force at that date" is what a
 * historical P&L question means.
 */

const DATES = ["2026-07-10", "2026-07-13", "2026-07-14", "2026-07-15"];
const LATEST = "2026-07-15";

describe("resolveDailyCloseDate", () => {
  it("null pick resolves to the latest close (the pre-T2b automatic behavior)", () => {
    expect(resolveDailyCloseDate(null, LATEST, DATES)).toBe(LATEST);
  });

  it("an exact available date resolves to itself", () => {
    expect(resolveDailyCloseDate("2026-07-13", LATEST, DATES)).toBe("2026-07-13");
  });

  it("a weekend/holiday pick snaps backward to the latest available date ≤ it", () => {
    // 07-11/07-12 fall between available dates: back to 07-10, never up to 07-13.
    expect(resolveDailyCloseDate("2026-07-12", LATEST, DATES)).toBe("2026-07-10");
  });

  it("a pick at or beyond the latest close resolves to the latest close", () => {
    expect(resolveDailyCloseDate(LATEST, LATEST, DATES)).toBe(LATEST);
    expect(resolveDailyCloseDate("2026-08-01", LATEST, DATES)).toBe(LATEST);
  });

  it("a pick before the whole range falls back to the latest close, not an invented date", () => {
    expect(resolveDailyCloseDate("2026-07-01", LATEST, DATES)).toBe(LATEST);
  });

  it("stays undefined while the range hasn't loaded (no request fires)", () => {
    expect(resolveDailyCloseDate("2026-07-13", undefined, undefined)).toBeUndefined();
  });
});
