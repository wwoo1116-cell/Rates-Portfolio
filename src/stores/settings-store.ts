import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Dashboard-wide settings container. Holds the analytical assumptions that
 * feed the live dashboard views (currently just the funding-rate spread) so
 * they can be tuned in one place -- the Settings tab -- instead of being
 * hard-coded in the backend. Future dashboard-level settings (e.g. day-count,
 * funding on swaps) should be added here rather than scattered across stores.
 *
 * Mirrors upload-store's persist + hasHydrated pattern so consumers can wait
 * for localStorage to rehydrate before treating the value as authoritative.
 */

/** Default funding spread over BOK base rate, in bp. 실무 관행: 기준금리 + 10bp. */
export const DEFAULT_FUNDING_SPREAD_BP = 10;

interface SettingsState {
  /** Funding rate = BOK base rate + fundingSpreadBp. Sent to the backend
   * (book-daily-pnl) which applies base + spread to bond funding cost. */
  fundingSpreadBp: number;
  hasHydrated: boolean;
  setFundingSpreadBp: (value: number) => void;
  resetFundingSpreadBp: () => void;
  setHasHydrated: (value: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      fundingSpreadBp: DEFAULT_FUNDING_SPREAD_BP,
      hasHydrated: false,
      setFundingSpreadBp: (value) => set({ fundingSpreadBp: value }),
      resetFundingSpreadBp: () => set({ fundingSpreadBp: DEFAULT_FUNDING_SPREAD_BP }),
      setHasHydrated: (value) => set({ hasHydrated: value }),
    }),
    {
      name: "dashboard-settings",
      // Only persist the assumption values, not the transient hydration flag.
      partialize: (state) => ({ fundingSpreadBp: state.fundingSpreadBp }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
