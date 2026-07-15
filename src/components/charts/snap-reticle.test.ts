/**
 * Pins the pane -> overlay coordinate translation that fixes the crosshair
 * sitting left of the cursor.
 *
 * The bug: lightweight-charts reports params.point / timeToCoordinate in PANE
 * space, but CrosshairReticle is absolutely positioned in the consumer's
 * container. A visible left price scale sits between those origins, so the
 * reticle landed exactly leftScaleWidth px left of the real cursor. Only charts
 * with a left axis were affected -- rv-instruments gives spread series
 * priceScaleId "left" and price-panel makes that scale visible.
 */
import { describe, expect, it } from "vitest";

import { paneOffsetX, seriesDistanceY, snapReticleToNearestSeries } from "./snap-reticle";

type AnyChart = Parameters<typeof paneOffsetX>[0];

/** Minimal chart stub: only the members these functions actually touch. */
function chartStub(opts: {
  leftWidth?: number | "throws";
  paneWidth?: number;
  timeToCoordinate?: number | null;
}): AnyChart {
  return {
    priceScale: (id: string) => {
      if (id !== "left" || opts.leftWidth === "throws") {
        // Real API: "@throws If the price scale with the given id is not found"
        throw new Error(`price scale ${id} not found`);
      }
      return { width: () => opts.leftWidth ?? 0 };
    },
    timeScale: () => ({
      width: () => opts.paneWidth ?? 400,
      timeToCoordinate: () => opts.timeToCoordinate ?? null,
    }),
  } as unknown as AnyChart;
}

describe("paneOffsetX", () => {
  it("returns the left price scale width when one is visible", () => {
    // The spread/left-axis case -- this width IS the crosshair's old error.
    expect(paneOffsetX(chartStub({ leftWidth: 56 }))).toBe(56);
  });

  it("returns 0 when the left scale exists but is invisible", () => {
    // width() is documented to return 0 for an invisible scale.
    expect(paneOffsetX(chartStub({ leftWidth: 0 }))).toBe(0);
  });

  it("returns 0 (not a crash) when the pane has no left scale at all", () => {
    // priceScale() throws for an unknown id; outright-only charts hit this.
    expect(paneOffsetX(chartStub({ leftWidth: "throws" }))).toBe(0);
  });
});

describe("snapReticleToNearestSeries", () => {
  const params = (x: number, y: number) =>
    ({ point: { x, y }, time: undefined, seriesData: new Map() }) as never;

  it("shifts x into overlay space by the left-axis width", () => {
    // Cursor at pane x=100 on a chart with a 56px left axis really sits at
    // container x=156. Returning 100 is what drew the reticle 56px too far left.
    const snapped = snapReticleToNearestSeries(chartStub({ leftWidth: 56 }), params(100, 20), []);
    expect(snapped).toEqual({ x: 156, y: 20 });
  });

  it("leaves x untouched when there is no left axis", () => {
    // Guards against over-correcting the charts that were never broken.
    const snapped = snapReticleToNearestSeries(chartStub({ leftWidth: "throws" }), params(100, 20), []);
    expect(snapped).toEqual({ x: 100, y: 20 });
  });

  it("never adjusts y -- pane and container share a top edge", () => {
    const snapped = snapReticleToNearestSeries(chartStub({ leftWidth: 56 }), params(10, 77), []);
    expect(snapped?.y).toBe(77);
  });

  it("returns null when the cursor is off-pane", () => {
    const off = { point: undefined, time: undefined, seriesData: new Map() } as never;
    expect(snapReticleToNearestSeries(chartStub({ leftWidth: 56 }), off, [])).toBeNull();
  });
});

describe("seriesDistanceY", () => {
  /** Series stub resolving its value through its own price scale -- the
   * dual-axis rule this helper exists to centralise (rate-history's click
   * routing and the reticle snap both depend on it). */
  function seriesStub(value: number | undefined, y: number | null) {
    const s = { priceToCoordinate: () => y } as never;
    const params = (cy: number) =>
      ({ point: { x: 0, y: cy }, time: undefined, seriesData: new Map(value == null ? [] : [[s, { value }]]) }) as never;
    return { s, params };
  }

  it("returns the series' own-scale y and pixel distance from the cursor", () => {
    const { s, params } = seriesStub(35, 120);
    expect(seriesDistanceY(params(100), s)).toEqual({ y: 120, dist: 20 });
  });

  it("returns null when the series has no datum at the hovered bar", () => {
    const { s, params } = seriesStub(undefined, 120);
    expect(seriesDistanceY(params(100), s)).toBeNull();
  });

  it("returns null when the value falls outside the visible price range", () => {
    const { s, params } = seriesStub(35, null);
    expect(seriesDistanceY(params(100), s)).toBeNull();
  });
});
