import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SelectedInstrument } from "@/lib/rv-instruments";

/**
 * Shared state for the Entry Signals (Z-Score) tab. Every dockview panel in
 * that workspace reads from here (the codebase convention is that panels read
 * Zustand/TanStack directly rather than via dockview params).
 *
 * - analysis params (lookback / thresholds / bands) drive the FRONTEND rolling
 *   stats (src/lib/math/rolling-stats.ts) -- changing them recomputes instantly
 *   with no network round-trip.
 * - backtest params (exitZ/stopZ/costBp/notional) feed the BACKEND
 *   /api/spread-backtest via useSpreadBacktest.
 * - `focused` is the instrument the three left charts + backtest track;
 *   `watchlist` is the curated set scanned by the Signal grid.
 */

export const LOOKBACK_PRESETS = [20, 60, 120] as const;

export interface EntrySignalsState {
  // Analysis params (persisted) — frontend rolling stats.
  lookback: number;
  entryZ: number;
  warnZ: number;
  showBands: boolean;

  // Backtest params (persisted) — backend /api/spread-backtest.
  exitZ: number;
  stopZ: number;
  costBp: number;
  notional: number;

  // Selection.
  focused: SelectedInstrument | null;
  watchlist: SelectedInstrument[];

  // Actions.
  setLookback: (lookback: number) => void;
  setEntryZ: (entryZ: number) => void;
  setWarnZ: (warnZ: number) => void;
  toggleBands: () => void;
  setExitZ: (exitZ: number) => void;
  setStopZ: (stopZ: number) => void;
  setCostBp: (costBp: number) => void;
  setNotional: (notional: number) => void;
  setFocused: (inst: SelectedInstrument | null) => void;
  addToWatchlist: (inst: SelectedInstrument) => void;
  removeFromWatchlist: (id: string) => void;
  clearWatchlist: () => void;
  resetParams: () => void;
}

const DEFAULT_PARAMS = {
  lookback: 60,
  entryZ: 2.0,
  warnZ: 1.5,
  showBands: true,
  exitZ: 0.5,
  stopZ: 3.5,
  costBp: 0.05,
  notional: 1_000_000,
} as const;

export const useEntrySignalsStore = create<EntrySignalsState>()(
  persist(
    (set) => ({
      ...DEFAULT_PARAMS,
      focused: null,
      watchlist: [],

      setLookback: (lookback) => set({ lookback: Math.max(2, Math.round(lookback)) }),
      setEntryZ: (entryZ) => set({ entryZ: Math.max(0, entryZ) }),
      setWarnZ: (warnZ) => set({ warnZ: Math.max(0, warnZ) }),
      toggleBands: () => set((s) => ({ showBands: !s.showBands })),
      setExitZ: (exitZ) => set({ exitZ: Math.max(0, exitZ) }),
      setStopZ: (stopZ) => set({ stopZ: Math.max(0, stopZ) }),
      setCostBp: (costBp) => set({ costBp: Math.max(0, costBp) }),
      setNotional: (notional) => set({ notional: Math.max(0, notional) }),
      setFocused: (focused) => set({ focused }),
      addToWatchlist: (inst) =>
        set((s) => (s.watchlist.some((w) => w.id === inst.id) ? s : { watchlist: [...s.watchlist, inst] })),
      removeFromWatchlist: (id) =>
        set((s) => {
          const watchlist = s.watchlist.filter((w) => w.id !== id);
          // Drop focus if the focused instrument was just removed.
          const focused = s.focused && s.focused.id === id ? null : s.focused;
          return { watchlist, focused };
        }),
      clearWatchlist: () => set({ watchlist: [], focused: null }),
      resetParams: () => set({ ...DEFAULT_PARAMS }),
    }),
    {
      name: "entry-signals-storage",
      partialize: (s) => ({
        lookback: s.lookback,
        entryZ: s.entryZ,
        warnZ: s.warnZ,
        showBands: s.showBands,
        exitZ: s.exitZ,
        stopZ: s.stopZ,
        costBp: s.costBp,
        notional: s.notional,
        focused: s.focused,
        watchlist: s.watchlist,
      }),
    },
  ),
);
