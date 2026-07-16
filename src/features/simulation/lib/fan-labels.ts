/**
 * s18 T3 — the single label authority for the dual-axis fan (이중축 분리).
 *
 * Owner ruling: outcome-rank labels (a bare "P95") are only truthful where the
 * quantity is monotone in the quantile. That is the RATE axis by construction
 * (a +1.645σ rate path is always above the +0.674σ one). It is NOT the return
 * axis on non-monotone books — the p95 RATE scenario does not produce the p95
 * RETURN (76/121 days crossed on the live book), so a return band labeled
 * "P95" is a false claim.
 *
 * Therefore:
 *  - RATE panel: bands labeled P5..P95 — allowed, truthful, never cross.
 *  - RETURN panel: one LINE per scenario, labeled BY SCENARIO
 *    ("금리 P95 시나리오"), never by outcome rank. A bare rank label on the
 *    return panel is a regression (pinned by fan-labels.test.ts, which also
 *    source-scans the return panel component for bare rank literals).
 */

export const FAN_PERCENTILES = [5, 25, 50, 75, 95] as const;
export type FanPercentile = (typeof FAN_PERCENTILES)[number];

/** RATE-panel band label — rank labels are truthful on this axis only. */
export function rateBandLabel(pct: FanPercentile): string {
  return `P${pct}`;
}

/** RETURN-panel series label — scenario identity, never an outcome rank. */
export function returnScenarioLabel(pct: FanPercentile): string {
  return pct === 50 ? "기본 시나리오 (금리 P50)" : `금리 P${pct} 시나리오`;
}

/** Compact readout variant of returnScenarioLabel (header chips). Still a
 * scenario label — the 금리 prefix is what makes the rank reference truthful. */
export function returnScenarioShortLabel(pct: FanPercentile): string {
  return pct === 50 ? "기본" : `금리P${pct}`;
}

/** A bare outcome-rank label ("P95"). Banned on the return panel. */
export const BARE_RANK_LABEL = /^P\d{1,2}$/;
