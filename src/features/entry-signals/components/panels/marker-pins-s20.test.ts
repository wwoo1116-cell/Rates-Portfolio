/**
 * s20 T2 pins — marker single-sourcing and pinned-vs-live semantics.
 *
 *  1. Equity-curve markers were exactly bijective with the trade list before
 *     s20 (the s19 reference behavior) — pin that they stay that way.
 *  2. pinnedOscillatorMarkers: markers belong to the pinned run; live drift
 *     (stale) SUPPRESSES them — pinned markers are never rendered over a
 *     mismatched live series (implemented per the s20 prompt, semantic
 *     pending owner sign-off).
 *  3. Source-level guard: the oscillator panel must consume
 *     pinnedOscillatorMarkers and must NOT retain a parallel z-crossing
 *     marker derivation (the s19 R1 defect). Same source-scan technique as
 *     the iv4 slice-host gridline pin.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { simulateMeanReversion } from "@/lib/math/backtest";
import {
  checkCorrespondence,
  equityMarkersFromTrades,
  pinnedOscillatorMarkers,
  type MarkerTuple,
} from "../../lib/marker-trade-correspondence";

/** Same deterministic fixture as backtest-defect-s19.test.ts (s17 KPI recipe). */
function fixture(): { dates: string[]; values: number[] } {
  let s = 42;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff - 0.5;
  };
  const dates: string[] = [];
  const values: number[] = [];
  const d0 = Date.UTC(2025, 0, 1);
  for (let i = 0; i < 320; i++) {
    dates.push(new Date(d0 + i * 86_400_000).toISOString().slice(0, 10));
    let v = 50 + 6 * Math.sin(i / 14) + rand() * 4;
    if (i >= 120 && i < 180) v += 9;
    if (i >= 240) v -= 7;
    values.push(Math.round(v * 100) / 100);
  }
  return { dates, values };
}

const PARAMS = { lookback: 60, entryZ: 2.0, exitZ: 0.5, stopZ: 3.5, costBp: 0.05, notional: 1_000_000 };

describe("equity-curve markers stay exactly bijective with the trade list (s20 regression pin)", () => {
  it("one L/S per entry + one × per exit, all on real bars, nothing extra or missing", () => {
    const { dates, values } = fixture();
    const result = simulateMeanReversion(dates, values, PARAMS);
    expect(result.trades.length).toBeGreaterThan(0);

    const actual = equityMarkersFromTrades(result.trades);
    // Expected side built inline from the trade list — independent of the
    // mirror under test.
    const expected: MarkerTuple[] = [];
    for (const t of result.trades) {
      expected.push({
        time: t.entryDate,
        position: t.direction > 0 ? "belowBar" : "aboveBar",
        shape: "circle",
        text: t.direction > 0 ? "L" : "S",
      });
      expected.push({ time: t.exitDate, position: "aboveBar", shape: "square", text: "×" });
    }
    const barTimes = new Set(result.points.map((p) => p.date));
    const check = checkCorrespondence(expected, actual, barTimes);
    expect(check.orphans).toEqual([]);
    expect(check.missing).toEqual([]);
    expect(check.offBar).toEqual([]);
  });
});

describe("pinnedOscillatorMarkers — pinned-run semantics (s20, pending owner sign-off)", () => {
  it("returns the pinned run's trade entries while the live config matches", () => {
    const { dates, values } = fixture();
    const result = simulateMeanReversion(dates, values, PARAMS);
    const markers = pinnedOscillatorMarkers(result, false);
    expect(markers).toHaveLength(result.trades.length);
    expect(markers.map((m) => m.time)).toEqual(result.trades.map((t) => t.entryDate));
  });

  it("SUPPRESSES markers when the live view drifts from the pinned run", () => {
    const { dates, values } = fixture();
    const result = simulateMeanReversion(dates, values, PARAMS);
    expect(result.trades.length).toBeGreaterThan(0);
    expect(pinnedOscillatorMarkers(result, true)).toEqual([]);
  });

  it("returns nothing when no run is pinned or its series is unresolved", () => {
    expect(pinnedOscillatorMarkers(null, false)).toEqual([]);
    expect(pinnedOscillatorMarkers(null, true)).toEqual([]);
  });
});

describe("oscillator panel marker source (s20 single-source guard)", () => {
  const panelPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "zscore-oscillator-panel.tsx",
  );

  it("consumes pinnedOscillatorMarkers and keeps no parallel z-crossing derivation", () => {
    const code = readFileSync(panelPath, "utf8");
    expect(code).toMatch(/pinnedOscillatorMarkers/);
    // The s19 R1 loop's tell-tales: crossing-state tracking / threshold
    // comparison feeding markers. rollingZScore may still plot the LINE —
    // only marker derivation is locked to the trade list.
    expect(code).not.toMatch(/wasBreaching/);
    expect(code).not.toMatch(/Math\.abs\([^)]*\)\s*>=\s*entryZ/);
  });
});
