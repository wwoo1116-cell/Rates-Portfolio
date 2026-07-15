// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import type { AllocationHistoryResponse } from "@/lib/api-types";

/**
 * Browser-free render check for Home's merged Portfolio Overview panel. Both
 * hooks are mocked at the module boundary -- the point here is the panel's own
 * branching and layout (ribbon, the two charts, the revaluation caveat, the
 * skeleton), not the fetching, which the backend suite covers.
 */

const mockAnalytics = vi.fn();
const mockAllocation = vi.fn();

vi.mock("@/hooks/use-portfolio-analytics", () => ({
  usePortfolioAnalytics: () => mockAnalytics(),
}));
vi.mock("@/hooks/use-allocation-history", () => ({
  useAllocationHistory: () => mockAllocation(),
}));

const { PortfolioOverview } = await import("./portfolio-overview");

const ALLOCATION: AllocationHistoryResponse = {
  asOfDate: "2026-07-06",
  totalPositions: 3,
  unpriceablePositions: 0,
  sector: {
    keys: ["시은채", "공사채"],
    rows: [
      { key: "lastYearEnd", label: "Last Year-End", valuationDate: null, positionCount: 0, 시은채: 0, 공사채: 0 },
      { key: "lastMonthEnd", label: "Last Month-End", valuationDate: "2026-06-30", positionCount: 3, 시은채: 60, 공사채: 40 },
      { key: "lastWeekEnd", label: "Last Week-End", valuationDate: "2026-07-03", positionCount: 3, 시은채: 61, 공사채: 39 },
      { key: "prevDay", label: "Yesterday", valuationDate: "2026-07-03", positionCount: 3, 시은채: 61, 공사채: 39 },
      { key: "current", label: "Current", valuationDate: "2026-07-06", positionCount: 3, 시은채: 62, 공사채: 38 },
    ],
  },
  maturity: {
    keys: ["단기(1년 미만)", "중기(1~3년)"],
    rows: [
      { key: "lastYearEnd", label: "Last Year-End", valuationDate: null, positionCount: 0, "단기(1년 미만)": 0, "중기(1~3년)": 0 },
      { key: "lastMonthEnd", label: "Last Month-End", valuationDate: "2026-06-30", positionCount: 3, "단기(1년 미만)": 30, "중기(1~3년)": 70 },
      { key: "lastWeekEnd", label: "Last Week-End", valuationDate: "2026-07-03", positionCount: 3, "단기(1년 미만)": 31, "중기(1~3년)": 69 },
      { key: "prevDay", label: "Yesterday", valuationDate: "2026-07-03", positionCount: 3, "단기(1년 미만)": 31, "중기(1~3년)": 69 },
      { key: "current", label: "Current", valuationDate: "2026-07-06", positionCount: 3, "단기(1년 미만)": 32, "중기(1~3년)": 68 },
    ],
  },
};

const BOOK_SUMMARY = [
  {
    book: "RP Fund",
    totalEvaluationAmount: 1.234e12,
    totalNotional: 5.4e11,
    weightedAvgYTM: 3.4567,
    hedgedDuration: 1.234,
  },
  { book: "Other", totalEvaluationAmount: 9e12, totalNotional: 9e12, weightedAvgYTM: 9, hedgedDuration: 9 },
];

