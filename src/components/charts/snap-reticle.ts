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
 * Pixel point of the data-point marker nearest the cursor. X snaps to the
 * hovered bar (timeToCoordinate). Y is the nearest candidate series' value
 * converted through that series' own price scale. Returns `null` when the
 * cursor is off-pane; falls back to the raw cursor point when no candidate has
 * data at the hovered time. The returned coordinates are in the chart pane's
 * pixel space -- the same space the reticle overlay is positioned in.
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
  return { x: snappedX, y: bestY };
}
