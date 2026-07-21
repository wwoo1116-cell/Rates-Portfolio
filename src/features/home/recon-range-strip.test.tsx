// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * RECON-DAILY range strip pins: lazy compute (nothing until 계산), honest
 * missing-figure rows (— + reason, never 0), signed formatting, and the
 * widen control's availability.
 */

const mockReconRange = vi.fn();
vi.mock("@/hooks/use-recon-range", () => ({
  useReconRange: () => mockReconRange(),
}));

// RECON2-RH — the Δbp chart is canvas-hosted; its own pins live in
// recon-deltabp-chart.test.tsx. Here we only pin the strip's view toggle.
const chartSpy = vi.fn();
vi.mock("./recon-deltabp-chart", () => ({
  ReconDeltaBpChart: (props: { rows: unknown }) => {
    chartSpy(props.rows);
    return <div data-testid="deltabp-chart" />;
  },
}));

const { ReconRangeStrip } = await import("./recon-range-strip");

function state(over: Record<string, unknown> = {}) {
  mockReconRange.mockReturnValue({
    rows: undefined,
    running: false,
    progress: null,
    error: null,
    windowSize: 20,
    maxWindow: 60,
    canRun: true,
    run: vi.fn(),
    widen: vi.fn(),
    ...over,
  });
}

// [CHANGED, FB3] rows carry the ladder terms (테타/예상) and the sign-fixed
// Assumed; identities: 예상 = 테타 + Assumed, 잔차 = Realized − 예상.
const ROWS = [
  {
    asOf: "2026-07-15",
    close: "2026-07-14",
    theta: 700_000,
    assumed: 1_000_000,
    expected: 1_700_000,
    realized: 200_000,
    residual: -1_500_000,
    residualPct: -750,
  },
  {
    asOf: "2026-07-16",
    close: "2026-07-15",
    theta: null,
    assumed: null,
    expected: null,
    realized: null,
    residual: null,
    residualPct: null,
    note: "서버 평가일 2026-07-20 ≠ 다음 가용일 — 창 불일치로 제외",
  },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ReconRangeStrip", () => {
  it("is lazy: shows the compute prompt and fires run() only on 계산", () => {
    const run = vi.fn();
    state({ run });
    render(<ReconRangeStrip />);

    expect(screen.getByText(/지연 계산/)).toBeDefined();
    expect(screen.getByText(/캐시 없음/)).toBeDefined();
    fireEvent.click(screen.getByText("계산"));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("renders the ladder columns 테타|Assumed|예상|Realized|잔차 with signed figures [CHANGED, FB3]", () => {
    state({ rows: ROWS });
    render(<ReconRangeStrip />);

    const row = screen.getByText("2026-07-15").closest("tr")!;
    const cells = Array.from(row.querySelectorAll("td")).map((td) => td.textContent?.trim());
    expect(cells[1]).toBe("+700,000"); // 테타 (T−1 기지)
    expect(cells[2]).toBe("+1.0M"); // Assumed (sign-fixed)
    expect(cells[3]).toBe("+1.7M"); // 예상 = 테타 + Assumed
    expect(cells[4]).toBe("+200,000"); // Realized (테타+평가)
    expect(cells[5]).toBe("-1.5M"); // 잔차 = Realized − 예상
    expect(cells[6]).toBe("-750.0%");
  });

  it("renders a mismatched/incomplete day as — with its reason, never 0", () => {
    state({ rows: ROWS });
    render(<ReconRangeStrip />);

    const row = screen.getByText("2026-07-16").closest("tr")!;
    const cells = Array.from(row.querySelectorAll("td")).map((td) => td.textContent?.trim());
    for (const i of [1, 2, 3, 4, 5, 6]) expect(cells[i]).toBe("—");
    expect(cells[7]).toContain("창 불일치로 제외");
    // No zero masquerading as a figure in this row.
    expect(row.textContent).not.toMatch(/(^|[^\d.,])0([^\d.,]|$)/);
  });

  it("offers +20일 확장 only after a run and only below the max window", () => {
    state({ rows: ROWS, windowSize: 20, maxWindow: 60 });
    render(<ReconRangeStrip />);
    expect(screen.getByText("+20일 확장")).toBeDefined();

    cleanup();
    state({ rows: ROWS, windowSize: 60, maxWindow: 60 });
    render(<ReconRangeStrip />);
    expect(screen.queryByText("+20일 확장")).toBeNull();
  });

  it("shows sequential progress while running", () => {
    state({ running: true, progress: { done: 3, total: 20 } });
    render(<ReconRangeStrip />);
    expect(screen.getByText(/3\/20일/)).toBeDefined();
  });

  // ── RECON2-RH — [잔차 표] [Δbp 시계열] view toggle ──

  it("defaults to the 잔차 table view; the Δbp chart is absent", () => {
    state({ rows: ROWS });
    render(<ReconRangeStrip />);
    expect(
      (screen.getByRole("button", { name: "잔차 표" }) as HTMLButtonElement).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByText("2026-07-15")).toBeDefined(); // table row
    expect(screen.queryByTestId("deltabp-chart")).toBeNull();
    expect(chartSpy).not.toHaveBeenCalled();
  });

  it("Δbp 시계열 swaps the table for the chart, passing the SAME computed rows (no refetch)", () => {
    const run = vi.fn();
    state({ rows: ROWS, run });
    render(<ReconRangeStrip />);
    fireEvent.click(screen.getByRole("button", { name: "Δbp 시계열" }));

    expect(screen.getByTestId("deltabp-chart")).toBeDefined();
    expect(screen.queryByText("Assumed")).toBeNull(); // table gone
    expect(chartSpy).toHaveBeenCalledWith(ROWS); // the same row array, by reference
    expect(run).not.toHaveBeenCalled(); // toggling never recomputes
    expect(screen.getByText(/M2 Δbp 시계열/)).toBeDefined(); // heading follows the view
  });

  it("before a run, the chart view shows the same lazy prompt (nothing to draw, nothing fetched)", () => {
    state({ rows: undefined });
    render(<ReconRangeStrip />);
    fireEvent.click(screen.getByRole("button", { name: "Δbp 시계열" }));
    expect(screen.getByText(/지연 계산/)).toBeDefined();
    expect(screen.queryByTestId("deltabp-chart")).toBeNull();
    expect(chartSpy).not.toHaveBeenCalled();
  });
});
