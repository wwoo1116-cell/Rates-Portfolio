// Mock pricer / simulation data — 30 IRS 5Y rate data points.
// Used by PricerPage in the Simulation tab.

export interface PricerDataPoint {
  time: string;
  value: number;   // IRS 5Y mid rate in %
  bid:   number;   // IRS bid
  ask:   number;   // IRS ask
}

export interface PricerInput {
  label: string;
  key:   string;
  value: number;
  unit:  string;
  step:  number;
}

export interface PricerResult {
  label:  string;
  value:  number;
  unit:   string;
  signed: boolean;
}

// ── 30 daily IRS 5Y mid rates ─────────────────────────────────────────────────
export const PRICER_RATE_SERIES: PricerDataPoint[] = [
  { time: "2026-01-06", value: 2.620, bid: 2.614, ask: 2.626 },
  { time: "2026-01-07", value: 2.635, bid: 2.629, ask: 2.641 },
  { time: "2026-01-08", value: 2.648, bid: 2.642, ask: 2.654 },
  { time: "2026-01-09", value: 2.641, bid: 2.635, ask: 2.647 },
  { time: "2026-01-12", value: 2.629, bid: 2.623, ask: 2.635 },
  { time: "2026-01-13", value: 2.610, bid: 2.604, ask: 2.616 },
  { time: "2026-01-14", value: 2.598, bid: 2.592, ask: 2.604 },
  { time: "2026-01-15", value: 2.585, bid: 2.579, ask: 2.591 },
  { time: "2026-01-16", value: 2.600, bid: 2.594, ask: 2.606 },
  { time: "2026-01-19", value: 2.618, bid: 2.612, ask: 2.624 },
  { time: "2026-01-20", value: 2.642, bid: 2.636, ask: 2.648 },
  { time: "2026-01-21", value: 2.660, bid: 2.654, ask: 2.666 },
  { time: "2026-01-22", value: 2.653, bid: 2.647, ask: 2.659 },
  { time: "2026-01-23", value: 2.670, bid: 2.664, ask: 2.676 },
  { time: "2026-01-26", value: 2.664, bid: 2.658, ask: 2.670 },
  { time: "2026-01-27", value: 2.680, bid: 2.674, ask: 2.686 },
  { time: "2026-01-28", value: 2.705, bid: 2.699, ask: 2.711 },
  { time: "2026-01-29", value: 2.732, bid: 2.726, ask: 2.738 },
  { time: "2026-01-30", value: 2.720, bid: 2.714, ask: 2.726 },
  { time: "2026-02-02", value: 2.708, bid: 2.702, ask: 2.714 },
  { time: "2026-02-03", value: 2.692, bid: 2.686, ask: 2.698 },
  { time: "2026-02-04", value: 2.678, bid: 2.672, ask: 2.684 },
  { time: "2026-02-05", value: 2.665, bid: 2.659, ask: 2.671 },
  { time: "2026-02-06", value: 2.651, bid: 2.645, ask: 2.657 },
  { time: "2026-02-09", value: 2.638, bid: 2.632, ask: 2.644 },
  { time: "2026-02-10", value: 2.625, bid: 2.619, ask: 2.631 },
  { time: "2026-02-11", value: 2.614, bid: 2.608, ask: 2.620 },
  { time: "2026-02-12", value: 2.602, bid: 2.596, ask: 2.608 },
  { time: "2026-02-13", value: 2.590, bid: 2.584, ask: 2.596 },
  { time: "2026-02-14", value: 2.578, bid: 2.572, ask: 2.584 },
];

// ── Pricer inputs (editable parameters) ──────────────────────────────────────
export const PRICER_INPUTS: PricerInput[] = [
  { label: "Notional (100M KRW)",   key: "notional",  value: 1000,  unit: "100M",  step: 100  },
  { label: "Fixed Rate (%)",  key: "fixedRate", value: 2.650, unit: "%",   step: 0.01 },
  { label: "Tenor (Y)",       key: "tenor",     value: 5,     unit: "Y",   step: 1    },
  { label: "Spread (bp)",     key: "spread",    value: 0,     unit: "bp",  step: 1    },
];

// ── Computed pricer results (from current market rate vs strike) ──────────────
export function computePricerResults(
  inputs: PricerInput[],
  marketRate: number,
): PricerResult[] {
  const notional  = inputs.find((i) => i.key === "notional")?.value  ?? 1000;
  const fixedRate = inputs.find((i) => i.key === "fixedRate")?.value ?? 2.650;
  const tenor     = inputs.find((i) => i.key === "tenor")?.value     ?? 5;
  const spread    = (inputs.find((i) => i.key === "spread")?.value   ?? 0) / 10000;

  const marketBpRate = (marketRate + spread) / 100;
  const fixedBpRate  = fixedRate / 100;

  // Simplified DV01 approximation: notional × tenor × 0.0001 × 0.90
  const dv01     = notional * tenor * 0.0001 * 0.90;
  const pnl      = (marketBpRate - fixedBpRate) * 100 * dv01 * 10000;
  const duration = tenor * 0.95;
  const convexity = (tenor * tenor) / 200;

  return [
    { label: "Market Rate",   value: marketRate,      unit: "%",     signed: false },
    { label: "Spread",        value: spread * 10000,  unit: "bp",    signed: true  },
    { label: "DV01 (100M/bp)",  value: dv01,            unit: " 100M",   signed: false },
    { label: "MTM P&L (100M)",  value: pnl / 100000000, unit: " 100M",   signed: true  },
    { label: "Duration (Y)",  value: duration,        unit: " Y",    signed: false },
    { label: "Convexity",     value: convexity,       unit: "",      signed: false },
  ];
}
