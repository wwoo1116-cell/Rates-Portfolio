/**
 * Remaps engine/risk.py's curve-bootstrap pillar labels onto the frontend's
 * existing 5-bucket TENOR_BUCKETS taxonomy (constants.ts), for Home's Tenor x
 * DV01 heatmap (MIGRATION_PLAN.md Phase 4, §3: "risk.py's pillars are
 * curve-bootstrap labels..., not a fixed display-tenor grid -- needs a small
 * remap/bucketing layer").
 *
 * Pillar label format is fixed by the backend (engine/risk.py's
 * curve_bump_scenarios() + engine/curve.py's _quote_label()): "1D", "CD91D",
 * "{n}M" for n<12, "{n}Y" on whole-year boundaries, "{n}Y" with a decimal
 * otherwise (e.g. "1.5Y"). Multiple pillars can collapse into the same
 * bucket (e.g. 6M and 9M both land in "0-1Y") -- their deltas are summed.
 */
import type { DeltaBucketOut } from "./api-client";
import { TENOR_BUCKETS, type TenorBucket } from "./constants";

function pillarToYears(pillar: string): number {
  if (pillar === "1D") return 1 / 365;
  if (pillar === "CD91D") return 91 / 365;
  if (pillar.endsWith("M")) return parseFloat(pillar) / 12;
  if (pillar.endsWith("Y")) return parseFloat(pillar);
  return 0;
}

export function bucketForYears(years: number): TenorBucket {
  if (years <= 1) return "0-1Y";
  if (years <= 3) return "1-3Y";
  if (years <= 5) return "3-5Y";
  if (years <= 10) return "5-10Y";
  return "10Y+";
}

export function bucketDeltasByTenor(buckets: DeltaBucketOut[]): Record<TenorBucket, number> {
  const sums = Object.fromEntries(TENOR_BUCKETS.map((b) => [b, 0])) as Record<TenorBucket, number>;
  for (const { pillar, delta } of buckets) {
    sums[bucketForYears(pillarToYears(pillar))] += delta;
  }
  return sums;
}

/** Representative midpoint-year for each tenor bucket -- used wherever a
 * per-bucket DV01 sum needs a single "duration-like" figure (Backtest's
 * portfolio duration metric) without per-position tenor data. */
export const RISK_BUCKET_MIDPOINT_YEARS: Record<TenorBucket, number> = {
  "0-1Y": 0.5,
  "1-3Y": 2,
  "3-5Y": 4,
  "5-10Y": 7.5,
  "10Y+": 15,
};
