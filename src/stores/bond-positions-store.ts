import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface BondPosition {
  id: string;
  name: string;
  sector: string;
  book: string;
  notionalKrwEok: number;
  evaluationAmountKrwEok: number;
  remainingDays: number;
  tenorBucket: string;
  entryYield: number;
  mtmYield: number;
  duration: number;
  pvbp: number;
  // Static bond params hydrated by the client-side blotter parser
  // (blotter-parser.ts) and sent to POST /api/portfolio/bond-cashflows so the
  // backend can generate the CF schedule + NPV.
  issueDate: string;         // "YYYY-MM-DD"
  maturityDate: string;      // "YYYY-MM-DD"
  couponRate: number;        // percent, e.g. 3.125 (from the 표면이율 column)
  paymentFrequency: number;  // 2 (KTB/govt) or 4 (credit)
  rating: string | null;     // credit rating; null for 국고채/통안채
}

interface BondPositionsState {
  positions: BondPosition[];
  setPositions: (positions: BondPosition[]) => void;
  clearPositions: () => void;
}

// Persisted to localStorage: like manual-positions-store, the uploaded bond
// ledger IS the live data (no positions DB), so a refresh must not wipe it.
export const useBondPositionsStore = create<BondPositionsState>()(
  persist(
    (set) => ({
      positions: [],
      setPositions: (positions) => set({ positions }),
      clearPositions: () => set({ positions: [] }),
    }),
    {
      name: "bond-positions",
      partialize: (state) => ({ positions: state.positions }),
    },
  ),
);
