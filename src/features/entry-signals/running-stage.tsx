"use client";

/**
 * Stage 2 (s17): honest interstitial. There is no backend progress stream —
 * the "run" is (a) the market-data queries the sim needs and (b) a synchronous
 * client-side computation — so this shows exactly what is knowable: an
 * indeterminate spinner, elapsed time, WHICH real phase is pending (network
 * fetch vs. series assembly), and cancel. No fabricated progress bars or
 * staged percentages. The stage auto-completes the moment the pinned
 * instrument's series is resolvable; with a warm query cache that is
 * immediate, and that is honest too.
 */

import { useEffect, useState } from "react";
import { Spinner } from "@blueprintjs/core";
import { Button } from "@/components/ui/button";
import { instrumentLabel } from "@/lib/rv-instruments";
import { useEntrySignalsStore } from "@/stores/entry-signals-store";
import { useEntrySignalsData } from "./use-entry-signals-data";

export function RunningStage() {
  const pendingRun = useEntrySignalsStore((s) => s.pendingRun);
  const completeRun = useEntrySignalsStore((s) => s.completeRun);
  const cancelRun = useEntrySignalsStore((s) => s.cancelRun);
  const { seriesById, isLoading, isError } = useEntrySignalsData();

  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const target = pendingRun ? seriesById.get(pendingRun.instrument.id) : undefined;
  const seriesReady = target != null && target.lineData.length > 0;

  useEffect(() => {
    // Defensive: landing here without a pending run (e.g. hot reload) bounces
    // back instead of hanging.
    if (!pendingRun) {
      cancelRun();
      return;
    }
    if (isError) return; // hold on the error surface below
    if (seriesReady) completeRun();
  }, [pendingRun, isError, seriesReady, completeRun, cancelRun]);

  const elapsed = ((now - startedAt) / 1000).toFixed(1);
  const phase = isLoading
    ? "시장 데이터 로딩 중…"
    : seriesReady
      ? "신호 계산 중…"
      : "시리즈 구성 중…";

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex w-[380px] flex-col items-center gap-4 border border-border-subtle bg-bg-surface px-8 py-10">
        {isError ? (
          <>
            <span className="text-body text-sem-danger">
              시장 데이터를 불러오지 못했습니다 — 가격 서버 연결을 확인하세요.
            </span>
            <Button type="button" variant="secondary" size="sm" onClick={cancelRun}>
              돌아가기
            </Button>
          </>
        ) : (
          <>
            <Spinner size={28} />
            <div className="flex flex-col items-center gap-1">
              <span className="text-body font-bold text-fg-primary">백테스트 실행 중</span>
              {pendingRun && (
                <span className="text-micro text-fg-muted">{instrumentLabel(pendingRun.instrument)}</span>
              )}
            </div>
            <span className="text-micro text-fg-muted">{phase}</span>
            <span data-num className="text-micro tabular-nums text-fg-dim">
              경과 {elapsed}s
            </span>
            <Button type="button" variant="secondary" size="sm" onClick={cancelRun} aria-label="실행 취소">
              취소
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
