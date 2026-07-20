/**
 * s20 (fixes s19 R2a) — deterministic full-domain fit for the Entry Signals
 * charts.
 *
 * A bare `timeScale().fitContent()` after `setData` is fire-and-forget through
 * lightweight-charts' async invalidation mask, and live debugging (s19 +
 * docs/session-s20) pinned down two ways it fails on real mounts:
 *   - the fit invalidation can apply BEFORE the series data is baked into the
 *     time scale (same mount commit, cache-hit path) — firstIndex() is null
 *     and the fit silently no-ops, leaving the library default barSpacing 6
 *     (a ~95-bar tail window at 640px);
 *   - on the Results grid, the use-synced-time-scales lockstep mirrors every
 *     sibling's range: a sibling's default tail re-anchor lands as an
 *     ApplyRange AFTER the fit in the invalidation queue and overrides it.
 *
 * The engine therefore sets an EXPLICIT logical range {0, barCount−1} —
 * ApplyRange is pure logical coordinates, independent of data baking — and
 * keeps re-asserting it in response to size/range events until the visible
 * range actually covers the domain. Convergence is cooperative with the sync
 * group: the same full range propagates to every synced sibling (all ES
 * series share one master date array), so the group settles on the fit
 * instead of echoing tails. Once converged the engine detaches permanently —
 * user zoom/pan is never fought. Event-driven only, no timers; a small
 * per-trigger budget guarantees termination when the domain cannot fit
 * (pane narrower than barCount × minBarSpacing — see the BASE_CHART_OPTIONS
 * floor, s19 R2b) until the next size change re-arms it.
 *
 * Hosts arm it exactly where they used to call fitContent (data identity
 * change), so zoom-preservation semantics per panel are unchanged.
 */

import type { LogicalRange } from "lightweight-charts";

/** Structural subset of ITimeScaleApi the fit engine needs — lets tests drive
 * it with a scripted fake (fit-harness.ts) while panels pass a real chart. */
export interface FitTimeScale {
  setVisibleLogicalRange(range: { from: number; to: number }): void;
  width(): number;
  getVisibleLogicalRange(): LogicalRange | null;
  subscribeVisibleLogicalRangeChange(handler: (range: LogicalRange | null) => void): void;
  unsubscribeVisibleLogicalRangeChange(handler: (range: LogicalRange | null) => void): void;
  subscribeSizeChange(handler: (width: number, height: number) => void): void;
  unsubscribeSizeChange(handler: (width: number, height: number) => void): void;
}

export interface FitChart {
  timeScale(): FitTimeScale;
}

/** Half a bar of slack: an applied range's edges can land on fractional
 * logical coordinates (edge rounding), never exactly on the indices. */
const FIT_EDGE_TOLERANCE = 0.5;

/** Re-assertions allowed per external trigger (arming, or a size change). One
 * retry absorbs an overridden/merged application; the cap keeps an unfittable
 * pane (or a hostile echo loop) from spinning. */
const MAX_REFITS_PER_TRIGGER = 2;

/** True when the visible logical range spans the whole [0, barCount-1] domain. */
export function rangeCoversDomain(range: LogicalRange | null, barCount: number): boolean {
  return (
    range != null &&
    range.from <= FIT_EDGE_TOLERANCE &&
    range.to >= barCount - 1 - FIT_EDGE_TOLERANCE
  );
}

/**
 * Fit the chart to the full domain of a `barCount`-bar series, deterministically
 * on both mount paths (data-at-mount and data-arrives-late). Returns a dispose
 * function; disposing (or convergence) detaches every subscription. Call it
 * after `setData`, in place of `timeScale().fitContent()`.
 *
 * `applyRange` is how the target range is written. The default writes this
 * chart alone — correct for a lone chart. Panels in the synced group MUST
 * pass `syncSetLogicalRange` (use-synced-time-scales) instead: a lone-chart
 * write on a synced stage is echoed away by the sibling's stale range (see
 * that function's comment for the livelock mechanics). Convergence is still
 * judged on THIS chart's visible range.
 */
export function ensureFullDomainFit(
  chart: FitChart,
  barCount: number,
  applyRange?: (range: { from: number; to: number }) => void,
): () => void {
  const ts = chart.timeScale();
  let settled = false;
  let budget = MAX_REFITS_PER_TRIGGER;

  const applyFit = () => {
    const range = { from: 0, to: barCount - 1 };
    if (applyRange) applyRange(range);
    else ts.setVisibleLogicalRange(range);
  };

  const dispose = () => {
    if (settled) return;
    settled = true;
    // The chart may already have been removed (panel unmount, ChartFrame
    // maximize remount) — detaching from a disposed chart must be a no-op.
    try {
      ts.unsubscribeVisibleLogicalRangeChange(onRange);
      ts.unsubscribeSizeChange(onSize);
    } catch {
      /* chart disposed */
    }
  };

  const onRange = (range: LogicalRange | null) => {
    if (settled) return;
    if (rangeCoversDomain(range, barCount)) {
      dispose();
      return;
    }
    if (budget > 0) {
      budget -= 1;
      applyFit();
    }
  };

  const onSize = () => {
    if (settled) return;
    budget = MAX_REFITS_PER_TRIGGER;
    applyFit();
  };

  ts.subscribeVisibleLogicalRangeChange(onRange);
  ts.subscribeSizeChange(onSize);
  applyFit();
  // If the fit already landed synchronously, settle without waiting for events.
  if (rangeCoversDomain(ts.getVisibleLogicalRange(), barCount)) dispose();

  return dispose;
}
