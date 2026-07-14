/**
 * Rolling statistics for the Entry Signals (Z-Score) feature.
 *
 * Deliberately mirrors the backend's convention in
 * irs_pricer/services/spread_backtest_service.py::_rolling_z_scores so the
 * frontend live oscillator and the backend backtest agree on z-score:
 *   - trailing INCLUSIVE window of `lookback` observations ending at each index
 *     (Bollinger-band convention)
 *   - POPULATION standard deviation (statistics.pstdev, two-pass)
 *   - fewer than `lookback` points -> null; std == 0 -> null z-score
 *
 * Two-pass mean/std (not a rolling sum-of-squares shortcut) is used on purpose:
 * it matches Python's fmean/pstdev to floating-point precision, and the series
 * here are small (a few thousand daily points), so O(n * lookback) is trivial.
 */

export type MaybeNumber = number | null;

export interface WindowStat {
  value: number;
  mean: number;
  std: number;
  z: number | null;
}

export type Signal = "ENTRY_LONG" | "ENTRY_SHORT" | "WATCH" | "NONE";

function windowMeanStd(values: number[], start: number, end: number): { mean: number; std: number } {
  const n = end - start;
  let sum = 0;
  for (let k = start; k < end; k++) sum += values[k];
  const mean = sum / n;
  let sq = 0;
  for (let k = start; k < end; k++) {
    const d = values[k] - mean;
    sq += d * d;
  }
  return { mean, std: Math.sqrt(sq / n) };
}

/** Rolling population mean (SMA). null until the window is full. */
export function rollingMean(values: number[], lookback: number): MaybeNumber[] {
  const out: MaybeNumber[] = new Array(values.length).fill(null);
  if (lookback <= 0) return out;
  for (let i = lookback - 1; i < values.length; i++) {
    out[i] = windowMeanStd(values, i - lookback + 1, i + 1).mean;
  }
  return out;
}

/** Rolling population standard deviation. null until the window is full. */
export function rollingStd(values: number[], lookback: number): MaybeNumber[] {
  const out: MaybeNumber[] = new Array(values.length).fill(null);
  if (lookback <= 0) return out;
  for (let i = lookback - 1; i < values.length; i++) {
    out[i] = windowMeanStd(values, i - lookback + 1, i + 1).std;
  }
  return out;
}

/** Rolling z-score. null for i < lookback-1 or when the window std is 0. */
export function rollingZScore(values: number[], lookback: number): MaybeNumber[] {
  const out: MaybeNumber[] = new Array(values.length).fill(null);
  if (lookback <= 0) return out;
  for (let i = lookback - 1; i < values.length; i++) {
    const { mean, std } = windowMeanStd(values, i - lookback + 1, i + 1);
    out[i] = std === 0 ? null : (values[i] - mean) / std;
  }
  return out;
}

/** All three rolling series in a single pass over the windows. */
export function rollingSeries(
  values: number[],
  lookback: number,
): { mean: MaybeNumber[]; std: MaybeNumber[]; z: MaybeNumber[] } {
  const mean: MaybeNumber[] = new Array(values.length).fill(null);
  const std: MaybeNumber[] = new Array(values.length).fill(null);
  const z: MaybeNumber[] = new Array(values.length).fill(null);
  if (lookback <= 0) return { mean, std, z };
  for (let i = lookback - 1; i < values.length; i++) {
    const w = windowMeanStd(values, i - lookback + 1, i + 1);
    mean[i] = w.mean;
    std[i] = w.std;
    z[i] = w.std === 0 ? null : (values[i] - w.mean) / w.std;
  }
  return { mean, std, z };
}

/** Latest full-window statistics, or null if there aren't `lookback` points. */
export function latestStats(values: number[], lookback: number): WindowStat | null {
  if (lookback <= 0 || values.length < lookback) return null;
  const i = values.length - 1;
  const { mean, std } = windowMeanStd(values, i - lookback + 1, i + 1);
  return {
    value: values[i],
    mean,
    std,
    z: std === 0 ? null : (values[i] - mean) / std,
  };
}

/**
 * Mean-reversion entry signal from a z-score.
 * A low (very negative) z means the series is "cheap" vs its rolling mean, so
 * the mean-reversion trade is to go LONG (expect it to revert up); a high z is
 * "rich" -> SHORT. Between warn and entry thresholds it's a WATCH.
 */
export function deriveSignal(z: number | null, entryZ: number, warnZ: number): Signal {
  if (z == null) return "NONE";
  const a = Math.abs(z);
  if (a >= entryZ) return z <= 0 ? "ENTRY_LONG" : "ENTRY_SHORT";
  if (a >= warnZ) return "WATCH";
  return "NONE";
}

export const SIGNAL_LABEL: Record<Signal, string> = {
  ENTRY_LONG: "ENTRY LONG",
  ENTRY_SHORT: "ENTRY SHORT",
  WATCH: "WATCH",
  NONE: "—",
};

/**
 * Align a value series onto a master date array for lightweight-charts, using
 * whitespace points ({ time } with no value) wherever the value is null. This
 * keeps every synced chart's series at an identical index length so
 * logical-range sync lines up (see use-synced-time-scales.ts).
 */
export type AlignedPoint = { time: string; value?: number };

export function alignToDates(dates: string[], values: MaybeNumber[]): AlignedPoint[] {
  return dates.map((time, i) => {
    const v = values[i];
    return v == null ? { time } : { time, value: v };
  });
}

/** Align a date->value map (e.g. backend points) onto the master date array. */
export function alignMapToDates(dates: string[], byDate: Map<string, number>): AlignedPoint[] {
  return dates.map((time) => {
    const v = byDate.get(time);
    return v == null ? { time } : { time, value: v };
  });
}

