/**
 * Marker/trade correspondence as SET EQUALITY over tuples (bijection), not
 * cardinality. Written by s19 as the fix pass's acceptance criterion; since
 * s20 it is also the SINGLE SOURCE for the oscillator's trade markers:
 * zscore-oscillator-panel.tsx renders pinnedOscillatorMarkers (the pinned
 * run's trade entries) — the parallel first-|z|-crossing derivation s19
 * diagnosed (R1: not injective, not surjective against the trade list) was
 * deleted, not repaired. Every marker time must exist in the bar array it
 * attaches to (lightweight-charts silently drops markers whose time matches
 * no bar).
 *
 * equityMarkersFromTrades still MIRRORS equity-curve-panel.tsx's inline
 * markers loop (correct since s17 — kept as a regression pin). If that
 * panel's construction changes, update the mirror.
 */

import type { BtResult, BtTrade } from "@/lib/math/backtest";

export interface MarkerTuple {
  time: string;
  position: "aboveBar" | "belowBar";
  shape: "circle" | "square";
  text: string;
}

/** Entry/exit markers exactly as equity-curve-panel.tsx derives them from the
 * backtest trade list (same source as the KPIs). */
export function equityMarkersFromTrades(trades: BtTrade[]): MarkerTuple[] {
  const out: MarkerTuple[] = [];
  for (const t of trades) {
    const long = t.direction > 0;
    out.push({ time: t.entryDate, position: long ? "belowBar" : "aboveBar", shape: "circle", text: long ? "L" : "S" });
    out.push({ time: t.exitDate, position: "aboveBar", shape: "square", text: "×" });
  }
  out.sort((a, b) => a.time.localeCompare(b.time));
  return out;
}

/** One marker per backtest trade entry, on the entry bar, sided by direction
 * — since s20 this IS the oscillator's shipped marker construction. */
export function tradeEntryMarkers(trades: BtTrade[]): MarkerTuple[] {
  return trades.map((t) => ({
    time: t.entryDate,
    position: t.direction > 0 ? "belowBar" : "aboveBar",
    shape: "circle",
    text: t.direction > 0 ? "LONG" : "SHORT",
  }));
}

/**
 * The oscillator panel's marker source (s20). Markers belong to the PINNED
 * run: when the live oscillator has drifted from the run's config (`stale` —
 * useRunIsStale covers instrument + every parameter), trade markers are
 * SUPPRESSED and the existing stale banner explains why. Pinned-run markers
 * are never rendered over a mismatched live series — same policy spirit as
 * the "no silent +0" rule (honest UI over decorative continuity).
 * Implemented per the s20 prompt; semantic pending owner sign-off.
 */
export function pinnedOscillatorMarkers(
  result: Pick<BtResult, "trades"> | null,
  stale: boolean,
): MarkerTuple[] {
  if (!result || stale) return [];
  return tradeEntryMarkers(result.trades);
}

export interface CorrespondenceResult {
  ok: boolean;
  /** Markers with no matching trade event (injectivity failures). */
  orphans: MarkerTuple[];
  /** Trade events with no matching marker (surjectivity failures). */
  missing: MarkerTuple[];
  /** Markers whose time is absent from the bar array (silently dropped or
   * misplaced by lightweight-charts). */
  offBar: MarkerTuple[];
}

const key = (m: MarkerTuple) => `${m.time}|${m.position}|${m.shape}|${m.text}`;

/** Bijection + on-bar alignment between expected trade events and the marker
 * array actually handed to the chart. Exact-tuple equality — not counts. */
export function checkCorrespondence(
  expected: MarkerTuple[],
  actual: MarkerTuple[],
  barTimes: ReadonlySet<string>,
): CorrespondenceResult {
  const exp = new Map(expected.map((m) => [key(m), m]));
  const act = new Map(actual.map((m) => [key(m), m]));
  const orphans = [...act.entries()].filter(([k]) => !exp.has(k)).map(([, m]) => m);
  const missing = [...exp.entries()].filter(([k]) => !act.has(k)).map(([, m]) => m);
  const offBar = actual.filter((m) => !barTimes.has(m.time));
  return { ok: orphans.length === 0 && missing.length === 0 && offBar.length === 0, orphans, missing, offBar };
}
