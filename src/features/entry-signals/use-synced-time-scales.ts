"use client";

/**
 * Cross-chart time-axis synchronization for the Entry Signals stacked charts
 * (Price / Z-Score / Equity). The codebase has no chart-sync primitive
 * (grep for subscribeVisibleLogicalRangeChange returns nothing), so this is
 * built directly on the raw IChartApi each panel gets from
 * LwChartBase's onChartReady.
 *
 * A module-level registry is used rather than React context because dockview
 * renders each panel in its own subtree; only one Entry Signals workspace is
 * ever mounted, so a singleton is safe and simplest.
 *
 * Sync has two parts:
 *  1. LOGICAL-range pan/zoom lockstep. Logical range aligns by DATA INDEX, so
 *     every synced series must share an identical time array -- callers align
 *     their series to one master date array (see alignToDates in
 *     lib/math/rolling-stats.ts) and pad gaps with whitespace points.
 *  2. A shared hovered-date, broadcast so each sibling can render a thin
 *     vertical time guide at the same date (useSharedHoverTime + SyncedTimeGuide).
 */

import { useSyncExternalStore } from "react";
import type { IChartApi, LogicalRange, Time } from "lightweight-charts";
import { paneOffsetX } from "@/components/charts/snap-reticle";

const charts = new Map<string, IChartApi>();
const rangeHandlers = new Map<string, (range: LogicalRange | null) => void>();
let applying = false;

let hoverTime: string | null = null;
const hoverListeners = new Set<() => void>();

/** Register a chart into the shared logical-range group. Idempotent per id. */
export function registerSyncChart(id: string, chart: IChartApi) {
  unregisterSyncChart(id);
  charts.set(id, chart);
  const handler = (range: LogicalRange | null) => {
    if (!range || applying) return;
    applying = true;
    try {
      for (const [otherId, other] of charts) {
        if (otherId === id) continue;
        other.timeScale().setVisibleLogicalRange(range);
      }
    } finally {
      applying = false;
    }
  };
  chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
  rangeHandlers.set(id, handler);
}

export function unregisterSyncChart(id: string) {
  const chart = charts.get(id);
  const handler = rangeHandlers.get(id);
  if (chart && handler) {
    try {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
    } catch {
      // chart already disposed (panel unmounted) -- nothing to detach
    }
  }
  charts.delete(id);
  rangeHandlers.delete(id);
}

/** Broadcast the currently-hovered date ("YYYY-MM-DD") to the sibling charts. */
export function setSharedHoverTime(time: string | null) {
  if (hoverTime === time) return;
  hoverTime = time;
  for (const listener of hoverListeners) listener();
}

export function useSharedHoverTime(): string | null {
  return useSyncExternalStore(
    (cb) => {
      hoverListeners.add(cb);
      return () => hoverListeners.delete(cb);
    },
    () => hoverTime,
    () => hoverTime,
  );
}

export function timeToX(chart: IChartApi | null, time: string | null): number | null {
  if (!chart || !time) return null;
  try {
    const x = chart.timeScale().timeToCoordinate(time as unknown as Time);
    // timeToCoordinate is PANE-space; SyncedTimeGuide positions in the
    // container. A visible left price scale (price-panel shows one whenever a
    // spread is focused) sits between the two origins, so without adding its
    // width back the guide line lands left of the date it claims to mark --
    // the same offset bug snap-reticle.ts documents for the crosshair.
    return x == null ? null : x + paneOffsetX(chart);
  } catch {
    return null;
  }
}