function loaded() {
  mockAnalytics.mockReturnValue({
    hasPositions: true,
    bookSummary: BOOK_SUMMARY,
    bookSummaryLoading: false,
    bookSummaryError: false,
  });
  mockAllocation.mockReturnValue({
    hasPositions: true,
    allocation: ALLOCATION,
    allocationLoading: false,
    allocationError: false,
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PortfolioOverview", () => {
  it("puts RP Fund's four KPIs on the ribbon, reading the right book", () => {
    loaded();
    render(<PortfolioOverview />);

    expect(screen.getByText("평가금액")).toBeDefined();
    expect(screen.getByText("1.23조")).toBeDefined(); // not the "Other" book's 9조
    expect(screen.getByText("액면금액")).toBeDefined();
    expect(screen.getByText("5400.0억")).toBeDefined();
    expect(screen.getByText("평균 YTM")).toBeDefined();
    expect(screen.getByText("3.457%")).toBeDefined();
    expect(screen.getByText("헷지 듀레이션")).toBeDefined();
    expect(screen.getByText("1.23 Y")).toBeDefined();
  });

  it("renders both charts with their differing bases", () => {
    loaded();
    render(<PortfolioOverview />);

    expect(screen.getByText("섹터 배분")).toBeDefined();
    expect(screen.getByText("PVBP 기준")).toBeDefined();
    expect(screen.getByText("만기 배분")).toBeDefined();
    expect(screen.getByText("평가금액 기준")).toBeDefined();
  });

  it("shows all five columns even when an anchor collides or is unresolved", () => {
    loaded();
    render(<PortfolioOverview />);

    // Yesterday and Last Week-End are the same Friday here; both stay.
    expect(screen.getAllByText("Last Year-End")).toHaveLength(2); // one per chart
    expect(screen.getAllByText("Last Week-End")).toHaveLength(2);
    expect(screen.getAllByText("Yesterday")).toHaveLength(2);
    expect(screen.getAllByText("2026-07-03")).toHaveLength(4); // collided date, both charts
    expect(screen.getAllByText("Current")).toHaveLength(2);
  });

  it("renders an unresolved column as an empty placeholder, not a zero-height stack", () => {
    loaded();
    render(<PortfolioOverview />);
    // lastYearEnd has valuationDate: null in the fixture.
    expect(screen.getAllByText("No data")).toHaveLength(2);
  });

  it("always carries the revaluation caveat -- the columns are not position history", () => {
    loaded();
    render(<PortfolioOverview />);
    expect(
      screen.getByText(/현재 보유 종목을 해당\s+일자 시장데이터로 재평가/),
    ).toBeDefined();
  });

  it("shows the skeleton while loading rather than an empty panel", () => {
    mockAnalytics.mockReturnValue({
      hasPositions: true,
      bookSummary: undefined,
      bookSummaryLoading: true,
      bookSummaryError: false,
    });
    mockAllocation.mockReturnValue({
      hasPositions: true,
      allocation: undefined,
      allocationLoading: true,
      allocationError: false,
    });
    const { container } = render(<PortfolioOverview />);

    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(screen.queryByText("섹터 배분")).toBeNull();
  });

  it("prompts for an upload when there are no positions", () => {
    mockAnalytics.mockReturnValue({
      hasPositions: false,
      bookSummary: undefined,
      bookSummaryLoading: false,
      bookSummaryError: false,
    });
    mockAllocation.mockReturnValue({
      hasPositions: false,
      allocation: undefined,
      allocationLoading: false,
      allocationError: false,
    });
    render(<PortfolioOverview />);
    expect(screen.getByText(/Upload portfolio data/)).toBeDefined();
  });

  it("surfaces an error instead of rendering a misleading empty chart", () => {
    mockAnalytics.mockReturnValue({
      hasPositions: true,
      bookSummary: undefined,
      bookSummaryLoading: false,
      bookSummaryError: true,
    });
    mockAllocation.mockReturnValue({
      hasPositions: true,
      allocation: undefined,
      allocationLoading: false,
      allocationError: true,
    });
    render(<PortfolioOverview />);
    expect(screen.getByText(/Failed to load/)).toBeDefined();
    expect(screen.queryByText("섹터 배분")).toBeNull();
  });

  it("gives each series a distinct colour so adjacent segments stay readable", () => {
    loaded();
    const { container } = render(<PortfolioOverview />);
    const swatches = Array.from(container.querySelectorAll<HTMLElement>(".h-2.w-2"));
    const colours = swatches.map((s) => s.style.backgroundColor).filter(Boolean);
    expect(colours.length).toBeGreaterThanOrEqual(4); // 2 sectors + 2 buckets
    // Within one chart's legend the hues must not collide.
    expect(new Set(colours.slice(0, 2)).size).toBe(2);
    expect(new Set(colours.slice(2, 4)).size).toBe(2);
  });
});
