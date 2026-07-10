import type { Tenor } from "@/lib/constants";

// Deterministic PRNG so server-rendered and client-hydrated output match exactly.
function mulberry32(seed: number) {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(20260107);

// Kept for src/components/charts/tenor-curve-chart.tsx (TenorCurveChart), a
// generic reusable canvas chart primitive independent of Home's removed
// KTB/IRS curve mini-chart instance (MIGRATION_PLAN.md §2.2) -- currently
// unused but not part of what §2.2 asked to remove.
export interface CurvePoint {
  tenor: Tenor;
  today: number;
  yesterday: number;
}

export type HeatmapSector = "IRS" | "KTB" | "Credit" | "FRN";

export interface HeatmapItem {
  id: string;
  sector: HeatmapSector;
  ticker: string;
  notionalKrwEok: number;
  dailyPnlPercent: number;
}

const HEATMAP_SEED: Array<[HeatmapSector, string, number]> = [
  ["IRS", "IRS 5Y KRW", 420],
  ["IRS", "IRS 10Y KRW", 310],
  ["IRS", "IRS 2Y KRW", 180],
  ["IRS", "IRS 3Y KRW", 150],
  ["KTB", "KTB10Yr 68", 380],
  ["KTB", "KTB3Yr 145", 260],
  ["KTB", "KTB30Yr 12", 220],
  ["KTB", "KTBF 3Y KTB Futures", 140],
  ["Credit", "AA- Corp Bond 3Y", 210],
  ["Credit", "AA Corp Bond 5Y", 170],
  ["Credit", "A+ Corp Bond 2Y", 95],
  ["FRN", "FRN Bank Bond 1Y", 160],
  ["FRN", "FRN Card Bond 2Y", 110],
  ["FRN", "FRN Capital Bond 1Y", 70],
];

function buildHeatmapData(): HeatmapItem[] {
  return HEATMAP_SEED.map(([sector, ticker, notionalKrwEok], index) => ({
    id: `HEAT-${index + 1}`,
    sector,
    ticker,
    notionalKrwEok,
    dailyPnlPercent: Number(((rng() - 0.5) * 6).toFixed(2)),
  }));
}

export const MOCK_HEATMAP: HeatmapItem[] = buildHeatmapData();
