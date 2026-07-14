import { TENOR_BUCKETS, type TenorBucket } from "@/lib/constants";
import { weightedDuration } from "@/lib/risk-buckets";

export type ScenarioGroupId = "mpc" | "historical";

// A shock is expressed in bp applied to each real DV01-by-tenor-bucket
// (usePortfolioRiskBuckets, same 5-bucket taxonomy as Home's heatmap).
export type TenorShock = Record<TenorBucket, number>;

export interface Scenario {
  id: string;
  group: ScenarioGroupId;
  label: string;
  shock: TenorShock;
  dateRange?: string;
  description?: string;
}

// Re-keyed from the old {y1,y3,y5,y10} point-bucket shocks onto the 5
// TENOR_BUCKETS; "10Y+" mirrors the old y10 long-end magnitude. These are
// already-labeled placeholder calibrations (WORK_ORDER.md §10(3)) so this
// re-mapping doesn't change their accuracy, just their bucket keys.
export const MPC_SCENARIOS: Scenario[] = [
  {
    id: "hike-25",
    group: "mpc",
    label: "+25bp Hike",
    shock: { "0-1Y": 25, "1-3Y": 25, "3-5Y": 25, "5-10Y": 25, "10Y+": 25 },
  },
  {
    id: "cut-25",
    group: "mpc",
    label: "-25bp Cut",
    shock: { "0-1Y": -25, "1-3Y": -25, "3-5Y": -25, "5-10Y": -25, "10Y+": -25 },
  },
  {
    id: "surprise-hike-50",
    group: "mpc",
    label: "+50bp Surprise Hike",
    shock: { "0-1Y": 50, "1-3Y": 50, "3-5Y": 50, "5-10Y": 50, "10Y+": 50 },
  },
  {
    id: "flattener-2s10s",
    group: "mpc",
    label: "Curve Flattener (2s10s -20bp)",
    shock: { "0-1Y": 10, "1-3Y": 5, "3-5Y": -5, "5-10Y": -10, "10Y+": -10 },
  },
  {
    id: "steepener-2s10s",
    group: "mpc",
    label: "Curve Steepener (2s10s +20bp)",
    shock: { "0-1Y": -10, "1-3Y": -5, "3-5Y": 5, "5-10Y": 10, "10Y+": 10 },
  },
];

// Dates and directional bp moves are approximate, public-record windows for each
// event (BOK cut cadence, Legoland ABCP freeze, SVB flight-to-quality). Treat as
// a placeholder calibration per WORK_ORDER.md §10(3) — confirm/adjust exact
// windows and magnitudes against desk records if this needs to be precise.
export const HISTORICAL_SCENARIOS: Scenario[] = [
  {
    id: "covid-2020",
    group: "historical",
    label: "COVID-19 (Mar 2020)",
    dateRange: "2020-02-20 – 2020-03-23",
    description: "Flight-to-quality + BOK emergency cut. Front-end KTB/IRS rallied hardest, curve steepened.",
    shock: { "0-1Y": -60, "1-3Y": -45, "3-5Y": -35, "5-10Y": -25, "10Y+": -25 },
  },
  {
    id: "legoland-2022",
    group: "historical",
    label: "Legoland Credit Crunch (Oct 2022)",
    dateRange: "2022-09-28 – 2022-10-31",
    description: "ABCP/PF market freeze after the Gangwon-do default. Short-end funding stress spiked yields, curve flattened.",
    shock: { "0-1Y": 70, "1-3Y": 55, "3-5Y": 40, "5-10Y": 25, "10Y+": 25 },
  },
  {
    id: "svb-2023",
    group: "historical",
    label: "US SVB Contagion (Mar 2023)",
    dateRange: "2023-03-08 – 2023-03-31",
    description: "Global flight-to-quality on US bank contagion fears. KRW rates rallied in sympathy with UST, front-end led.",
    shock: { "0-1Y": -50, "1-3Y": -35, "3-5Y": -25, "5-10Y": -15, "10Y+": -15 },
  },
];

export const ALL_SCENARIOS: Scenario[] = [...MPC_SCENARIOS, ...HISTORICAL_SCENARIOS];

// Real portfolio DV01/notional (from usePortfolioRiskBuckets) lives on a raw
// scale driven directly by notional (100M KRW units, hundreds to thousands per
// bucket). SCALE reconciles that into the illustrative "100M" P&L scale used
// everywhere else in the UI, so a realistic shock produces a plausible-looking
// swing instead of one dwarfing every other KPI on screen.
const SCALE = 2000;

// ΔP&L = -Σ(bucket DV01 × shock bp) / SCALE. Bucket DV01 is already signed so
// that a net Pay book carries negative DV01 — i.e. it already encodes "gains
// when rates rise" — so the standard bond-math negation here yields the
// correct P&L direction.
function applyShock(buckets: TenorShock, shock: TenorShock): number {
  return -TENOR_BUCKETS.reduce((sum, bucket) => sum + buckets[bucket] * shock[bucket], 0) / SCALE;
}

function avgShockBp(shock: TenorShock): number {
  return TENOR_BUCKETS.reduce((sum, bucket) => sum + shock[bucket], 0) / TENOR_BUCKETS.length;
}

// Simple parametric mock: 1-day 95% VaR ≈ |DV01| × an illustrative bp-equivalent
// vol multiplier, scaled the same way as the P&L impact. Not a real risk model —
// labeled "(mock)" throughout the UI.
const VAR_BP_MULTIPLIER = 6.6;
function mockVar(dv01: number): number {
  return (Math.abs(dv01) * VAR_BP_MULTIPLIER) / SCALE;
}

export interface BacktestMetrics {
  pnl: number;
  dv01: number;
  duration: number;
  var: number;
}

export interface AssetClassImpact {
  assetClass: string;
  impact: number;
}

export interface BacktestResult {
  scenario: Scenario;
  pre: BacktestMetrics;
  post: BacktestMetrics;
  assetClassImpact: AssetClassImpact[];
}

// Pre-Shock P&L is the backtest's own zero baseline — a stress test asks "what
// does this shock do to the book from here", not "what's the running P&L to
// date" (that's Home's concern). Post-Shock P&L is simply the shock-driven ΔP&L.
const BASE_PNL = 0;

/** buckets/totalDv01 come from usePortfolioRiskBuckets() -- the real current
 * IRS book (the only asset class with a pricing engine today, MIGRATION_PLAN.md
 * §3 gap table). KTB/CRS/KTBF always contribute 0 impact until they get one. */
export function computeBacktestResult(scenario: Scenario, buckets: TenorShock, totalDv01: number): BacktestResult {
  const pnlDelta = applyShock(buckets, scenario.shock);
  const avgShock = avgShockBp(scenario.shock);
  const preDuration = weightedDuration(buckets);
  const durationDelta = -(avgShock / 2000) * preDuration;

  const pre: BacktestMetrics = {
    pnl: BASE_PNL,
    dv01: totalDv01,
    duration: preDuration,
    var: mockVar(totalDv01),
  };

  const post: BacktestMetrics = {
    pnl: BASE_PNL + pnlDelta,
    dv01: totalDv01,
    duration: preDuration + durationDelta,
    var: mockVar(totalDv01),
  };

  return {
    scenario,
    pre,
    post,
    assetClassImpact: [{ assetClass: "IRS", impact: pnlDelta }],
  };
}
