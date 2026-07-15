// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

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

vi.mock("@/hooks/use-portfolio-analytics", () => ({
  usePortfolioAnalytics: () => mockAnalytics(),
}));
vi.mock("@/hooks/use-period-pnl", () => ({
  usePeriodPnl: () => mockPeriodPnl(),
}));

const { BookDailyPnlTable } = await import("./book-daily-pnl-table");

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
    ...over,
  });
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
