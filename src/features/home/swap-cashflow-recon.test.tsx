// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { SETTLEMENT_TOLERANCE_KRW, netSwapSettlements } from "@/lib/daily-recon-math";
import type { PortfolioCashFlowOut } from "@/lib/api-types";

/**
 * RECON-DAILY T4a pins: settlement-date scheduled-vs-realized equality at the
 * s11 ₩1 tolerance, the mismatch state (both values + difference, never
 * silently netted), and the honest non-settlement empty state. The price
 * query and stores are mocked; the netting math is exercised for real.
 */

const mockPrice = vi.fn();
// Spread the real module: details-panel (the reused CashflowTable's home)
// drags a wide use-api surface into the import graph; only the price query
// this component actually calls is overridden.
vi.mock("@/hooks/use-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-api")>()),
  usePortfolioPriceQuery: () => mockPrice(),
}));

const mockManualPositions = vi.fn();
vi.mock("@/stores/manual-positions-store", () => ({
  useManualPositionsStore: (sel: (s: { positions: unknown[] }) => unknown) =>
    sel({ positions: mockManualPositions() }),
}));

const { SwapCashflowRecon } = await import("./swap-cashflow-recon");

/** One receive-fixed swap settling inside (07-14, 07-15]: fixed +9,000,001 /
 * floating −7,000,000 → net +2,000,001. A second payment outside the window
 * must be ignored. */
function cf(over: Partial<PortfolioCashFlowOut>): PortfolioCashFlowOut {
  return {
    position_id: "SWAP-1",
    accrual_start: "2026-04-15",
    accrual_end: "2026-07-15",
    payment_date: "2026-07-15",
    leg: "fixed",
    rate: 0.03,
    is_known: true,
    cashflow: 9_000_001,
    pv: 0,
    ...over,
  };
}
const CASHFLOWS: PortfolioCashFlowOut[] = [
  cf({}),
  cf({ leg: "floating", rate: 0.028, cashflow: 7_000_000 }),
  cf({ payment_date: "2026-10-15", cashflow: 9_100_000 }), // outside window
];

const SNAPSHOT = {
  valuation_date: "2026-07-14",
  cd_rate: 0.025,
  on_rate: null,
  swap_quotes: [],
};

function totalRow(realizedCash: number) {
  const swap = {
    theta: 1, mtm: 2, total: 3, funding: 0, mtm_complete: true,
    realized_cash: realizedCash,
  };
  return {
    book: "Total", theta: 1, mtm: 2, total: 3, funding: 0, mtm_complete: true,
    by_class: { swap },
  };
}

function arrange(over: Record<string, unknown> = {}) {
  mockManualPositions.mockReturnValue([
    {
      id: "SWAP-1",
      name: "SWAP-1",
      sector: "IRS",
      book: "RP Fund",
      startDate: "2025-07-15",
      maturityDate: "2027-07-15",
      notionalKrwEok: 100,
      fixedRate: 3.0,
      payFixed: false, // receive fixed
    },
  ]);
  mockPrice.mockReturnValue({
    data: { cashflows: CASHFLOWS },
    isLoading: false,
    isError: false,
    ...over,
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("netSwapSettlements (mirror of engine _realized_swap_cash)", () => {
  it("nets receive-fixed as fixed − floating inside the window only", () => {
    const { totalNet, byPosition, unknownCount } = netSwapSettlements(
      CASHFLOWS,
      { "SWAP-1": false },
      "2026-07-14",
      "2026-07-15",
    );
    expect(totalNet).toBe(2_000_001);
    expect(byPosition["SWAP-1"]).toBe(2_000_001);
    expect(unknownCount).toBe(0);
  });

  it("flips the sign for pay-fixed", () => {
    expect(
      netSwapSettlements(CASHFLOWS, { "SWAP-1": true }, "2026-07-14", "2026-07-15").totalNet,
    ).toBe(-2_000_001);
  });

  it("counts (never skips into the net) unknown window amounts", () => {
    const withUnknown = [...CASHFLOWS, cf({ leg: "floating", cashflow: null, is_known: false })];
    const r = netSwapSettlements(withUnknown, { "SWAP-1": false }, "2026-07-14", "2026-07-15");
    expect(r.unknownCount).toBe(1);
    expect(r.totalNet).toBe(2_000_001);
  });
});

describe("SwapCashflowRecon", () => {
  it("settlement date, s11 tolerance: scheduled equals realized within ₩1 → ONE reconciled row", () => {
    arrange();
    // Realized differs from scheduled by exactly the tolerance boundary.
    render(
      <SwapCashflowRecon
        closeSnapshot={SNAPSHOT}
        asOf="2026-07-15"
        totalRow={totalRow(2_000_001 - SETTLEMENT_TOLERANCE_KRW)}
      />,
    );

    expect(screen.getByText("대사 일치")).toBeDefined();
    expect(screen.queryByText("대사 불일치")).toBeNull();
    expect(screen.queryByText("차이")).toBeNull();
    // The window lines render through the REUSED CashflowTable (its header).
    expect(screen.getByText("Payment Date")).toBeDefined();
    // The out-of-window October payment is not shown.
    expect(screen.queryByText("2026-10-15")).toBeNull();
  });

  it("mismatch: shows scheduled AND realized AND the difference — never silently netted", () => {
    arrange();
    render(
      <SwapCashflowRecon closeSnapshot={SNAPSHOT} asOf="2026-07-15" totalRow={totalRow(1_500_001)} />,
    );

    expect(screen.getByText("대사 불일치")).toBeDefined();
    expect(screen.getByText("예정").parentElement?.textContent).toContain("+2,000,000");
    expect(screen.getByText("실현").parentElement?.textContent).toContain("+1,500,000");
    expect(screen.getByText("차이").parentElement?.textContent).toContain("+500,000");
  });

  it("non-settlement day: honest empty state, no table, no zero", () => {
    arrange({
      data: { cashflows: [cf({ payment_date: "2026-10-15" })] },
    });
    render(
      <SwapCashflowRecon closeSnapshot={SNAPSHOT} asOf="2026-07-15" totalRow={totalRow(0)} />,
    );

    expect(screen.getByText(/도래하는 스왑 결제일이 없습니다/)).toBeDefined();
    expect(screen.queryByText("Payment Date")).toBeNull();
    expect(screen.queryByText("대사 일치")).toBeNull();
  });
});
