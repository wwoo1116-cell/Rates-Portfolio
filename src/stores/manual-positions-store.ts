import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * A user-entered / uploaded IRS position, kept entirely on the client but
 * priced by the REAL backend (POST /api/portfolio/price and /delta via
 * use-manual-portfolio-valuation.ts) instead of hand-rolled math -- explicit
 * start/maturity dates instead of a tenor dropdown so the backend can build a
 * real quarterly Korean-convention cashflow schedule (irs_pricer/core/
 * conventions.py).
 *
 * Persisted to localStorage: this deployment has no positions DB, so the
 * uploaded portfolio (loaded here via app/upload + apply-parsed-positions)
 * IS the live ledger -- without persistence a refresh wiped every row and
 * forced a full re-upload. Bond rows persist symmetrically in
 * bond-positions-store.ts.
 */
export interface ManualPosition {
  id: string;
  name: string;
  sector: string;
  book: string;
  /** ISO yyyy-MM-dd. */
  startDate: string;
  /** ISO yyyy-MM-dd; must be after startDate (enforced by add-position-modal's zod schema). */
  maturityDate: string;
  notionalKrwEok: number;
  /** Fixed/strike rate in percent (e.g. 3.25 means 3.25%) -- same convention as Position.fixedRate. */
  fixedRate: number;
  /** true = pay fixed / receive float; false = receive fixed / pay float --
   * same convention as PortfolioPositionIn.pay_fixed / PositionResultOut.pay_fixed. */
  payFixed: boolean;
}

interface ManualPositionsState {
  positions: ManualPosition[];
  addPosition: (position: Omit<ManualPosition, "id">) => void;
  removePosition: (id: string) => void;
  clearPositions: () => void;
}

export const useManualPositionsStore = create<ManualPositionsState>()(
  persist(
    (set) => ({
      positions: [],
      addPosition: (position) =>
        set((state) => ({
          positions: [
            ...state.positions,
            { ...position, id: `MANUAL-${Math.random().toString(36).substr(2, 9).toUpperCase()}` },
          ],
        })),
      removePosition: (id) =>
        set((state) => ({ positions: state.positions.filter((p) => p.id !== id) })),
      clearPositions: () => set({ positions: [] }),
    }),
    {
      name: "manual-positions",
      partialize: (state) => ({ positions: state.positions }),
    },
  ),
);
