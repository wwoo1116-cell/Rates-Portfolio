"use client";

/**
 * Running stage (s15 T3) — interstitial while POST /api/simulate is in flight.
 *
 * HONESTY NOTE: the endpoint is a single request/response (no streaming, no
 * progress channel — Phase 0 runtime audit), so the ONLY real signals are
 * "request started" and "response arrived". The three engine stages are shown
 * as the engine's actual pipeline for orientation, but none is ticked off on a
 * timer — the list carries a single indeterminate in-progress marker and the
 * elapsed clock is the honest live signal. If the backend ever streams stage
 * events, wire them here; do not simulate them.
 */
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useSimulationPort } from "../../hooks/use-simulation";

const ENGINE_STAGES = [
  { key: "bootstrap", label: "커브 부트스트랩", detail: "영업일별 제로커브 구성" },
  { key: "pricing", label: "시나리오 프라이싱", detail: "채권 MTM·캐리 + IRS Full Revaluation" },
  { key: "quantile", label: "분위수 구성", detail: "금리 분위수 시나리오 4런 (팬 밴드)" },
] as const;

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
          <h2 className="text-h2 text-fg-primary">엔진 계산 중</h2>
          <span data-num className="text-body-strong text-sem-info">{seconds}s</span>
        </div>
        <p className="mb-5 text-micro text-fg-muted">
          단일 요청 계산 — 단계별 진행 신호는 제공되지 않습니다 (경과 시간이 실제 신호).
        </p>

        <ol className="space-y-3">
          {ENGINE_STAGES.map((s, i) => (
            <li key={s.key} className="flex items-start gap-3">
              {/* Indeterminate: the whole pipeline is in flight, no fake ticks. */}
              <span
                aria-hidden
                className="mt-1.5 h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-sem-info"
                style={{ animationDelay: `${i * 200}ms` }}
              />
              <div className="min-w-0">
                <p className="text-body-strong text-fg-primary">{s.label}</p>
                <p className="text-micro text-fg-dim">{s.detail}</p>
              </div>
            </li>
          ))}
        </ol>

        <Button type="button" variant="secondary" size="md" onClick={cancelRun} className="mt-6 w-full">
          취소
        </Button>
      </div>
    </div>
  );
}
