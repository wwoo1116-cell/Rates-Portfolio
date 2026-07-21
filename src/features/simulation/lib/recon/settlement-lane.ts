/**
 * RECON-SCEN T4b — the simulation cashflow lane (swaps only).
 *
 * Two lanes of the SAME settlement cash, both already computed by the engine
 * run — nothing is re-priced here:
 *  - PROJECTED: irsSettlementEvents — per-position net settlements under
 *    SCENARIO fixings, produced by the FM path's scf_s off the same
 *    qe.IRS_Trade ISDA schedule machinery the PM tab's cashflow pricing uses
 *    (backend chart.py; the schedule source is shared engine-side).
 *  - ENGINE SETTLE LANE: irsDailyReconciliation[].settleCf — the recon loop's
 *    own window sums of that cash between business days.
 * The 대사 here checks the two lanes agree window-for-window (±₩1 rounding).
 *
 * Settlement days only; a day without a settlement is an honest empty, never
 * a zero row. Bond cashflows are deferred (swap-only lane by ruling).
 *
 * Realized-history tie (pinned in settlement-lane.test.ts): a swap period
 * whose fixing was already set at baseDate has scenario == realized history —
 * its projected settlement equals the hand-computable realized value
 * notional × (fixed − float) × actualDays/365 × direction, independent of the
 * scenario path (the fixtures pin this across three different scenarios).
 */
import type { SimulateResponse } from "../../api/simulate-dto";

export interface SettlementRow {
  day: number;
  date: string | null;
  positionName: string;
  positionId: string;
  fixedRate: number;
  settledCf: number;
}

export interface SettlementDay {
  day: number;
  date: string | null;
  rows: SettlementRow[];
  /** Net projected settlement cash across positions settling that day. */
  projectedNet: number;
}

export interface ReconWindow {
  /** The recon business day closing the window (prevReconDay, reconDay]. */
  reconDay: number;
  date: string;
  engineSettleCf: number;
  projectedSum: number;
  match: boolean;
}

export interface SettlementLane {
  days: SettlementDay[];
  /** Only windows where either lane carries cash — empty windows are honest
   * empties, not zero rows. */
  windows: ReconWindow[];
  allMatch: boolean;
}

const MATCH_TOLERANCE_KRW = 1; // both lanes are engine-rounded to ₩1

export function buildSettlementLane(resp: SimulateResponse): SettlementLane {
  const events = [...(resp.irsSettlementEvents ?? [])].sort(
    (a, b) => a.day - b.day || a.positionId.localeCompare(b.positionId),
  );

  const byDay = new Map<number, SettlementDay>();
  for (const ev of events) {
    const entry = byDay.get(ev.day) ?? { day: ev.day, date: ev.date, rows: [], projectedNet: 0 };
    entry.rows.push({
      day: ev.day,
      date: ev.date,
      positionName: ev.positionName,
      positionId: ev.positionId,
      fixedRate: ev.fixedRate,
      settledCf: ev.settledCf,
    });
    entry.projectedNet += ev.settledCf;
    byDay.set(ev.day, entry);
  }
  const days = [...byDay.values()].sort((a, b) => a.day - b.day);

  const windows: ReconWindow[] = [];
  let prev = 0;
  for (const r of [...(resp.irsDailyReconciliation ?? [])].sort((a, b) => a.day - b.day)) {
    const projectedSum = events
      .filter((ev) => ev.day > prev && ev.day <= r.day)
      .reduce((s, ev) => s + ev.settledCf, 0);
    if (r.settleCf !== 0 || projectedSum !== 0) {
      windows.push({
        reconDay: r.day,
        date: r.date,
        engineSettleCf: r.settleCf,
        projectedSum,
        match: Math.abs(r.settleCf - projectedSum) <= MATCH_TOLERANCE_KRW,
      });
    }
    prev = r.day;
  }

  return { days, windows, allMatch: windows.every((w) => w.match) };
}
