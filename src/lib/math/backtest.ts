/**
 * Client-side z-score mean-reversion backtest.
 *
 * A faithful port of the backend irs_pricer/services/spread_backtest_service.py
 * (run_spread_backtest + _summarize), so the Entry Signals tab can backtest ANY
 * focused instrument -- IRS / KTB / credit spreads AND outrights -- not just the
 * IRS-only pairs the backend endpoint supports. For IRS spreads the output is
 * parity-checked against the backend (see verification).
 *
 * Convention (same as backend): pnl = direction * notional * Δvalue_bp, where
 * `notional` is a per-bp sensitivity, not a swap notional. Values must be passed
 * in bp (spreads already are; outright decimal rates are scaled ×10000 by the
 * caller). z-score is scale-invariant, so signals are unaffected by that scaling.
 */

import { rollingZScore } from "./rolling-stats";

export interface BacktestParams {
  lookback: number;
  entryZ: number;
  exitZ: number;
  stopZ: number;
  costBp: number;
  notional: number;
}

export interface BtPoint {
  date: string;
  value: number; // bp
  z: number | null;
  position: number; // -1 | 0 | +1 held DURING this day
  dailyPnl: number;
  cumulativePnl: number;
}

export interface BtTrade {
  entryDate: string;
  exitDate: string;
  direction: number; // +1 | -1
  entryZ: number;
  exitZ: number;
  entryValue: number; // bp
  exitValue: number; // bp
  pnl: number;
  exitReason: "exit" | "stop";
}

export interface BtSummary {
  totalPnl: number;
  maxDrawdown: number;
  winRate: number | null;
  sharpe: number | null;
  numTrades: number;
}

export interface BtResult {
  points: BtPoint[];
  trades: BtTrade[];
  summary: BtSummary;
}

function mean(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function pstdev(xs: number[]): number {
  const m = mean(xs);
  let sq = 0;
  for (const x of xs) {
    const d = x - m;
    sq += d * d;
  }
  return Math.sqrt(sq / xs.length);
}

export function simulateMeanReversion(dates: string[], values: number[], p: BacktestParams): BtResult {
  const n = values.length;
  const z = rollingZScore(values, p.lookback);

  const points: BtPoint[] = [];
  const trades: BtTrade[] = [];

  let position = 0;
  let entryIdx: number | null = null;
  let entryZVal: number | null = null;
  let tradePnl = 0;
  let cumulative = 0;

  for (let i = 0; i < n; i++) {
    let dailyPnl = 0;
    const zi = z[i];

    if (position !== 0) {
      dailyPnl += position * p.notional * (values[i] - values[i - 1]);
      tradePnl += dailyPnl;

      if (zi != null) {
        const shouldStop = Math.abs(zi) >= p.stopZ;
        const shouldExit = Math.abs(zi) <= p.exitZ;
        if (shouldStop || shouldExit) {
          const exitCost = p.notional * p.costBp;
          dailyPnl -= exitCost;
          tradePnl -= exitCost;
          trades.push({
            entryDate: dates[entryIdx as number],
            exitDate: dates[i],
            direction: position,
            entryZ: entryZVal as number,
            exitZ: zi,
            entryValue: values[entryIdx as number],
            exitValue: values[i],
            pnl: tradePnl,
            exitReason: shouldStop ? "stop" : "exit",
          });
          position = 0;
          entryIdx = null;
          entryZVal = null;
          tradePnl = 0;
        }
      }
    } else if (zi != null && Math.abs(zi) >= p.entryZ) {
      // value too high vs its rolling mean -> bet it falls (short); too low -> long.
      position = zi > 0 ? -1 : 1;
      entryIdx = i;
      entryZVal = zi;
      const entryCost = p.notional * p.costBp;
      dailyPnl -= entryCost;
      tradePnl = dailyPnl;
    }

    cumulative += dailyPnl;
    points.push({ date: dates[i], value: values[i], z: zi, position, dailyPnl, cumulativePnl: cumulative });
  }

  return { points, trades, summary: summarize(points, trades) };
}

function summarize(points: BtPoint[], trades: BtTrade[]): BtSummary {
  const totalPnl = points.length ? points[points.length - 1].cumulativePnl : 0;

  let maxDrawdown = 0;
  let runningMax = -Infinity;
  for (const pt of points) {
    runningMax = Math.max(runningMax, pt.cumulativePnl);
    maxDrawdown = Math.max(maxDrawdown, runningMax - pt.cumulativePnl);
  }

  const winRate = trades.length ? trades.filter((t) => t.pnl > 0).length / trades.length : null;

  let sharpe: number | null = null;
  const daily = points.map((pt) => pt.dailyPnl);
  if (daily.length >= 2) {
    const sd = pstdev(daily);
    if (sd !== 0) sharpe = (mean(daily) / sd) * Math.sqrt(252);
  }

  return { totalPnl, maxDrawdown, winRate, sharpe, numTrades: trades.length };
}
