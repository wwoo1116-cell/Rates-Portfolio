// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/**
 * The N-1/N-2 regression guard: the PVBP matrix must draw EVERY tenor bucket
 * the backend emits. The old 9-column subset hid 98.9% of bond KRD mass
 * (국고채's whole 4Y book, 통안채's 1.5Y) and made the IRS row look ~12,255k
 * short of its own Total. These tests pin the payload -> rendered mapping:
 * visible cells must reconcile to the Total column for every row.
 */

const mockAnalytics = vi.fn();

vi.mock("@/hooks/use-portfolio-analytics", () => ({
  usePortfolioAnalytics: () => mockAnalytics(),
}));

const { PvbpSensitivityTable, TENOR_COLS } = await import("./pvbp-sensitivity-table");

/** The backend's _TENOR_COLUMNS, verbatim (portfolio_analytics_service.py).
 * If this fails, the FE column set has forked from the BE bucket set -- the
 * exact defect that hid 7 of 16 columns. */
const BACKEND_TENOR_COLUMNS = [
  "1D", "3M", "6M", "9M", "1Y", "1.5Y", "2Y", "3Y",
  "4Y", "5Y", "6Y", "7Y", "8Y", "9Y", "10Y", "30Y",
];

/** Build a row whose `total` is the sum of its buckets by construction --
 * exactly what the API guarantees (its matrix reconciles with zero residual).
 * Values are exact multiples of 1,000 so the rendered "…k" text is lossless
 * and the rendered-level reconciliation below is exact, not approximate. */
function row(sector: string, buckets: Record<string, number>) {
  const r: Record<string, unknown> = { sector };
  for (const c of BACKEND_TENOR_COLUMNS) r[c] = buckets[c] ?? 0;
  r.total = BACKEND_TENOR_COLUMNS.reduce((s, c) => s + ((r[c] as number) ?? 0), 0);
  return r as { sector: string; total: number } & Record<string, number>;
}

// Echoes the shape of the live book (s4 evidence): 국고채 entirely in the
// formerly hidden 4Y bucket, 통안채 entirely in hidden 1.5Y, IRS with paying
// mass in hidden buckets -- plus spread-out 시은채 for an ordinary row.
const ROWS = [
  row("국고채", { "4Y": 29_278_000 }),
  row("통안채", { "1.5Y": 1_007_000 }),
  row("시은채", { "3M": 55_000, "9M": 61_432_000, "2Y": 8_120_000, "30Y": 4_000 }),
  row("IRS", { "3M": 3_353_000, "9M": -5_113_000, "1.5Y": -7_142_000, "5Y": 1_500_000 }),
];
const TOTAL_ROW = row("합계", Object.fromEntries(
  BACKEND_TENOR_COLUMNS.map((c) => [c, ROWS.reduce((s, r) => s + r[c], 0)]),
));
const PAYLOAD = [...ROWS, TOTAL_ROW];

function loaded(payload: unknown[] = PAYLOAD) {
  mockAnalytics.mockReturnValue({
    hasPositions: true,
    closeDate: "2026-07-15",
    pvbpSensitivity: payload,
    pvbpLoading: false,
    pvbpError: false,
  });
}

/** "+29,278k" | "-5,113k" | "—" -> raw ₩ number. */
function parseCell(text: string): number {
  if (text.trim() === "—") return 0;
  return Number(text.replace(/[+,k]/g, "")) * 1000;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PvbpSensitivityTable full tenor coverage", () => {
  it("draws the backend's 16 tenor buckets, in the backend's order", () => {
    expect([...TENOR_COLS]).toEqual(BACKEND_TENOR_COLUMNS);

    loaded();
    render(<PvbpSensitivityTable />);
    for (const c of BACKEND_TENOR_COLUMNS) {
      expect(screen.getByRole("columnheader", { name: c })).toBeDefined();
    }
  });

  it("reconciles every row: the drawn cells sum exactly to the Total column", () => {
    // Mapping level: no bucket key of the payload falls outside the drawn set,
    // so the drawn cells provably account for the whole Total.
    for (const r of PAYLOAD) {
      const bucketKeys = Object.keys(r).filter((k) => k !== "sector" && k !== "total");
      expect(bucketKeys.every((k) => (TENOR_COLS as readonly string[]).includes(k))).toBe(true);
      const visibleSum = (TENOR_COLS as readonly string[]).reduce(
        (s, c) => s + ((r as Record<string, number>)[c] ?? 0), 0,
      );
      expect(visibleSum).toBe((r as { total: number }).total);
    }

    // Rendered level: parse what the user actually sees.
    loaded();
    const { container } = render(<PvbpSensitivityTable />);
    const trs = Array.from(container.querySelectorAll("tbody tr"));
    expect(trs).toHaveLength(PAYLOAD.length);
    for (const tr of trs) {
      const tds = Array.from(tr.querySelectorAll("td"));
      expect(tds).toHaveLength(1 + TENOR_COLS.length + 1); // sector + 16 + Total
      const cellSum = tds.slice(1, -1).reduce((s, td) => s + parseCell(td.textContent ?? ""), 0);
      const total = parseCell(tds[tds.length - 1].textContent ?? "");
      expect(cellSum).toBe(total);
    }
  });

  it("shows the formerly hidden bond risk (국고채 4Y, 통안채 1.5Y) as cells, not a footnote", () => {
    loaded();
    const { container } = render(<PvbpSensitivityTable />);
    // Cell-position-precise: the value must be IN the tenor column, not just
    // somewhere in the row (a single-bucket row's Total shows the same figure).
    const cellAt = (rowIdx: number, tenor: string) => {
      const tds = container.querySelectorAll("tbody tr")[rowIdx].querySelectorAll("td");
      return tds[1 + (TENOR_COLS as readonly string[]).indexOf(tenor)].textContent;
    };
    expect(cellAt(0, "4Y")).toBe("+29,278k");   // 국고채
    expect(cellAt(1, "1.5Y")).toBe("+1,007k");  // 통안채
    expect(cellAt(3, "9M")).toBe("-5,113k");    // IRS
    // Nothing is hidden anymore, so the disclosure footnote must be gone.
    expect(screen.queryByText(/buckets missing from/)).toBeNull();
    expect(screen.queryByText(/buckets not shown/)).toBeNull();
  });

  it("keeps the credit-quality row order: 국고채 first, IRS after credits, 합계 last", () => {
    loaded();
    const { container } = render(<PvbpSensitivityTable />);
    const sectors = Array.from(container.querySelectorAll("tbody tr td:first-child")).map(
      (td) => td.textContent,
    );
    expect(sectors).toEqual(["국고채", "통안채", "시은채", "IRS", "합계"]);
  });

  it("dead-man switch: a backend bucket this table doesn't know gets disclosed by name", () => {
    // Simulate the backend growing a 17th bucket. The table can't draw it,
    // but it must say so instead of silently understating Total again.
    const withExtra = PAYLOAD.map((r) => ({ ...r }));
    (withExtra[0] as Record<string, unknown>)["50Y"] = 2_000_000;
    (withExtra[0] as { total: number }).total += 2_000_000;
    const gt = withExtra[withExtra.length - 1] as Record<string, number>;
    gt["50Y"] = 2_000_000;
    gt.total += 2_000_000;

    loaded(withExtra);
    render(<PvbpSensitivityTable />);
    const note = screen.getByText(/buckets missing from/);
    expect(note.textContent).toContain("+2,000k");
    expect(note.textContent).toContain("50Y");
    expect(note.textContent).toContain("update TENOR_COLS");
  });
});
