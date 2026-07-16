/**
 * s19 diagnosis helper — marker/trade correspondence as SET EQUALITY over
 * tuples (bijection), not cardinality. This is the acceptance criterion for
 * the eventual fix pass (REPORT_s19.md): after the fix, the oscillator's
 * entry markers must pass checkCorrespondence against the backtest's trade
 * entries, and every marker time must exist in the bar array it attaches to
 * (lightweight-charts silently drops markers whose time matches no bar).
 *
 * The two builders MIRROR the panels' inline constructions (equity:
 * equity-curve-panel.tsx markers loop; oscillator: zscore-oscillator-panel.tsx
 * first-crossing loop) so tests can measure the SHIPPED derivations without
 * refactoring the components mid-diagnosis. If a panel's construction
 * changes, update the mirror — the s19 tests exist to scream when the two
 * derivations disagree.
 */

import { rollingZScore } from "@/lib/math/rolling-stats";
import type { BtTrade } from "@/lib/math/backtest";

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

/** SHORT/LONG markers exactly as zscore-oscillator-panel.tsx derives them:
 * first z-crossing into the entry zone — an INDEPENDENT derivation from the
 * trade list (no position state, no exit/stop rules). */
export function oscillatorCrossingMarkers(
  dates: string[],
  values: number[],
  lookback: number,
  entryZ: number,
): MarkerTuple[] {
  const z = rollingZScore(values, lookback);
  const out: MarkerTuple[] = [];
  let wasBreaching = false;
  for (let i = 0; i < z.length; i++) {
    const zi = z[i];
    if (zi == null) continue;
    const breaching = Math.abs(zi) >= entryZ;
    if (breaching && !wasBreaching) {
      const rich = zi > 0;
      out.push({ time: dates[i], position: rich ? "aboveBar" : "belowBar", shape: "circle", text: rich ? "SHORT" : "LONG" });
    }
    wasBreaching = breaching;
  }
  return out;
}

/** What the oscillator's entry markers SHOULD be: one marker per backtest
 * trade entry, on the entry bar, sided by direction. */
export function tradeEntryMarkers(trades: BtTrade[]): MarkerTuple[] {
  return trades.map((t) => ({
    time: t.entryDate,
    position: t.direction > 0 ? "belowBar" : "aboveBar",
    shape: "circle",
    text: t.direction > 0 ? "LONG" : "SHORT",
  }));
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
