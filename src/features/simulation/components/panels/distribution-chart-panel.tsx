"use client";

/**
 * Distribution / Total-Return chart panel — STAGED. In S5 this becomes the source
 * ScenarioSimulator's multi-series Total-Return trace (채권 MTM / 캐리 / 스왑 / 합계
 * with y=0 + BEP reference lines), rewritten from recharts onto lightweight-charts,
 * colors from ../lib/chart-theme.ts. The recharts source stays @ts-nocheck & unimported
 * so this panel builds clean; mounted via next/dynamic({ ssr: false }).
 */
import { useSimulationPort } from "../../hooks/use-simulation";

export function DistributionChartPanel() {
  const { lastRun } = useSimulationPort();
  const points = lastRun?.chartData.length ?? 0;
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-bg-secondary p-4 text-center">
      <span className="inline-block h-2.5 w-2.5 bg-chart-berry" aria-hidden />
      <p className="text-body-strong text-fg-secondary">Total Return 누적 궤적</p>
      <p data-num className="text-micro text-fg-muted">
        {points > 0 ? `${points} 포인트 수신 — 포트 연동 완료` : "실행 대기 중"}
      </p>
      <p className="text-micro text-fg-dim">S5: recharts → lightweight-charts 이식 (5-series, BEP/zero 기준선).</p>
    </div>
  );
}
