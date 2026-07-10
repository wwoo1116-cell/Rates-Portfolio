/**
 * Pure helpers for Home's rate-history chart, ported from
 * IRS Pricer_Mock/web/src/lib/rateHistory.js (the old app's Overview RV
 * dashboard) to TypeScript against RateHistoryPointOut. GET /api/rate-history
 * itself was already fully built server-side with zero frontend consumers
 * until this chart.
 */
import type { RateHistoryPointOut } from "./api-client";

export type RateSeriesKey = "cd_rate" | "1Y" | "3Y" | "10Y" | "base_rate";

export interface RateSeriesOption {
  key: RateSeriesKey;
  label: string;
}

// Exactly the series the user asked for: CD 91D, IRS 1Y/3Y/10Y, BOK base rate.
export const RATE_SERIES_OPTIONS: RateSeriesOption[] = [
  { key: "cd_rate", label: "CD 91D" },
  { key: "1Y", label: "IRS 1Y" },
  { key: "3Y", label: "IRS 3Y" },
  { key: "10Y", label: "IRS 10Y" },
  { key: "base_rate", label: "BOK Base Rate" },
];

export interface SpreadDef {
  key: "1s3s" | "3s10s";
  label: string;
  short: "1Y" | "3Y";
  long: "3Y" | "10Y";
}

// spread = long - short, in bp.
export const SPREAD_DEFS: SpreadDef[] = [
  { key: "1s3s", label: "1s3s", short: "1Y", long: "3Y" },
  { key: "3s10s", label: "3s10s", short: "3Y", long: "10Y" },
];

export function rateValue(point: RateHistoryPointOut, key: RateSeriesKey): number | null {
  if (key === "cd_rate") return point.cd_rate;
  if (key === "base_rate") return point.base_rate ?? null;
  return point.tenor_rates?.[key] ?? null;
}

export interface LinePoint {
  time: string;
  value: number;
}

export function toLineData(points: RateHistoryPointOut[], key: RateSeriesKey): LinePoint[] {
  return points
    .map((p) => ({ time: p.valuation_date, value: rateValue(p, key) }))
    .filter((d): d is LinePoint => d.value != null && Number.isFinite(d.value));
}

export function toSpreadLineData(points: RateHistoryPointOut[], def: SpreadDef): LinePoint[] {
  return points
    .map((p) => {
      const shortRate = p.tenor_rates?.[def.short];
      const longRate = p.tenor_rates?.[def.long];
      if (shortRate == null || longRate == null) return null;
      return { time: p.valuation_date, value: (longRate - shortRate) * 10000 };
    })
    .filter((d): d is LinePoint => d != null);
}
