/**
 * s20 test harness — a scripted stand-in for lightweight-charts' time scale,
 * mirroring the library semantics the s19 diagnosis pinned down
 * (dist 5.2.0: fitContent → setVisibleRange, `_correctBarSpacing` clamping
 * barSpacing to `options.minBarSpacing`, right-edge anchoring, and the
 * async invalidation-mask application that lets a mount-commit fit be
 * dropped). It exists because the R2a mount race needs real layout to
 * reproduce — jsdom has none — so the guard tests drive ensureFullDomainFit
 * through the same event sequences the browser produces on both mount paths.
 *
 * The minBarSpacing floor defaults to the SHIPPED value in
 * BASE_CHART_OPTIONS, so these guards fail if the R2b fix regresses there.
 */

import type { LogicalRange } from "lightweight-charts";
import { BASE_CHART_OPTIONS } from "@/components/charts/lw-chart-base";
import type { FitChart, FitTimeScale } from "./full-domain-fit";

/** lightweight-charts defaults (dist 5.2.0): initial bar spacing when no fit
 * ever applies, and the minBarSpacing floor when options leave it unset. */
const LW_DEFAULT_BAR_SPACING = 6;
const LW_DEFAULT_MIN_BAR_SPACING = 0.5;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

interface HarnessOptions {
  /** Pane width at creation; 0 = created before layout (the cache-hit race). */
  width?: number;
  /** Override the floor; defaults to the shipped BASE_CHART_OPTIONS value. */
  minBarSpacing?: number;
}

export class FitHarness implements FitTimeScale {
  private width_: number;
  private readonly minBarSpacing_: number;
  private barCount = 0;
  private barSpacing = LW_DEFAULT_BAR_SPACING;
  private range: LogicalRange | null = null;
  private queue: Array<() => void> = [];
  private dropNextFit_ = false;

  /** Total fit applications requested — guards refit-loop termination. */
  fitCalls = 0;

  private rangeHandlers = new Set<(r: LogicalRange | null) => void>();
  private sizeHandlers = new Set<(w: number, h: number) => void>();

  constructor(opts: HarnessOptions = {}) {
    this.width_ = opts.width ?? 0;
    this.minBarSpacing_ =
      opts.minBarSpacing ??
      (BASE_CHART_OPTIONS.timeScale?.minBarSpacing as number | undefined) ??
      LW_DEFAULT_MIN_BAR_SPACING;
  }

  /** The structural chart the engine consumes. */
  get chart(): FitChart {
    return { timeScale: () => this };
  }

  // ---- scripted world -------------------------------------------------

  /** Series data lands (setData). Like the library, the data renders at the
   * current bar spacing anchored to the right edge — the tail window — and
   * that render emits a visible-range change. */
  setData(barCount: number): void {
    this.barCount = barCount;
    this.queue.push(() => this.applyCurrentSpacing());
  }

  /** Layout gives the pane its width (ResizeObserver → applyOptions). The
   * library keeps the bar spacing and re-anchors, then notifies size. */
  layout(width: number): void {
    this.queue.push(() => {
      this.width_ = width;
      for (const h of this.sizeHandlers) h(width, 300);
      this.applyCurrentSpacing();
    });
  }

  /** Arm the mount-race drop: the NEXT fit application is discarded, exactly
   * like an application merged away by the mount commit's invalidation mask
   * or overridden by a synced sibling's tail echo (s19 R2a / s20 sync
   * finding — the data's own tail-window render still happens). */
  dropNextFit(): void {
    this.dropNextFit_ = true;
  }

  /** Drain the async application queue (the browser's rAF/paint cycle). */
  flush(): void {
    while (this.queue.length > 0) this.queue.shift()!();
  }

  visibleRange(): LogicalRange | null {
    return this.range;
  }

  // ---- FitTimeScale ----------------------------------------------------

  setVisibleLogicalRange(range: { from: number; to: number }): void {
    this.fitCalls += 1;
    this.queue.push(() => {
      if (this.dropNextFit_) {
        this.dropNextFit_ = false;
        return;
      }
      if (this.width_ <= 0) return; // nothing renders before layout
      // dist 5.2.0 setVisibleRange: barSpacing = width/span, then
      // _correctBarSpacing clamps to the options floor — a clamped range
      // keeps its right edge and shows width/clampedSpacing bars.
      const span = range.to - range.from + 1;
      this.barSpacing = clamp(this.width_ / span, this.minBarSpacing_, this.width_ * 0.5);
      this.applyCurrentSpacing(range.to);
    });
  }

  width(): number {
    return this.width_;
  }

  getVisibleLogicalRange(): LogicalRange | null {
    return this.range;
  }

  subscribeVisibleLogicalRangeChange(handler: (r: LogicalRange | null) => void): void {
    this.rangeHandlers.add(handler);
  }

  unsubscribeVisibleLogicalRangeChange(handler: (r: LogicalRange | null) => void): void {
    this.rangeHandlers.delete(handler);
  }

  subscribeSizeChange(handler: (w: number, h: number) => void): void {
    this.sizeHandlers.add(handler);
  }

  unsubscribeSizeChange(handler: (w: number, h: number) => void): void {
    this.sizeHandlers.delete(handler);
  }

  // ---- internals -------------------------------------------------------

  /** Right-edge-anchored visible range at the current spacing (the library's
   * default anchoring for date series with rightOffset 0). */
  private applyCurrentSpacing(rightEdge: number = this.barCount - 1): void {
    if (this.width_ <= 0 || this.barCount === 0) return;
    const visibleBars = this.width_ / this.barSpacing;
    const next: LogicalRange = { from: rightEdge - visibleBars + 1, to: rightEdge } as LogicalRange;
    const changed = this.range == null || this.range.from !== next.from || this.range.to !== next.to;
    this.range = next;
    if (!changed) return;
    for (const h of [...this.rangeHandlers]) h(next);
  }
}
