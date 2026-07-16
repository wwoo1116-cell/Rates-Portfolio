// Mock historical rate time-series data — 30 data points.
// Used by Historical Snapshot panel in Backtest tab.
// Covers the KTB 10Y benchmark rate from roughly 6 months of daily closes.

export interface HistoricalDataPoint {
  time: string;     // "YYYY-MM-DD"
  value: number;    // rate in %
  volume: number;   // relative volume for depth histogram
}

export interface OrderBookLevel {
  price: number;
  size:  number;    // relative bid/offer depth
  side:  "bid" | "ask";
}

export interface ScenarioLine {
  id:    string;
  label: string;
  color: string;
  data:  { time: string; value: number }[];
}

// ── 30 daily closes: KTB 10Y benchmark (approximate) ────────────────────────
export const HISTORICAL_RATE_SERIES: HistoricalDataPoint[] = [
  { time: "2026-01-06", value: 2.895, volume: 42 },
  { time: "2026-01-07", value: 2.912, volume: 55 },
  { time: "2026-01-08", value: 2.934, volume: 61 },
  { time: "2026-01-09", value: 2.918, volume: 48 },
  { time: "2026-01-12", value: 2.905, volume: 39 },
  { time: "2026-01-13", value: 2.880, volume: 67 },
  { time: "2026-01-14", value: 2.856, volume: 72 },
  { time: "2026-01-15", value: 2.841, volume: 58 },
  { time: "2026-01-16", value: 2.867, volume: 45 },
  { time: "2026-01-19", value: 2.890, volume: 53 },
  { time: "2026-01-20", value: 2.923, volume: 80 },
  { time: "2026-01-21", value: 2.945, volume: 91 },
  { time: "2026-01-22", value: 2.938, volume: 74 },
  { time: "2026-01-23", value: 2.960, volume: 66 },
  { time: "2026-01-26", value: 2.952, volume: 58 },
  { time: "2026-01-27", value: 2.975, volume: 43 },
  { time: "2026-01-28", value: 3.012, volume: 99 },
  { time: "2026-01-29", value: 3.045, volume: 112 },
  { time: "2026-01-30", value: 3.034, volume: 87 },
  { time: "2026-02-02", value: 3.018, volume: 70 },
  { time: "2026-02-03", value: 2.998, volume: 64 },
  { time: "2026-02-04", value: 2.982, volume: 55 },
  { time: "2026-02-05", value: 2.965, volume: 48 },
  { time: "2026-02-06", value: 2.948, volume: 52 },
  { time: "2026-02-09", value: 2.930, volume: 60 },
  { time: "2026-02-10", value: 2.915, volume: 57 },
  { time: "2026-02-11", value: 2.902, volume: 44 },
  { time: "2026-02-12", value: 2.889, volume: 38 },
  { time: "2026-02-13", value: 2.875, volume: 41 },
  { time: "2026-02-14", value: 2.860, volume: 35 },
];

// ── Order-book depth levels for Y-axis histogram ─────────────────────────────
export const ORDER_BOOK_DEPTH: OrderBookLevel[] = [
  { price: 3.05, size: 45,  side: "ask" },
  { price: 3.04, size: 72,  side: "ask" },
  { price: 3.03, size: 91,  side: "ask" },
  { price: 3.02, size: 58,  side: "ask" },
  { price: 3.01, size: 38,  side: "ask" },
  { price: 3.00, size: 120, side: "ask" },
  { price: 2.99, size: 86,  side: "bid" },
  { price: 2.98, size: 105, side: "bid" },
  { price: 2.97, size: 68,  side: "bid" },
  { price: 2.96, size: 52,  side: "bid" },
  { price: 2.95, size: 44,  side: "bid" },
  { price: 2.94, size: 31,  side: "bid" },
];

// ── Scenario comparison lines ─────────────────────────────────────────────────
export const HISTORICAL_SCENARIOS: ScenarioLine[] = [
  {
    id:    "base",
    label: "Base Case",
    color: "var(--accent)",
    data:  HISTORICAL_RATE_SERIES.map((d) => ({ time: d.time, value: d.value })),
  },
  {
    id:    "bear",
    label: "Bear (+50bp)",
    // S12: Jade/Berry signed pair (green/red sem tokens retired).
    color: "var(--chart-pnl-neg)",
    data:  HISTORICAL_RATE_SERIES.map((d) => ({ time: d.time, value: +(d.value + 0.50).toFixed(3) })),
  },
  {
    id:    "bull",
    label: "Bull (-30bp)",
    color: "var(--chart-pnl-pos)",
    data:  HISTORICAL_RATE_SERIES.map((d) => ({ time: d.time, value: +(d.value - 0.30).toFixed(3) })),
  },
];

// ── Probability cone definition (1σ / 2σ bands) ───────────────────────────────
export interface ConeConfig {
  pivotDate: string;
  sigma1: number;   // ± 1σ band width in % at the end of the X range
  sigma2: number;   // ± 2σ band width
}

export const PROB_CONE: ConeConfig = {
  pivotDate: "2026-01-28",
  sigma1: 0.20,
  sigma2: 0.42,
};
