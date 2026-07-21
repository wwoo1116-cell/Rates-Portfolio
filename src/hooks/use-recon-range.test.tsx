// @vitest-environment jsdom
/**
 * RECON2-RH retention pins on the range hook — the Δbp series' data
 * contract: each row RETAINS the exact object the loop's single
 * deltaBpByTenor call produced (same object identity, not a recompute), on
 * every window-matched day (including days whose closure footer is disabled);
 * a window-mismatch day retains nothing (whitespace downstream, never zero).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

import { TENOR_COLS } from "@/features/home/pvbp-sensitivity-table";
import * as reconMath from "@/lib/daily-recon-math";

// Spy that WRAPS the real implementation — results are real maps, and the
// retention pin can compare object identity against spy.mock.results.
vi.mock("@/lib/daily-recon-math", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/daily-recon-math")>();
  return { ...actual, deltaBpByTenor: vi.fn(actual.deltaBpByTenor) };
});

const DATES = ["2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16"];

function snap(date: string, cd: number) {
  return {
    valuation_date: date,
    cd_rate: cd,
    on_rate: null,
    swap_quotes: [{ tenor_years: 3, tenor_months: null, rate: cd + 0.002 }],
  };
}
const SNAPSHOTS: Record<string, ReturnType<typeof snap>> = {
  "2026-07-13": snap("2026-07-13", 0.026),
  "2026-07-14": snap("2026-07-14", 0.0262),
  "2026-07-15": snap("2026-07-15", 0.0262),
  "2026-07-16": snap("2026-07-16", 0.0265),
};

const PVBP_ROWS = [
  { sector: "국고채", "3Y": 1_000_000, total: 1_000_000 },
  { sector: "합계", "3Y": 1_000_000, total: 1_000_000 },
];

// Pair (13→14): complete → full row. Pair (14→15): realized incomplete →
// footer disabled BUT Δbp retained. Pair (15→16): server as_of mismatch →
// no Δbp at all.
const bookDailyPnl = vi.fn(async (req: { valuation_date: string }) => {
  const close = req.valuation_date;
  if (close === "2026-07-15") {
    return { as_of: "2026-07-20", by_book: [] }; // window mismatch
  }
  const asOf = close === "2026-07-13" ? "2026-07-14" : "2026-07-15";
  const complete = close === "2026-07-13";
  return {
    as_of: asOf,
    by_book: [
      {
        book: "Total",
        by_class: {
          bond: { mtm: complete ? -500_000 : null, mtm_complete: complete },
          swap: { mtm: 200_000, mtm_complete: true },
        },
      },
    ],
  };
});
const pvbpSensitivity = vi.fn(async () => PVBP_ROWS);
const snapshot = vi.fn(async (d: string) => SNAPSHOTS[d]);

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    marketDataApi: { ...actual.marketDataApi, snapshot: (d: string) => snapshot(d) },
    portfolioAnalyticsApi: {
      ...actual.portfolioAnalyticsApi,
      bookDailyPnl: (r: never) => bookDailyPnl(r),
      pvbpSensitivity: () => pvbpSensitivity(),
    },
  };
});
vi.mock("@/hooks/use-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-api")>()),
  useMarketDataRange: () => ({
    data: { min_date: DATES[0], max_date: DATES[3], available_dates: DATES },
  }),
}));
vi.mock("@/hooks/use-portfolio-analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-portfolio-analytics")>()),
  useCombinedPositions: () => [{ id: "B1", sector: "국고채" }],
}));
vi.mock("@/stores/settings-store", () => ({
  useSettingsStore: (sel: (s: { fundingSpreadBp: number }) => unknown) =>
    sel({ fundingSpreadBp: 10 }),
}));

const { useReconRange } = await import("./use-recon-range");

const deltaSpy = reconMath.deltaBpByTenor as ReturnType<typeof vi.fn>;

beforeEach(() => {
  deltaSpy.mockClear();
  snapshot.mockClear();
  bookDailyPnl.mockClear();
  pvbpSensitivity.mockClear();
});
afterEach(cleanup);

async function runRange() {
  const hook = renderHook(() => useReconRange());
  await act(async () => {
    hook.result.current.run();
  });
  await waitFor(() => expect(hook.result.current.rows?.length).toBe(3));
  await waitFor(() => expect(hook.result.current.running).toBe(false));
  return hook.result.current.rows!;
}

describe("useReconRange Δbp retention (RECON2-RH)", () => {
  it("retains the EXACT deltaBpByTenor result object on window-matched rows — same object, not a recompute", async () => {
    const rows = await runRange();
    expect(rows.length).toBe(3);

    // Two window-matched days → exactly two deltaBpByTenor calls, and each
    // row holds that call's RESULT OBJECT by identity.
    expect(deltaSpy).toHaveBeenCalledTimes(2);
    expect(rows[0].deltaBp).toBe(deltaSpy.mock.results[0].value);
    expect(rows[1].deltaBp).toBe(deltaSpy.mock.results[1].value);
  });

  it("the retained map is byte-equal to the single-date M2 computation for the same snapshots", async () => {
    const rows = await runRange();
    // Independent invocation of the same pure function over the same
    // snapshots — what the single-date M2 row renders for this date.
    const expected = reconMath.deltaBpByTenor(
      TENOR_COLS,
      SNAPSHOTS["2026-07-13"],
      SNAPSHOTS["2026-07-14"],
    );
    expect(rows[0].deltaBp).toEqual(expected);
    // The mapped pillars carry real numbers; unmapped stay null (1D here).
    expect(rows[0].deltaBp!["3M"]).toBeCloseTo(2.0, 10);
    expect(rows[0].deltaBp!["1D"]).toBeNull();
  });

  it("a footer-disabled day (incomplete realized) still retains Δbp — the series is snapshot-derived", async () => {
    const rows = await runRange();
    expect(rows[1].note).toContain("미완성");
    expect(rows[1].assumed).not.toBeNull();
    expect(rows[1].deltaBp).toBeDefined();
  });

  it("a window-mismatch day retains NO Δbp (whitespace downstream, never zero)", async () => {
    const rows = await runRange();
    expect(rows[2].note).toContain("창 불일치로 제외");
    expect(rows[2].deltaBp).toBeUndefined();
  });
});
