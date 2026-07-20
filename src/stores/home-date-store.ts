/**
 * R3B-PLUS T2b — Home Daily P&L past-date view state.
 *
 * Holds the analyst's explicit CLOSE-date override for the Daily P&L panel.
 * null = automatic (latest close), which reproduces the pre-T2b request
 * byte-for-byte. Mirrors the Simulation slice's userBaseDate pattern
 * (features/simulation/store/simulation-data-store.ts) one layer up: this one
 * is app-wide because use-portfolio-analytics has three Home consumers that
 * must share a single daily-pnl query key.
 *
 * Scope: ONLY the Daily P&L request follows this date. PVBP Sensitivity,
 * Book Summary and Portfolio Overview stay pinned to the latest close.
 * Deliberately not persisted — a past-date view is a transient inspection,
 * and reopening the app on a silently-stale date would violate the panel's
 * honesty rules.
 */
import { create } from "zustand";

/**
 * Resolve the picked close date against the backend's available dates:
 * the latest available date ≤ the pick (a free-typed weekend/holiday snaps
 * backward, never forward — pricing off a FUTURE close would be fabrication),
 * and the latest close for a null, future, or pre-range pick. Pure and
 * exported for its unit pins (home-date-store.test.ts).
 */
export function resolveDailyCloseDate(
  picked: string | null,
  latest: string | undefined,
  available: string[] | undefined,
): string | undefined {
  if (!picked || !latest || picked >= latest) return latest;
  let resolved: string | undefined;
  for (const d of available ?? []) {
    if (d <= picked) resolved = d;
    else break;
  }
  return resolved ?? latest;
}

interface HomeDateState {
  dailyPnlCloseDate: string | null;
  setDailyPnlCloseDate: (date: string | null) => void;
}

export const useHomeDateStore = create<HomeDateState>((set) => ({
  dailyPnlCloseDate: null,
  setDailyPnlCloseDate: (date) => set({ dailyPnlCloseDate: date }),
}));
