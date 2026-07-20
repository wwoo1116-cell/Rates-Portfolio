"use client";

/**
 * SIM2-3 (ruling ②) — vertical drag handles over the 시계열형 waypoint dots.
 *
 * ADDITIVE affordance: the steppers remain the canonical editor. Every drag
 * commit goes through the SAME lib patch path the steppers use
 * (buildWaypointPatch via onCommit), with the SAME clamp
 * (±max(|baseShock|+50, 100)) and the 5bp snap (snapWaypointBp) — payload
 * identity between input methods is structural. A dragged waypoint is
 * therefore "touched" for SIM2-2 regen semantics automatically.
 *
 * Only INTERMEDIATE waypoints are draggable — D+0 (zero pin) and the
 * terminal (pinned to baseShockBp by the regen invariant) are not editable
 * anywhere in the UI, drag included.
 *
 * Positioning: chart/series references arrive through LwLineChart's
 * onSeriesRebuilt seam; x/y come from timeToCoordinate/priceToCoordinate,
 * recomputed on every waypoint change (drag commits re-render the store) and
 * on visible-range changes. All coordinate calls are guarded — a disposed
 * chart (panel unmount race) must never throw (the LwLineChart "Object is
 * disposed" family).
 */
import { useEffect, useRef, useState } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";

import { snapWaypointBp } from "../../lib/waypoints";
import { dayToTime } from "./lw-line-chart";

export interface WaypointDragOverlayProps {
  chart: IChartApi | null;
  series: ISeriesApi<"Line"> | null;
  baseDate: string;
  /** Intermediate waypoints only (host passes waypoints.slice(1, -1)). */
  waypoints: { day: number; bp: number }[];
  baseShockBp: string;
  /** The stepper-identical commit: host wires patchParams(buildWaypointPatch(…)). */
  onCommit: (day: number, bp: number) => void;
}

const HANDLE_PX = 16;

export function WaypointDragOverlay({
  chart,
  series,
  baseDate,
  waypoints,
  baseShockBp,
  onCommit,
}: WaypointDragOverlayProps) {
  // Bumped on pan/zoom so handle positions track the time scale.
  const [, setRangeTick] = useState(0);
  const dragDay = useRef<number | null>(null);

  useEffect(() => {
    if (!chart) return;
    const onRange = () => setRangeTick((t) => t + 1);
    try {
      chart.timeScale().subscribeVisibleTimeRangeChange(onRange);
    } catch {
      return;
    }
    return () => {
      try {
        chart.timeScale().unsubscribeVisibleTimeRangeChange(onRange);
      } catch {
        /* disposed */
      }
    };
  }, [chart]);

  if (!chart || !series) return null;

  const positions = waypoints.map((w) => {
    try {
      const x = chart.timeScale().timeToCoordinate(dayToTime(baseDate, w.day));
      const y = series.priceToCoordinate(w.bp);
      return x == null || y == null ? null : { day: w.day, bp: w.bp, x, y };
    } catch {
      return null;
    }
  });

  const commitFromY = (day: number, clientY: number, el: HTMLElement) => {
    const host = el.parentElement;
    if (!host) return;
    try {
      const rect = host.getBoundingClientRect();
      const price = series.coordinateToPrice(clientY - rect.top);
      if (price == null) return;
      const snapped = snapWaypointBp(Number(price), baseShockBp);
      const current = waypoints.find((w) => w.day === day)?.bp;
      if (snapped !== current) onCommit(day, snapped);
    } catch {
      /* disposed mid-drag */
    }
  };

  return (
    <div className="pointer-events-none absolute inset-0" data-testid="waypoint-drag-overlay">
      {positions.map((p) =>
        p === null ? null : (
          <button
            key={p.day}
            type="button"
            data-num
            aria-label={`D+${p.day} 웨이포인트 드래그`}
            title={`D+${p.day} · ${p.bp >= 0 ? "+" : ""}${p.bp}bp (드래그로 조정)`}
            className="pointer-events-auto absolute cursor-ns-resize rounded-full border border-sem-info bg-sem-info-ghost"
            style={{
              width: HANDLE_PX,
              height: HANDLE_PX,
              left: p.x - HANDLE_PX / 2,
              top: p.y - HANDLE_PX / 2,
              touchAction: "none",
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              dragDay.current = p.day;
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (dragDay.current !== p.day) return;
              commitFromY(p.day, e.clientY, e.currentTarget);
            }}
            onPointerUp={(e) => {
              if (dragDay.current === p.day) {
                commitFromY(p.day, e.clientY, e.currentTarget);
                dragDay.current = null;
              }
              (e.target as HTMLElement).releasePointerCapture(e.pointerId);
            }}
          />
        ),
      )}
    </div>
  );
}
