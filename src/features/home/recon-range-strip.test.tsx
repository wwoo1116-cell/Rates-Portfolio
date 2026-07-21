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

const ROWS = [
  {
    asOf: "2026-07-15",
    close: "2026-07-14",
    assumed: -1_000_000,
    realized: -700_000,
    residual: 300_000,
    residualPct: 42.857,
  },
  {
    asOf: "2026-07-16",
    close: "2026-07-15",
    assumed: null,
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

  it("renders computed rows with signed figures and the 잔차 column", () => {
    state({ rows: ROWS });
    render(<ReconRangeStrip />);

    const row = screen.getByText("2026-07-15").closest("tr")!;
    const cells = Array.from(row.querySelectorAll("td")).map((td) => td.textContent?.trim());
    expect(cells[1]).toBe("-1.0M");
    expect(cells[2]).toBe("-700,000");
    expect(cells[3]).toBe("+300,000");
    expect(cells[4]).toBe("+42.9%");
  });

  it("renders a mismatched/incomplete day as — with its reason, never 0", () => {
    state({ rows: ROWS });
    render(<ReconRangeStrip />);

    const row = screen.getByText("2026-07-16").closest("tr")!;
    const cells = Array.from(row.querySelectorAll("td")).map((td) => td.textContent?.trim());
    expect(cells[1]).toBe("—");
    expect(cells[2]).toBe("—");
    expect(cells[3]).toBe("—");
    expect(cells[5]).toContain("창 불일치로 제외");
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
});
