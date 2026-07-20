/**
 * Class B (shared-pure) — the ONE waypoint write path (SIM2-3). Steppers,
 * typed commits, and the 시계열형 drag all commit through buildWaypointPatch,
 * so payload identity between input methods is structural, not tested-into
 * existence. Snap/clamp constants live here so drag and steppers can never
 * drift apart.
 */
import type { ScenarioParams } from "../types/simulation-port";
import { toNum } from "./scenario-curves";

/** Stepper increment AND the drag snap grid (s11 recipe, reused by SIM2-3). */
export const WAYPOINT_STEP_BP = 5;

/** The symmetric waypoint clamp: ±max(|baseShock| + 50, 100). */
export function waypointClampMax(baseShockBp: string): number {
  return Math.max(Math.abs(toNum(baseShockBp)) + 50, 100);
}

/** Drag commit value: snapped to the 5bp grid, then clamped. */
export function snapWaypointBp(rawBp: number, baseShockBp: string): number {
  const snapped = Math.round(rawBp / WAYPOINT_STEP_BP) * WAYPOINT_STEP_BP;
  const max = waypointClampMax(baseShockBp);
  return Math.max(-max, Math.min(max, snapped));
}

/** SIM2-2 — the on-the-line default for an untouched intermediate waypoint:
 * target × day/simDays, rounded to 0.1bp so grid defaults stay legible
 * (≤0.05bp off the exact line — buildTimePath/_factor lerp between waypoints,
 * so the rendered/priced path stays smooth). */
export function lerpDefaultBp(targetBp: number, day: number, simDays: number): number {
  if (simDays <= 0) return 0;
  return Math.round(((targetBp * day) / simDays) * 10) / 10;
}

/** The store patch every waypoint edit commits: the new bp on the matching
 * day, plus the SIM2-2 touched flag (explicit, idempotent). */
export function buildWaypointPatch(
  params: ScenarioParams,
  day: number,
  bp: number,
): Pick<ScenarioParams, "waypoints" | "touchedWaypointDays"> {
  return {
    waypoints: params.waypoints.map((w) => (w.day === day ? { ...w, bp } : w)),
    touchedWaypointDays: params.touchedWaypointDays.includes(day)
      ? params.touchedWaypointDays
      : [...params.touchedWaypointDays, day],
  };
}
