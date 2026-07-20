import { create } from "zustand";
import { persist } from "zustand/middleware";
import { spreadId, type Leg, type SelectedInstrument } from "@/lib/rv-instruments";

/**
 * Shared state for the Entry Signals (Z-Score) tab. Every dockview panel in
 * that workspace reads from here (the codebase convention is that panels read
 * Zustand/TanStack directly rather than via dockview params).
 *
 * - analysis params (lookback / thresholds / bands) drive the FRONTEND rolling
 *   stats (src/lib/math/rolling-stats.ts) -- changing them recomputes instantly
 *   with no network round-trip.
 * - backtest params (exitZ/stopZ/costBp/notional) feed the client-side
 *   backtest simulation (pinned lastRun -- see use-pinned-backtest).
 * - `focused` is the instrument the three left charts + backtest track;
 *   `watchlist` is the curated set scanned by the Signal grid.
 */

export const LOOKBACK_PRESETS = [20, 60, 120] as const;

/** Staged flow (s17): Configure -> Running -> Results. */
export type EsStage = "configure" | "running" | "results";

/** Immutable snapshot of everything a run depends on, taken at 실행 time.
 * The Results stage's backtest block (KPIs, trades, cumulative P&L) computes
 * from THIS — never from the live store params — so it stays pinned to the
 * run that produced it while the signals/z-score surfaces keep tracking the
 * live config. Persisted so a detached equity window can reproduce the same
 * run (the detached window shares localStorage, not memory). */
export interface EsRunConfig {
  instrument: SelectedInstrument;
  lookback: number;
  entryZ: number;
  warnZ: number;
  exitZ: number;
  stopZ: number;
  costBp: number;
  notional: number;
  /** ISO timestamp of when 실행 was pressed. */
  ranAt: string;
}

export interface EntrySignalsState {
  // Staged flow (s17). `stage` is deliberately NOT persisted — every session
  // starts at Configure; Results only ever appears after a run. `pendingRun`
  // exists only while the Running stage is in flight.
  stage: EsStage;
  lastRun: EsRunConfig | null;
  pendingRun: EsRunConfig | null;

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

  // Staged-flow actions (s17).
  /** Snapshot the current config + focused instrument and enter Running.
   * No-op when nothing is focused (the CTA is disabled in that state). */
  startRun: () => void;
  /** Promote pendingRun to the pinned lastRun and show Results. The previous
   * lastRun stays pinned (and visible) until this fires — re-run REPLACES. */
  completeRun: () => void;
  /** Abandon the in-flight run: back to the old Results if one exists,
   * otherwise back to Configure. */
  cancelRun: () => void;
  /** 조건 수정 — return to Configure. Inputs are the live store params, which
   * the flow never clears, so every value round-trips. */
  editConfig: () => void;
}

/** Shape of a spread as persisted by schema v0 (hard-coded 2 legs). */
interface LegacySpreadV0 {
  kind: "spread";
  id: string;
  legA: Leg;
  legB: Leg;
}

/**
 * v0 -> v1: `{ legA, legB }` becomes the generalized `legs: [{leg, weight}]`.
 *
 * v0's value was (legB − legA), so legB carries +1 and legA −1. legB is stored
 * FIRST so the generalized label renderer still prints "B − A", exactly as the
 * old hard-coded label did.
 *
 * The id is regenerated because the v0 format (`S:legA~legB`) encodes neither
 * weights nor a leg count. Rewriting `focused` and `watchlist` in the same pass
 * keeps them referentially consistent, so nothing dangles. The one visible
 * consequence: colorForId(id) is derived from the id, so a migrated spread's
 * line colour changes once.
 */
function migrateSpreadV0(inst: LegacySpreadV0): SelectedInstrument {
  const legs = [
    { leg: inst.legB, weight: 1 },
    { leg: inst.legA, weight: -1 },
  ];
  return { kind: "spread", id: spreadId(legs), legs };
}

function isLegacySpreadV0(inst: unknown): inst is LegacySpreadV0 {
  const i = inst as Partial<LegacySpreadV0>;
  return i?.kind === "spread" && i.legA != null && i.legB != null;
}

/** Outrights are unchanged across v0/v1; only spreads need rewriting.
 * Exported for entry-signals-store.test.ts — this runs against real saved user
 * watchlists, so it is worth pinning directly rather than through persist. */
export function migrateInstrumentV0(inst: unknown): SelectedInstrument | null {
  if (inst == null) return null;
  if (isLegacySpreadV0(inst)) return migrateSpreadV0(inst);
  return inst as SelectedInstrument;
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
      stage: "configure" as EsStage,
      lastRun: null,
      pendingRun: null,

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

      startRun: () =>
        set((s) => {
          if (!s.focused) return s;
          return {
            pendingRun: {
              instrument: s.focused,
              lookback: s.lookback,
              entryZ: s.entryZ,
              warnZ: s.warnZ,
              exitZ: s.exitZ,
              stopZ: s.stopZ,
              costBp: s.costBp,
              notional: s.notional,
              ranAt: new Date().toISOString(),
            },
            stage: "running" as EsStage,
          };
        }),
      completeRun: () =>
        set((s) => ({
          lastRun: s.pendingRun ?? s.lastRun,
          pendingRun: null,
          stage: "results" as EsStage,
        })),
      cancelRun: () =>
        set((s) => ({
          pendingRun: null,
          stage: (s.lastRun ? "results" : "configure") as EsStage,
        })),
      editConfig: () => set({ stage: "configure" as EsStage }),
    }),
    {
      name: "entry-signals-storage",
      // v1 generalized spreads from legA/legB to an N-leg weighted array.
      // Anyone with a saved watchlist is on v0 (persist writes version 0 when
      // unset), so without this their spreads would rehydrate with legs
      // undefined and blow up in buildInstrumentSeries.
      version: 1,
      migrate: (persisted, fromVersion) => {
        const s = persisted as Partial<EntrySignalsState> | undefined;
        if (!s || fromVersion >= 1) return s as EntrySignalsState;
        return {
          ...s,
          focused: migrateInstrumentV0(s.focused),
          watchlist: (s.watchlist ?? []).map(migrateInstrumentV0).filter((i): i is SelectedInstrument => i != null),
        } as EntrySignalsState;
      },
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
        // s17 additive: pinned run params (NOT stage/pendingRun — a fresh
        // session always starts at Configure). Pre-s17 storage simply lacks
        // the key and rehydrates lastRun as its null default.
        lastRun: s.lastRun,
      }),
    },
  ),
);
