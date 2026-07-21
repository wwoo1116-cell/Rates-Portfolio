"use client";

/**
 * RECON-DAILY range mode (Rates History mount) — per-day residual series.
 *
 * LAZY by design: nothing is fetched until the user presses 계산. Each day of
 * the window costs the full single-date machinery (2 snapshots + book-daily-
 * pnl + pvbp-sensitivity, the last ~5.5s cache-cold server-side per date —
 * the T3-measured shared-delta repricing), so the run is SEQUENTIAL (never a
 * request storm at a 4-worker server), incremental (rows appear as computed),
 * and deliberately uncached (mandate: no new caching; a re-run recomputes).
 * Default window 20 business days; 확장 widens by 20 more.
 *
 * Per-day arithmetic is the SAME lib functions the single-date footer uses
 * (deltaBpByTenor / assumedTotal / realizedFromByClass / closureFooter), so a
 * strip row and the single-date view can never disagree about a date.
 */
import { useCallback, useRef, useState } from "react";
import { marketDataApi, portfolioAnalyticsApi } from "@/lib/api-client";
import { useMarketDataRange } from "@/hooks/use-api";
import { useCombinedPositions } from "@/hooks/use-portfolio-analytics";
import { useSettingsStore } from "@/stores/settings-store";
import {
  assumedTotal,
  bridgeLadder,
  deltaBpByTenor,
  realizedFromByClass,
} from "@/lib/daily-recon-math";
import { TENOR_COLS } from "@/features/home/pvbp-sensitivity-table";
import type { BookDailyPnlResponse } from "@/lib/api-types";

export const RANGE_WINDOW_DEFAULT = 20;
export const RANGE_WINDOW_STEP = 20;

export interface ReconRangeRow {
  /** The reconciliation day D (server-confirmed as_of). */
  asOf: string;
  /** The close D−1 the assumed leg priced off. */
  close: string;
  /** FB3 ladder terms — 테타 (T−1 기지) and 예상 = 테타 + Assumed. */
  theta: number | null;
  assumed: number | null;
  expected: number | null;
  /** 테타 + 채권평가 + 스왑평가 (the compared bucket; funding excluded). */
  realized: number | null;
  residual: number | null;
  residualPct: number | null;
  /** Honest reason a figure is missing — rendered, never silently zeroed. */
  note?: string;
  /** RECON2-RH — the day's per-tenor Δbp map, RETAINED from the loop's ONE
   * deltaBpByTenor call (the exact object assumedTotal consumed; the Δbp
   * time-series chart is a view over this retained map — a forked
   * recomputation fails scripts/check_deltabp_reuse.test.ts). Present
   * whenever the day's window matched (Δbp is snapshot-derived and valid
   * even when the closure footer is disabled); absent on window-mismatch
   * rows, where a Δbp would measure a different window than the label
   * claims — those days render as whitespace, never zero. */
  deltaBp?: Record<string, number | null>;
}

export function useReconRange() {
  const combinedPositions = useCombinedPositions();
  const fundingSpreadBp = useSettingsStore((s) => s.fundingSpreadBp);
  const rangeQuery = useMarketDataRange();

  const [rows, setRows] = useState<ReconRangeRow[] | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [windowSize, setWindowSize] = useState(RANGE_WINDOW_DEFAULT);
  const [error, setError] = useState<string | null>(null);
  // Guards a stale async loop after re-run/unmount-race: only the latest run
  // may publish rows.
  const runIdRef = useRef(0);

  const availableDates = rangeQuery.data?.available_dates;

  const run = useCallback(
    async (size: number) => {
      const dates = availableDates ?? [];
      if (dates.length < 2 || combinedPositions.length === 0 || running) return;
      const runId = ++runIdRef.current;
      setRunning(true);
      setError(null);
      setWindowSize(size);

      // (close, asOf) pairs over consecutive AVAILABLE dates, newest last.
      const pairs: Array<[string, string]> = [];
      for (let i = Math.max(1, dates.length - size); i < dates.length; i++) {
        pairs.push([dates[i - 1], dates[i]]);
      }
      setProgress({ done: 0, total: pairs.length });

      const out: ReconRangeRow[] = [];
      try {
        for (const [close, asOf] of pairs) {
          const closeSnap = await marketDataApi.snapshot(close);
          const asOfSnap = await marketDataApi.snapshot(asOf);
          const base = {
            valuation_date: closeSnap.valuation_date,
            cd_rate: closeSnap.cd_rate,
            on_rate: closeSnap.on_rate,
            swap_quotes: closeSnap.swap_quotes,
            positions: combinedPositions,
          };
          const daily: BookDailyPnlResponse = await portfolioAnalyticsApi.bookDailyPnl({
            ...base,
            funding_spread_bp: fundingSpreadBp,
          });
          if (runId !== runIdRef.current) return;

          if (daily.as_of !== asOf) {
            // Calendar gap: the server's T for this close is not the next
            // AVAILABLE date, so the realized buckets measure a different
            // window than Δbp would. Excluded honestly rather than mixed.
            out.push({
              asOf,
              close,
              theta: null,
              assumed: null,
              expected: null,
              realized: null,
              residual: null,
              residualPct: null,
              note: `서버 평가일 ${daily.as_of} ≠ 다음 가용일 — 창 불일치로 제외`,
            });
          } else {
            const pvbpRows = (await portfolioAnalyticsApi.pvbpSensitivity(
              base,
            )) as Array<Record<string, unknown>>;
            if (runId !== runIdRef.current) return;
            const deltaBp = deltaBpByTenor(TENOR_COLS, closeSnap, asOfSnap);
            const assumed = assumedTotal(TENOR_COLS, pvbpRows, deltaBp);
            const totalRow = daily.by_book.find((r) => r.book === "Total");
            const realized = realizedFromByClass(totalRow?.by_class);
            const theta = totalRow?.theta ?? null;
            if (assumed === undefined) {
              out.push({
                asOf, close, theta, assumed: null, expected: null, realized: null,
                residual: null, residualPct: null, note: "KRD 합계 행 없음", deltaBp,
              });
            } else if ("disabledReason" in realized) {
              // 테타/Assumed are deterministic — retained; the ladder's
              // comparison side is the unknowable part.
              out.push({
                asOf, close, theta, assumed,
                expected: theta !== null ? theta + assumed : null,
                realized: null, residual: null, residualPct: null,
                note: realized.disabledReason, deltaBp,
              });
            } else {
              const f = bridgeLadder(theta ?? 0, assumed, realized.bondMtm, realized.swapMtm);
              out.push({
                asOf, close, theta: f.theta, assumed: f.assumed, expected: f.expected,
                realized: f.realized, residual: f.residual, residualPct: f.residualPct, deltaBp,
              });
            }
          }
          if (runId !== runIdRef.current) return;
          setProgress({ done: out.length, total: pairs.length });
          setRows([...out]); // incremental — slow runs show partial progress
        }
      } catch (e) {
        if (runId === runIdRef.current) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (runId === runIdRef.current) setRunning(false);
      }
    },
    [availableDates, combinedPositions, fundingSpreadBp, running],
  );

  const maxWindow = Math.max(0, (availableDates?.length ?? 0) - 1);
  return {
    rows,
    running,
    progress,
    error,
    windowSize,
    maxWindow,
    canRun: (availableDates?.length ?? 0) >= 2 && combinedPositions.length > 0,
    run: () => run(windowSize),
    widen: () => run(Math.min(windowSize + RANGE_WINDOW_STEP, Math.max(1, maxWindow))),
  };
}
