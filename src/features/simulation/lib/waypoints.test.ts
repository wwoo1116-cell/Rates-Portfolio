/**
 * SIM2-3 — the one waypoint write path: snap/clamp grammar and the
 * drag-vs-stepper payload identity (identical store writes → identical
 * buildSimulateRequest output).
 */
import { describe, expect, it } from "vitest";

import { buildSimulateRequest } from "./scenario-curves";
import { buildWaypointPatch, lerpDefaultBp, snapWaypointBp, waypointClampMax } from "./waypoints";
import { DEFAULT_SCENARIO_PARAMS, EMPTY_SIMULATION_INPUTS, type ScenarioParams } from "../types/simulation-port";

const GRID_PARAMS: ScenarioParams = {
  ...DEFAULT_SCENARIO_PARAMS,
  waypoints: [
    { day: 0, bp: 0 },
    { day: 30, bp: 5 },
    { day: 60, bp: 10 },
    { day: 180, bp: 30 },
  ],
  touchedWaypointDays: [],
};

describe("waypoint write path (SIM2-3)", () => {
  it("snaps to the 5bp grid and clamps at ±max(|baseShock|+50, 100)", () => {
    expect(snapWaypointBp(27.3, "30")).toBe(25);
    expect(snapWaypointBp(-12.6, "30")).toBe(-15);
    expect(waypointClampMax("30")).toBe(100);
    expect(snapWaypointBp(999, "30")).toBe(100);
    expect(waypointClampMax("80")).toBe(130);
    expect(snapWaypointBp(999, "80")).toBe(130);
    expect(snapWaypointBp(-999, "80")).toBe(-130);
  });

  it("buildWaypointPatch writes the day and flags it touched, idempotently", () => {
    const patch = buildWaypointPatch(GRID_PARAMS, 30, 25);
    expect(patch.waypoints.find((w) => w.day === 30)?.bp).toBe(25);
    expect(patch.touchedWaypointDays).toEqual([30]);
    const again = buildWaypointPatch({ ...GRID_PARAMS, ...patch }, 30, 20);
    expect(again.touchedWaypointDays).toEqual([30]); // no duplicate flag
  });

  it("drag-vs-stepper payload identity: same final value → identical requests", () => {
    const inputs = { ...EMPTY_SIMULATION_INPUTS, baseDate: "2026-07-15" };
    // Drag route: raw pointer price → snap → the shared patch.
    const viaDrag = { ...GRID_PARAMS, ...buildWaypointPatch(GRID_PARAMS, 30, snapWaypointBp(26.9, GRID_PARAMS.baseShockBp)) };
    // Stepper route: the same value committed directly through the same patch.
    const viaStepper = { ...GRID_PARAMS, ...buildWaypointPatch(GRID_PARAMS, 30, 25) };
    expect(buildSimulateRequest(inputs, viaDrag)).toEqual(buildSimulateRequest(inputs, viaStepper));
  });

  it("lerpDefaultBp sits on the line (0.1bp rounding)", () => {
    expect(lerpDefaultBp(30, 30, 180)).toBe(5);
    expect(lerpDefaultBp(30, 90, 180)).toBe(15);
    expect(lerpDefaultBp(25, 30, 180)).toBe(4.2);
    expect(lerpDefaultBp(30, 0, 180)).toBe(0);
    expect(lerpDefaultBp(30, 30, 0)).toBe(0);
  });
});
