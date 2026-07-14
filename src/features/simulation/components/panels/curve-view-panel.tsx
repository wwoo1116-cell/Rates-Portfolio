"use client";

/**
 * Curve View panel — STAGED. In S5 this becomes the shock-curve preview (source
 * ScenarioPreviewChart: term-structure + time-path), rewritten from recharts onto
 * the target's lightweight-charts + d3, reading colors from ../lib/chart-theme.ts.
 * The original recharts component (../scenario-preview-chart.tsx) is @ts-nocheck and
 * deliberately NOT imported here, so this panel enters `next build` clean.
 *
 * Mounted via next/dynamic({ ssr: false }) at the host — the boundary that will keep
 * S5's canvas/window access out of SSR.
 */
import { useSimulationPort } from "../../hooks/use-simulation";

export function CurveViewPanel() {
  const { params } = useSimulationPort();
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-bg-secondary p-4 text-center">
      <span className="inline-block h-2.5 w-2.5 bg-chart-ocean" aria-hidden />
      <p className="text-body-strong text-fg-secondary">시나리오 커브 미리보기</p>
      <p className="text-micro text-fg-muted">
        D+{params.simDays} · 최종 {params.baseShockBp}bp — 포트 연동 완료
      </p>
      <p className="text-micro text-fg-dim">S5: recharts → lightweight-charts 이식 (chart-theme.ts 팔레트).</p>
    </div>
  );
}
