"use client";

/**
 * Stage 1 of the Entry Signals staged flow (s17): everything the user tunes,
 * grouped in run order — pair/watchlist, signal params, backtest params —
 * with one full-width CTA. The only output on this screen is the live
 * price/spread preview of the focused pair (it reuses the already-cached
 * series, so it costs nothing and is the one chart that helps configuring).
 * Control grammar follows the Simulation config pass (config-controls.tsx).
 */

import { Button } from "@/components/ui/button";
import { InstrumentSelector } from "@/features/rates-history/instrument-selector";
import { instrumentLabel } from "@/lib/rv-instruments";
import { LOOKBACK_PRESETS, useEntrySignalsStore } from "@/stores/entry-signals-store";
import { cn } from "@/lib/utils";
import { SegmentedButtons, StepperField } from "./config-controls";
import { NumberField } from "../panels/panel-shell";
import { PricePanel } from "../panels/price-panel";
import { useEntrySignalsData } from "../../hooks/use-entry-signals-data";

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="border-b border-border-subtle pb-1 text-label font-bold uppercase text-fg-muted">
      {children}
    </span>
  );
}

/** Watchlist entries double as the run-target picker: the pressed chip is the
 * instrument the backtest (and the live z-score) tracks. */
function FocusPicker() {
  const watchlist = useEntrySignalsStore((s) => s.watchlist);
  const focused = useEntrySignalsStore((s) => s.focused);
  const setFocused = useEntrySignalsStore((s) => s.setFocused);

  if (watchlist.length === 0) {
    return (
      <span className="text-micro text-fg-dim">
        위에서 종목을 추가하면 백테스트 대상을 선택할 수 있습니다.
      </span>
    );
  }
  return (
    <div role="group" aria-label="백테스트 대상" className="flex flex-wrap gap-1.5">
      {watchlist.map((inst) => {
        const pressed = focused?.id === inst.id;
        return (
          <Button
            key={inst.id}
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={pressed}
            onClick={() => setFocused(inst)}
            className={cn(
              "text-micro",
              pressed
                ? "bg-sem-info-ghost text-sem-info shadow-[inset_0_0_0_1px_var(--sem-info)]"
                : "text-fg-muted",
            )}
          >
            {instrumentLabel(inst)}
          </Button>
        );
      })}
    </div>
  );
}

export function ConfigureStage() {
  const { taxonomy } = useEntrySignalsData();

  const lookback = useEntrySignalsStore((s) => s.lookback);
  const entryZ = useEntrySignalsStore((s) => s.entryZ);
  const warnZ = useEntrySignalsStore((s) => s.warnZ);
  const exitZ = useEntrySignalsStore((s) => s.exitZ);
  const stopZ = useEntrySignalsStore((s) => s.stopZ);
  const costBp = useEntrySignalsStore((s) => s.costBp);
  const notional = useEntrySignalsStore((s) => s.notional);
  const focused = useEntrySignalsStore((s) => s.focused);
  const watchlist = useEntrySignalsStore((s) => s.watchlist);
  const setLookback = useEntrySignalsStore((s) => s.setLookback);
  const setEntryZ = useEntrySignalsStore((s) => s.setEntryZ);
  const setWarnZ = useEntrySignalsStore((s) => s.setWarnZ);
  const setExitZ = useEntrySignalsStore((s) => s.setExitZ);
  const setStopZ = useEntrySignalsStore((s) => s.setStopZ);
  const setCostBp = useEntrySignalsStore((s) => s.setCostBp);
  const setNotional = useEntrySignalsStore((s) => s.setNotional);
  const addToWatchlist = useEntrySignalsStore((s) => s.addToWatchlist);
  const removeFromWatchlist = useEntrySignalsStore((s) => s.removeFromWatchlist);
  const startRun = useEntrySignalsStore((s) => s.startRun);

  const canRun = focused != null;

  return (
    <div className="flex h-full min-h-0 gap-4 p-4">
      {/* Controls column */}
      <div className="flex w-[460px] shrink-0 flex-col gap-5 overflow-auto pr-1">
        <div className="flex items-baseline justify-between">
          <span className="text-h2 text-fg-primary">Entry Signals</span>
          <span className="text-micro text-fg-muted">1 · 설정 → 2 · 실행 → 3 · 결과</span>
        </div>

        {/* 1. Pair / watchlist */}
        <div className="flex flex-col gap-2.5">
          <GroupLabel>1 · Pair / Watchlist</GroupLabel>
          <InstrumentSelector
            taxonomy={taxonomy}
            selected={watchlist}
            onAdd={addToWatchlist}
            onRemove={removeFromWatchlist}
          />
          <div className="flex flex-col gap-1.5">
            <span className="text-label uppercase text-fg-muted">백테스트 대상</span>
            <FocusPicker />
          </div>
        </div>

        {/* 2. Signal params */}
        <div className="flex flex-col gap-2.5">
          <GroupLabel>2 · Signal Params</GroupLabel>
          <div>
            <span className="mb-1 block text-label uppercase text-fg-muted">Lookback</span>
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <SegmentedButtons
                  choices={LOOKBACK_PRESETS}
                  value={lookback}
                  onChange={setLookback}
                  format={(v) => `${v}D`}
                  label="Lookback"
                />
              </div>
              <NumberField label="CUSTOM (D)" value={lookback} step="1" min={2} onCommit={setLookback} className="w-24" />
            </div>
          </div>
          <div className="flex gap-3">
            <StepperField label="Entry ±σ" value={entryZ} min={0} step={0.1} onCommit={setEntryZ} className="flex-1" />
            <StepperField label="Watch ±σ" value={warnZ} min={0} step={0.1} onCommit={setWarnZ} className="flex-1" />
          </div>
        </div>

        {/* 3. Backtest params */}
        <div className="flex flex-col gap-2.5">
          <GroupLabel>3 · Backtest Params</GroupLabel>
          <div className="flex gap-3">
            <StepperField label="Exit ±σ" value={exitZ} min={0} step={0.1} onCommit={setExitZ} className="flex-1" />
            <StepperField label="Stop ±σ" value={stopZ} min={0} step={0.1} onCommit={setStopZ} className="flex-1" />
          </div>
          <div className="flex gap-3">
            <StepperField label="Cost (bp)" value={costBp} min={0} step={0.01} onCommit={setCostBp} className="flex-1" />
            <StepperField label="Notional (₩/bp)" value={notional} min={0} step={100_000} onCommit={setNotional} className="flex-1" />
          </div>
        </div>

        <div title={canRun ? undefined : "백테스트 대상을 먼저 선택하세요"}>
          <Button
            type="button"
            size="lg"
            className="w-full"
            disabled={!canRun}
            onClick={startRun}
            aria-label="백테스트 실행"
          >
            백테스트 실행
          </Button>
        </div>
      </div>

      {/* Live preview — the focused pair's price/spread with SMA/bands. */}
      <div className="min-h-0 min-w-0 flex-1">
        <PricePanel />
      </div>
    </div>
  );
}
