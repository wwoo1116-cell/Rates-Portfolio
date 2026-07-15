import type { IChartApi, ISeriesApi, MouseEventParams } from "lightweight-charts";

/**
 * Snaps the CrosshairReticle overlay (crosshair-reticle.tsx) to a series'
 * data-point marker instead of the raw cursor. This is what keeps the reticle
 * aligned on dual-axis charts: each candidate's value is converted through ITS
 * OWN price scale via ISeriesApi.priceToCoordinate, so a left(bp)-scale series
 * resolves against the left axis and a right(%)-scale series against the right
 * -- the reticle center then lands on the same pixel as the library's per-series
 * crosshair marker dot.
 */

export interface SnappedPoint {
  x: number;
  y: number;
}

/**
 * Horizontal distance from the chart CONTAINER's left edge to the PANE's left
 * edge — i.e. the width of a visible left price scale, else 0.
 *
 * This is the fix for the crosshair sitting left of the cursor. Everything
 * lightweight-charts hands back (params.point, timeToCoordinate,
 * priceToCoordinate) is measured from the PANE's origin, but the reticle
 * overlay is absolutely positioned inside the consumer's `position: relative`
 * wrapper, which starts at the CONTAINER's origin. A left price scale sits
 * between those two origins, so without adding its width back the reticle lands
 * exactly `leftScaleWidth` px left of the real cursor.
 *
 * It only bites charts that actually show a left axis — rv-instruments.ts gives
 * spread series `priceScaleId: "left"` and price-panel.tsx then makes that scale
 * visible, which is why outright-only charts always looked fine.
 *
 * priceScale() throws when the id doesn't exist on the pane, and width() is
 * documented to return 0 for an invisible scale, so both cases collapse to 0.
 */
export function paneOffsetX(chart: IChartApi): number {
  try {
    return chart.priceScale("left").width();
  } catch {
    return 0;
  }
}

/**
 * Pixel point of the data-point marker nearest the cursor. X snaps to the
 * hovered bar (timeToCoordinate). Y is the nearest candidate series' value
 * converted through that series' own price scale. Returns `null` when the
 * cursor is off-pane; falls back to the raw cursor point when no candidate has
 * data at the hovered time.
 *
 * The returned X is in the OVERLAY's (container's) pixel space, not the pane's:
 * paneOffsetX is added so callers can position the reticle/tooltip directly.
 * Y needs no such adjustment — the pane and container share a top edge.
 * (This function previously returned raw pane-space X and claimed it was "the
 * same space the reticle overlay is positioned in"; that assumption is exactly
 * what put the crosshair left of the cursor on left-axis charts.)
 */
export function snapReticleToNearestSeries(
  chart: IChartApi,
  params: MouseEventParams,
  candidates: Iterable<ISeriesApi<"Line"> | null | undefined>,
): SnappedPoint | null {
  if (!params.point) return null;
  const cursorX = params.point.x;
  const cursorY = params.point.y;
  const snappedX =
    params.time != null ? (chart.timeScale().timeToCoordinate(params.time) ?? cursorX) : cursorX;
  const offsetX = paneOffsetX(chart);

  let bestY = cursorY;
  let bestDist = Infinity;
  for (const s of candidates) {
    if (!s) continue;
    const d = params.seriesData.get(s) as { value?: number } | undefined;
    if (d?.value == null || !Number.isFinite(d.value)) continue;
    const y = s.priceToCoordinate(d.value);
    if (y == null) continue;
    const dist = Math.abs(y - cursorY);
    if (dist < bestDist) {
      bestDist = dist;
      bestY = y;
    }
  }
  return { x: snappedX + offsetX, y: bestY };
}
