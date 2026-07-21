"use client";

/**
 * Running stage (s15 T3, simplified per owner ruling 2026-07-21) — interstitial
 * while POST /api/simulate is in flight.
 *
 * HONESTY NOTE: the endpoint is a single request/response (no streaming, no
 * progress channel — Phase 0 runtime audit), so the ONLY real signals are
 * "request started" and "response arrived". The old three-item engine stage
 * list was removed: its third entry described the deleted σ-fan quantile runs
 * (HARDEN-1), and a static stage list invites fake-progress readings. The
 * elapsed clock is the honest live signal. If the backend ever streams stage
 * events, wire them here; do not simulate them.
 */
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useSimulationPort } from "../../hooks/use-simulation";

export function RunningStage() {
  const { cancelRun } = useSimulationPort();
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const id = window.setInterval(() => setElapsedMs(Date.now() - startedAt), 100);
    return () => window.clearInterval(id);
  }, []);

  const seconds = (elapsedMs / 1000).toFixed(1);

  return (
    <div className="flex h-full w-full items-center justify-center p-4">
      <div className="w-full max-w-md bg-bg-secondary p-6">
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-h2 text-fg-primary">시뮬레이션 계산 중</h2>
          <span data-num className="text-body-strong text-sem-info">{seconds}s</span>
        </div>
        <p className="mb-5 text-micro text-fg-muted">
          단일 요청 계산 — 단계별 진행 신호는 제공되지 않습니다 (경과 시간이 실제 신호).
        </p>

        <div className="flex items-center gap-3">
          {/* Indeterminate: the whole pipeline is in flight, no fake stage ticks. */}
          <span aria-hidden className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-sem-info" />
          <p className="text-body-strong text-fg-primary">엔진이 시나리오를 계산하고 있습니다</p>
        </div>

        <Button type="button" variant="secondary" size="md" onClick={cancelRun} className="mt-6 w-full">
          취소
        </Button>
      </div>
    </div>
  );
}
