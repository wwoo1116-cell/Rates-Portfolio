import { afterEach, describe, expect, it, vi } from "vitest";

import { buildSimulationInputs, todayInSeoul } from "./position-bridge";

/**
 * s18 T4 — baseDate must be the SEOUL calendar date. The pre-s18 UTC
 * derivation made any run before 09:00 KST resolve to the previous day; since
 * s15 keyed the par-quote lookup on baseDate, a Monday-morning run resolved to
 * Sunday and silently excluded the entire swap book. These clock fakes pin the
 * boundary on both sides plus the Monday-morning exclusion scenario.
 */
afterEach(() => {
  vi.useRealTimers();
});

const at = (iso: string) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
};

describe("todayInSeoul / baseDate derivation (s18 T4)", () => {
  it("resolves 2026-07-15T23:30Z (= 08:30 KST, PRE-09:00) to 2026-07-16 — not the UTC previous day", () => {
    at("2026-07-15T23:30:00Z");
    expect(todayInSeoul()).toBe("2026-07-16");
    expect(buildSimulationInputs([]).baseDate).toBe("2026-07-16");
  });

  it("resolves 2026-07-16T00:30Z (= 09:30 KST, post-09:00) to 2026-07-16", () => {
    at("2026-07-16T00:30:00Z");
    expect(todayInSeoul()).toBe("2026-07-16");
    expect(buildSimulationInputs([]).baseDate).toBe("2026-07-16");
  });

  it("Monday 08:30 KST resolves to Monday, not Sunday (the swap-exclusion scenario)", () => {
    // 2026-07-19T23:30Z == Monday 2026-07-20 08:30 KST. The UTC derivation
    // returned Sunday 2026-07-19 → NonBusinessDayError → 스왑 제외.
    at("2026-07-19T23:30:00Z");
    expect(todayInSeoul()).toBe("2026-07-20");
  });

  it("still filters matured swaps against the Seoul-resolved base date", () => {
    at("2026-07-15T23:30:00Z"); // Seoul 2026-07-16
    const swap = {
      id: "m1", name: "IRS", sector: "IRS", book: "Trading",
      startDate: "2025-07-16",
      maturityDate: "2026-07-16", // matures ON the Seoul base date → excluded from positions
      notionalKrwEok: 100, fixedRate: 3.0, payFixed: false,
    };
    const inputs = buildSimulationInputs([], [swap]);
    expect(inputs.positions).toHaveLength(0);
  });
});
