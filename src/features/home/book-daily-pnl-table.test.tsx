// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import type { PeriodPnlFigure, PeriodPnlResponse } from "@/lib/api-types";

/**
 * Browser-free render check for the Daily P&L panel's period-comparison ribbon
 * (WTD/MTD/YTD vs prior week/month/year-end close). Both hooks are mocked at
 * the module boundary; the point is the ribbon's honesty rules -- blank is
 * never 0, partial figures carry ‡, every figure names its baseline date, and
 * the revaluation caveat is always on screen with the figures.
 */

const mockAnalytics = vi.fn();
const mockPeriodPnl = vi.fn();
const mockRange = vi.fn();

vi.mock("@/hooks/use-portfolio-analytics", () => ({
  usePortfolioAnalytics: () => mockAnalytics(),
}));
vi.mock("@/hooks/use-period-pnl", () => ({
  usePeriodPnl: () => mockPeriodPnl(),
}));
// T2b: the panel's date control reads the range for its steppers/bounds.
vi.mock("@/hooks/use-api", () => ({
  useMarketDataRange: () => mockRange(),
}));

const { BookDailyPnlTable } = await import("./book-daily-pnl-table");
const { useHomeDateStore } = await import("@/stores/home-date-store");

/** T2b range fixture: latest close 07-15; 07-11/07-12 are a weekend gap. */
const RANGE = {
  min_date: "2026-07-10",
  max_date: "2026-07-15",
  available_dates: ["2026-07-10", "2026-07-13", "2026-07-14", "2026-07-15"],
};

function fig(over: Partial<PeriodPnlFigure> = {}): PeriodPnlFigure {
  return {
    baseline_date: "2026-07-10",
    pnl: 12_345_678,
    included_positions: 230,
    excluded_not_held: 43,
    excluded_unpriceable: 0,
    complete: true,
    ...over,
  };
}

const PERIOD: PeriodPnlResponse = {
  as_of: "2026-07-15",
  rows: [
    { book: "RP Fund", wtd: fig(), mtd: fig(), ytd: fig() },
    {
      book: "Total",
      wtd: fig(),
      mtd: fig({ baseline_date: "2026-06-30", pnl: -98_700_000 }),
      // The blank case: baseline predates all market data.
      ytd: fig({ baseline_date: null, pnl: null, complete: false }),
    },
  ],
};

const DAILY = {
  as_of: "2026-07-16",
  quote_sources: [
    { source: "IRS", latest: "2026-07-15", has_as_of: false },
    { source: "Credit Matrix", latest: "2026-07-16", has_as_of: true },
  ],
  daily_pnl: { total: 1, mtm: 1, theta: 0, mtm_complete: true },
  by_book: [
    { book: "RP Fund", theta: 5, mtm: 3, total: 8, funding: -1, mtm_complete: true },
    { book: "Total", theta: 5, mtm: 3, total: 8, funding: -1, mtm_complete: true },
  ],
};

function analytics(over: Record<string, unknown> = {}) {
  mockAnalytics.mockReturnValue({
    hasPositions: true,
    bookDailyPnl: DAILY,
    bookDailyPnlLoading: false,
    bookDailyPnlError: false,
    // T2b: the resolved close the daily request priced off (latest by default).
    dailyPnlCloseDate: RANGE.max_date,
    ...over,
  });
  mockRange.mockReturnValue({ data: RANGE });
}

