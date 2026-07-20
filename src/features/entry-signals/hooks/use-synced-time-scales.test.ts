/**
 * Pins timeToX's pane -> overlay translation.
 *
 * This was the crosshair-offset fix's blind spot: snapReticleToNearestSeries
 * was corrected, but SyncedTimeGuide positions itself through timeToX, a
 * separate overlay path that still returned raw pane-space X. price-panel shows
 * a left price scale whenever a spread is focused, so the synced date guide sat
 * left-axis-width pixels away from the date the (fixed) reticle marked.
 */
import { describe, expect, it } from "vitest";
import type { IChartApi } from "lightweight-charts";

import { timeToX } from "./use-synced-time-scales";

function chartStub(opts: { leftWidth?: number | "throws"; coord?: number | null }): IChartApi {
  return {
    priceScale: (id: string) => {
      if (id !== "left" || opts.leftWidth === "throws") throw new Error(`no scale ${id}`);
      return { width: () => opts.leftWidth ?? 0 };
    },
    timeScale: () => ({ timeToCoordinate: () => opts.coord ?? null }),
  } as unknown as IChartApi;
}

describe("timeToX", () => {
  it("adds the visible left axis width to the pane coordinate", () => {
    // Pane x=100 with a 56px left axis is container x=156 -- returning 100 is
    // what drew SyncedTimeGuide left of the actual date.
    expect(timeToX(chartStub({ leftWidth: 56, coord: 100 }), "2026-07-01")).toBe(156);
  });

  it("returns the raw coordinate when there is no left axis", () => {
    expect(timeToX(chartStub({ leftWidth: "throws", coord: 100 }), "2026-07-01")).toBe(100);
  });

  it("propagates null for a date outside the visible range", () => {
    expect(timeToX(chartStub({ leftWidth: 56, coord: null }), "2026-07-01")).toBeNull();
  });

  it("returns null for a missing chart or time", () => {
    expect(timeToX(null, "2026-07-01")).toBeNull();
    expect(timeToX(chartStub({ coord: 100 }), null)).toBeNull();
  });
});
