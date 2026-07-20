"use client";

/**
 * Stage 3 (s17). Two natures on one screen, deliberately:
 *  - LIVE surfaces — Z-Score Oscillator and the Signals watchlist — track the
 *    live store config and market data (monitoring is always-on).
 *  - PINNED surfaces — the backtest KPI block, trades table and Cumulative
 *    P&L — compute from store.lastRun (usePinnedBacktest), the snapshot taken
 *    when 실행 was pressed.
 * If the live config drifts from the pinned run (e.g. the user refocuses a
 * row in the Signals grid), the run is NOT silently recomputed: a stale
 * banner marks the backtest block as belonging to the chipped parameters
 * until 다시 실행 replaces it. 조건 수정 returns to Configure with the live
 * store values untouched, so every input round-trips.
 */

import { Button } from "@/components/ui/button";
import { useEntrySignalsStore, type EsRunConfig } from "@/stores/entry-signals-store";
import { BacktestPanel } from "../panels/backtest-panel";
import { EquityCurvePanel } from "../panels/equity-curve-panel";
import { SignalGridPanel } from "../panels/signal-grid-panel";
import { ZScoreOscillatorPanel } from "../panels/zscore-oscillator-panel";
import { usePinnedBacktest, useRunIsStale } from "../../hooks/use-pinned-backtest";

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      data-num
      className="inline-flex h-6 items-center border border-border-subtle bg-bg-secondary px-2 text-micro tabular-nums text-fg-secondary"
    >
      {children}
    </span>
  );
}

/** The pinned run's parameters, exactly as they were at 실행 time. */
function RunChips({ run, label }: { run: EsRunConfig; label: string }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5" aria-label="실행 파라미터">
      <Chip>{label}</Chip>
      <Chip>lookback {run.lookback}D</Chip>
      <Chip>entry ±{run.entryZ}σ</Chip>
      <Chip>watch ±{run.warnZ}σ</Chip>
      <Chip>exit ±{run.exitZ}σ</Chip>
      <Chip>stop ±{run.stopZ}σ</Chip>
      <Chip>cost {run.costBp}bp</Chip>
      <Chip>notional {run.notional.toLocaleString()}</Chip>
      <Chip>{run.ranAt.slice(0, 16).replace("T", " ")}</Chip>
    </div>
  );
}

export function ResultsStage() {
  const pinned = usePinnedBacktest();
  const stale = useRunIsStale();
  const editConfig = useEntrySignalsStore((s) => s.editConfig);
  const startRun = useEntrySignalsStore((s) => s.startRun);
  const focused = useEntrySignalsStore((s) => s.focused);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        {pinned ? <RunChips run={pinned.run} label={pinned.label} /> : <span />}
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={!focused}
            onClick={startRun}
            aria-label="다시 실행"
          >
            다시 실행
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={editConfig} aria-label="조건 수정">
            조건 수정
          </Button>
        </div>
      </div>

      {stale && (
        /* Honesty marker, not a blocker: live surfaces below already follow
           the new config; only the backtest snapshot is pinned to the chips. */
        <div className="border border-border-subtle bg-bg-secondary px-3 py-1.5 text-micro text-sem-risk" role="status">
          설정이 변경되었습니다 — 백테스트 결과(KPI · 체결 · 누적 손익)는 위 칩의 이전 실행
          파라미터 기준입니다. 반영하려면 다시 실행하세요.
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-3">
        <div className="min-h-0 min-w-0">
          <ZScoreOscillatorPanel />
        </div>
        <div className="min-h-0 min-w-0">
          <SignalGridPanel showSelector={false} />
        </div>
        <div className="min-h-0 min-w-0">
          <EquityCurvePanel />
        </div>
        <div className="min-h-0 min-w-0">
          <BacktestPanel />
        </div>
      </div>
    </div>
  );
}