function period(over: Record<string, unknown> = {}) {
  mockPeriodPnl.mockReturnValue({
    periodPnl: PERIOD,
    periodPnlLoading: false,
    periodPnlError: false,
    ...over,
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useHomeDateStore.setState({ dailyPnlCloseDate: null });
});

describe("BookDailyPnlTable period ribbon", () => {
  it("shows the three comparisons with sign and their resolved baseline dates", () => {
    analytics();
    period();
    render(<BookDailyPnlTable />);

    expect(screen.getByText("WTD")).toBeDefined();
    expect(screen.getByText("MTD")).toBeDefined();
    expect(screen.getByText("YTD")).toBeDefined();
    // Total row's figures, not RP Fund's; sign prefix on positives.
    expect(screen.getByText(/\+12\.3M/)).toBeDefined();
    expect(screen.getByText(/-98\.7M/)).toBeDefined();
    expect(screen.getByText("vs 2026-07-10")).toBeDefined();
    expect(screen.getByText("vs 2026-06-30")).toBeDefined();
  });

  it("renders an unknown figure as an em-dash, never 0", () => {
    analytics();
    period();
    render(<BookDailyPnlTable />);

    // YTD's baseline predates all data: em-dash + "기준일 없음", and no zero
    // masquerading as a figure anywhere on the ribbon.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("기준일 없음")).toBeDefined();
    expect(screen.queryByText(/^\+?0(\.0)?[MB]?$/)).toBeNull();
  });

  it("marks a partial figure with the same ‡ the daily table uses", () => {
    analytics();
    period({
      periodPnl: {
        as_of: "2026-07-15",
        rows: [{
          book: "Total",
          wtd: fig({ pnl: 5_000_000, excluded_unpriceable: 2, complete: false }),
          mtd: fig(),
          ytd: fig(),
        }],
      },
    });
    render(<BookDailyPnlTable />);
    expect(screen.getByText(/\+5\.0M/).textContent).toContain("‡");
  });

  it("always carries the revaluation caveat alongside the figures", () => {
    analytics();
    period();
    render(<BookDailyPnlTable />);
    expect(
      screen.getByText(/현재 보유\s+채권을 각 기준일 시장데이터로 재평가/),
    ).toBeDefined();
    expect(screen.getByText(/실현 손익이 아니라/)).toBeDefined();
  });

  it("omits the ribbon entirely when no bonds are schedulable (query disabled)", () => {
    analytics();
    period({ periodPnl: undefined, periodPnlLoading: false, periodPnlError: false });
    render(<BookDailyPnlTable />);

    expect(screen.queryByText("WTD")).toBeNull();
    expect(screen.queryByText(/실현 손익이 아니라/)).toBeNull();
    // The daily table itself is untouched by the ribbon's absence.
    expect(screen.getByText("Daily P&L by Book")).toBeDefined();
  });

  it("surfaces a ribbon fetch failure without killing the daily table", () => {
    analytics();
    period({ periodPnl: undefined, periodPnlError: true });
    render(<BookDailyPnlTable />);

    expect(screen.getByText(/기간 손익을 불러오지 못했습니다/)).toBeDefined();
    expect(screen.getByText("Daily P&L by Book")).toBeDefined();
  });
});

/**
 * s16 column-integrity fixtures. The pre-s16 blind spot: every fixture was a
 * COMPLETE day, but the misalignment only exists in the PARTIAL (blank-MtM)
 * state — Blueprint Tooltip's shrink-to-fit inline target parked the blank
 * MtM dash and the partial ‡-Total at their cells' LEFT edge, so the whole
 * row read as shifted one column left. Assertions here map cells to columns
 * BY HEADER (never reading order) and pin the fix's mechanism (`fill` target
 * + td-owned right alignment), for both the per-book and the Total row.
 */

/** Daily-response builder with distinct per-column values so any cell/column
 * shift produces a mismatch somewhere. */
function daily(partial: boolean) {
  const row = partial
    ? { theta: 270_100_000, mtm: null, total: 270_100_000, funding: -10_300_000, mtm_complete: false }
    : { theta: 1_100_000, mtm: 2_200_000, total: 3_300_000, funding: -4_400_000, mtm_complete: true };
  return {
    as_of: "2026-07-16",
    quote_sources: [
      { source: "IRS", latest: "2026-07-15", has_as_of: !partial },
      { source: "Credit Matrix", latest: "2026-07-14", has_as_of: !partial },
    ],
    daily_pnl: { ...row },
    by_book: [
      { book: "RP Fund", ...row },
      { book: "Total", ...row },
    ],
  };
}

/** The daily table, its header→index map, and a by-book row lookup. */
function grabTable(container: HTMLElement) {
  const table = container.querySelector("table")!;
  expect(table).not.toBeNull();
  const headers = [...table.tHead!.rows[0].cells].map((th) => th.textContent?.trim());
  // [CHANGED, F1] Funding moved BEFORE Total (owner ruling: Total includes it).
  expect(headers).toEqual(["Book", "Theta", "MtM", "Funding", "Total"]);
  const col = (name: string) => headers.indexOf(name);
  const bodyRows = [...table.tBodies].flatMap((tb) => [...tb.rows]);
  const rowFor = (book: string) => {
    const r = bodyRows.find((row) => row.cells[col("Book")].textContent?.trim() === book);
    expect(r, `row for book ${book}`).toBeDefined();
    return r!;
  };
  return { table, col, rowFor };
}

const cellText = (row: HTMLTableRowElement, i: number) => row.cells[i].textContent?.trim();

describe("BookDailyPnlTable daily table column integrity (s16)", () => {
  it("complete day: every value sits under its own header, no ‡, no blanks", () => {
    analytics({ bookDailyPnl: daily(false) });
    period();
    const { container } = render(<BookDailyPnlTable />);
    const { col, rowFor } = grabTable(container);

    for (const book of ["RP Fund", "Total"]) {
      const row = rowFor(book);
      expect(cellText(row, col("Theta"))).toBe("+1.1M");
      expect(cellText(row, col("MtM"))).toBe("+2.2M");
      expect(cellText(row, col("Funding"))).toBe("-4.4M");
      // [CHANGED, F1] Total = Theta + MtM + Funding = 1.1 + 2.2 − 4.4 = −1.1M
      // (was +3.3M when funding sat outside Total).
      expect(cellText(row, col("Total"))).toBe("-1.1M");
    }
    expect(screen.queryByText(/‡ Partial/)).toBeNull();
  });

  it("partial day: MtM renders — in its OWN column, Total keeps the ‡, no shift", () => {
    analytics({ bookDailyPnl: daily(true) });
    period();
    const { container } = render(<BookDailyPnlTable />);
    const { col, rowFor } = grabTable(container);

    for (const book of ["RP Fund", "Total"]) {
      const row = rowFor(book);
      // The defect crammed the dash into Theta ("+270.1M—") and pushed the
      // ‡-Total under MtM, leaving Total empty. Assert each cell exactly.
      expect(cellText(row, col("Theta"))).toBe("+270.1M");
      expect(cellText(row, col("MtM"))).toBe("—");
      expect(cellText(row, col("Funding"))).toBe("-10.3M");
      // [CHANGED, F1] partial Total now includes funding: 270.1 − 10.3 = 259.8M‡.
      expect(cellText(row, col("Total"))).toBe("+259.8M‡");
    }
    // Footnote referent: ‡ belongs to Total and names the stale sources.
    expect(screen.getByText(/‡ Partial — excludes MtM from IRS \/ Credit Matrix/)).toBeDefined();
  });

  it("pins the mechanism: tooltip targets fill their cell and tds own right alignment", () => {
    analytics({ bookDailyPnl: daily(true) });
    period();
    const { container } = render(<BookDailyPnlTable />);
    const { col, rowFor } = grabTable(container);

    const row = rowFor("RP Fund");
    for (const name of ["MtM", "Total"] as const) {
      const wrapper = row.cells[col(name)].firstElementChild!;
      // Blueprint's default target is a shrink-to-fit inline SPAN — that's
      // what shifted the row. `fill` renders the target as a block-level DIV
      // (fills the td) and stamps bp5-fill on the cloned child.
      expect(wrapper.classList.contains("bp5-popover-target"), `${name} tooltip target`).toBe(true);
      expect(wrapper.tagName, `${name} target must be the block-level fill div`).toBe("DIV");
      expect(
        wrapper.firstElementChild?.classList.contains("bp5-fill"),
        `${name} cell content must carry bp5-fill`,
      ).toBe(true);
    }
    // ...and the td itself owns the alignment, so a future shrink-wrapped
    // child still lands at the right edge of its own column.
    for (const name of ["Theta", "MtM", "Total", "Funding"] as const) {
      expect(row.cells[col(name)].className, `${name} td alignment`).toContain("text-right");
    }
    // The tooltips still exist (honesty rules): blank-MtM and partial-Total
    // both explain themselves on hover.
    expect(within(row.cells[col("MtM")]).getByText("—")).toBeDefined();
  });
});

/**
 * HARDEN-1 — 채권/스왑 class sub-rows (owner feedback). The split re-groups
 * the SAME legs, so per column bond+swap must display as summing to the book
 * row; blank policy and the s16 fill/text-right mechanism apply per class.
 */
function dailyWithClasses() {
  const bond = { theta: 1_100_000, mtm: 2_200_000, total: 3_300_000, funding: -1_100_000, mtm_complete: true };
  // Swap source (IRS) stale: MtM unknown → class total is theta-only, partial.
  const swap = { theta: 4_400_000, mtm: null, total: 4_400_000, funding: -3_300_000, mtm_complete: false };
  return {
    as_of: "2026-07-16",
    quote_sources: [
      { source: "IRS", latest: "2026-07-15", has_as_of: false },
      { source: "Credit Matrix", latest: "2026-07-16", has_as_of: true },
    ],
    daily_pnl: { total: 7_700_000, mtm: 2_200_000, theta: 5_500_000, mtm_complete: false },
    by_book: [
      {
        book: "RP Fund",
        theta: 5_500_000, mtm: 2_200_000, total: 7_700_000, funding: -4_400_000,
        mtm_complete: false,
        by_class: { bond, swap },
      },
      // Legacy-shaped row (no by_class): must render with no sub-rows.
      { book: "Total", theta: 5_500_000, mtm: 2_200_000, total: 7_700_000, funding: -4_400_000, mtm_complete: false },
    ],
  };
}

describe("BookDailyPnlTable 채권/스왑 sub-rows (HARDEN-1)", () => {
  it("renders class sub-rows whose cells sum to the book row, column by column", () => {
    analytics({ bookDailyPnl: dailyWithClasses() });
    period();
    const { container } = render(<BookDailyPnlTable />);
    const { col, rowFor } = grabTable(container);

    const bond = rowFor("채권");
    const swap = rowFor("스왑");
    const book = rowFor("RP Fund");

    // bond + swap == book, as displayed: theta 1.1M + 4.4M = 5.5M,
    // funding -1.1M + -3.3M = -4.4M.
    // [CHANGED, F1] each Total includes its own funding: bond 3.3−1.1 = 2.2M,
    // swap 4.4−3.3 = 1.1M‡, book 7.7−4.4 = 3.3M‡ — sub-rows still sum to the
    // book row per column.
    expect(cellText(bond, col("Theta"))).toBe("+1.1M");
    expect(cellText(swap, col("Theta"))).toBe("+4.4M");
    expect(cellText(book, col("Theta"))).toBe("+5.5M");
    expect(cellText(bond, col("Funding"))).toBe("-1.1M");
    expect(cellText(swap, col("Funding"))).toBe("-3.3M");
    expect(cellText(book, col("Funding"))).toBe("-4.4M");
    expect(cellText(bond, col("Total"))).toBe("+2.2M");
    expect(cellText(book, col("Total"))).toBe("+3.3M‡");
  });

  it("applies the blank policy per class: bond keeps its MtM, swap shows — and ‡", () => {
    analytics({ bookDailyPnl: dailyWithClasses() });
    period();
    const { container } = render(<BookDailyPnlTable />);
    const { col, rowFor } = grabTable(container);

    const bond = rowFor("채권");
    const swap = rowFor("스왑");
    expect(cellText(bond, col("MtM"))).toBe("+2.2M");
    expect(cellText(swap, col("MtM"))).toBe("—");
    // [CHANGED, F1] Totals include own funding: swap 4.4−3.3, book 7.7−4.4.
    expect(cellText(swap, col("Total"))).toBe("+1.1M‡");
    // Book row stays partial (unchanged semantics).
    expect(cellText(rowFor("RP Fund"), col("Total"))).toBe("+3.3M‡");
  });

  it("renders NO sub-rows for a row without by_class (legacy responses)", () => {
    analytics({ bookDailyPnl: dailyWithClasses() });
    period();
    const { container } = render(<BookDailyPnlTable />);
    const table = container.querySelector("table")!;
    const labels = [...table.tBodies].flatMap((tb) => [...tb.rows]).map(
      (r) => r.cells[0].textContent?.trim(),
    );
    // Exactly one 채권 and one 스왑 sub-row (RP Fund's); Total has none.
    expect(labels.filter((l) => l === "채권").length).toBe(1);
    expect(labels.filter((l) => l === "스왑").length).toBe(1);
  });

  it("extends the s16 mechanism to sub-rows: fill tooltip targets + td-owned right alignment", () => {
    analytics({ bookDailyPnl: dailyWithClasses() });
    period();
    const { container } = render(<BookDailyPnlTable />);
    const { col, rowFor } = grabTable(container);

    const swap = rowFor("스왑");
    for (const name of ["MtM", "Total"] as const) {
      const wrapper = swap.cells[col(name)].firstElementChild!;
      expect(wrapper.classList.contains("bp5-popover-target"), `${name} tooltip target`).toBe(true);
      expect(wrapper.tagName, `${name} target must be the block-level fill div`).toBe("DIV");
      expect(
        wrapper.firstElementChild?.classList.contains("bp5-fill"),
        `${name} cell content must carry bp5-fill`,
      ).toBe(true);
    }
    for (const name of ["Theta", "MtM", "Total", "Funding"] as const) {
      expect(swap.cells[col(name)].className, `${name} td alignment`).toContain("text-right");
    }
  });
});

/**
 * R3B-PLUS T2b — past-date picker. The control writes home-date-store's
 * dailyPnlCloseDate; use-portfolio-analytics (mocked here) turns that into the
 * request. These pins cover the panel's own responsibilities: stepping over
 * available_dates only, the reset chip appearing only for an explicit pick,
 * the header still labeling itself with the BACKEND's as_of (T), and the
 * period ribbon giving way to the honesty note on a past view.
 */
describe("BookDailyPnlTable past-date picker (T2b)", () => {
  it("at the latest close: date field shows it, ▶ is disabled, no reset chip, ribbon intact", () => {
    analytics();
    period();
    render(<BookDailyPnlTable />);

    expect((screen.getByLabelText("평가 종가일") as HTMLInputElement).value).toBe("2026-07-15");
    // ▶ has nowhere to go from the latest close; ◀ is live.
    expect((screen.getByLabelText("다음 영업일") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("이전 영업일") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText("오늘로")).toBeNull();
    expect(screen.getByText("WTD")).toBeDefined();
    expect(screen.queryByText(/과거 시점 조회 중/)).toBeNull();
  });

  it("◀ steps to the previous AVAILABLE date, skipping the weekend gap", () => {
    analytics({ dailyPnlCloseDate: "2026-07-13" });
    period();
    render(<BookDailyPnlTable />);

    fireEvent.click(screen.getByLabelText("이전 영업일"));
    // From 07-13 the previous available date is 07-10 — never 07-12/07-11.
    expect(useHomeDateStore.getState().dailyPnlCloseDate).toBe("2026-07-10");
  });

  it("▶ steps forward over available dates from a past view", () => {
    useHomeDateStore.setState({ dailyPnlCloseDate: "2026-07-13" });
    analytics({ dailyPnlCloseDate: "2026-07-13" });
    period();
    render(<BookDailyPnlTable />);

    fireEvent.click(screen.getByLabelText("다음 영업일"));
    expect(useHomeDateStore.getState().dailyPnlCloseDate).toBe("2026-07-14");
  });

  it("past view: header keeps the backend's as_of, ribbon yields to the honesty note, 오늘로 resets", () => {
    useHomeDateStore.setState({ dailyPnlCloseDate: "2026-07-14" });
    analytics({
      dailyPnlCloseDate: "2026-07-14",
      bookDailyPnl: { ...DAILY, as_of: "2026-07-15" },
    });
    period();
    render(<BookDailyPnlTable />);

    // The displayed date is the server-derived T for the picked close — not
    // the picked close itself (that would read one business day off).
    expect(screen.getByText("2026-07-15")).toBeDefined();
    // WTD/MTD/YTD are anchored to the CURRENT close server-side; under a
    // historical header they'd be mislabeled, so the note replaces them.
    expect(screen.queryByText("WTD")).toBeNull();
    expect(screen.getByText(/과거 시점 조회 중/)).toBeDefined();

    fireEvent.click(screen.getByText("오늘로"));
    expect(useHomeDateStore.getState().dailyPnlCloseDate).toBeNull();
  });

  it("renders no date control without positions (nothing to price)", () => {
    analytics({ hasPositions: false, bookDailyPnl: undefined });
    period({ periodPnl: undefined });
    render(<BookDailyPnlTable />);
    expect(screen.queryByLabelText("평가 종가일")).toBeNull();
  });
});
