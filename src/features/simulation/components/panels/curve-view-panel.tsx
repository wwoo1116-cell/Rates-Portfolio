"use client";

/**
 * Curve View panel (S5) — the source ScenarioPreviewChart's time-path view,
 * rewritten from recharts onto lightweight-charts. Shows the 국채 3Y bp path from the
 * waypoints (+ the 기준금리 cumulative path when 금통위 events exist). Colors come from
 * chart-theme.ts. Loaded via next/dynamic({ ssr:false }) at the mount.
 *
 * Deferred (needs the S5 visual-baseline pass): the 커브형/term-structure toggle and the
 * per-sector selector — the term-structure (tenor-axis) view doesn't map to lightweight-
 * charts' time axis and will use a small d3 render instead.
 */
import { useMemo } from "react";

import { getSimulationChartTheme } from "../../lib/chart-theme";
import { buildTimePath } from "../../lib/scenario-preview";
import { useSimulationPort } from "../../hooks/use-simulation";
import { LwLineChart, dayToTime, type LwSeriesDef } from "../charts/lw-line-chart";

export function CurveViewPanel() {
  const { params, inputs } = useSimulationPort();

  const series = useMemo<LwSeriesDef[]>(() => {
    const t = getSimulationChartTheme();
    const points = buildTimePath(params, inputs.baseDate);
    const gov: LwSeriesDef = {
      color: t.series.carry,
      lineWidth: 2,
      data: points.map((p) => ({ time: dayToTime(inputs.baseDate, p.day), value: p.gov3y })),
    };
    const defs: LwSeriesDef[] = [gov];
    if (points.some((p) => p.policyRate !== null)) {
      defs.push({
        color: t.axis,
        lineWidth: 2,
        dashed: true,
        data: points.map((p) => ({ time: dayToTime(inputs.baseDate, p.day), value: p.policyRate ?? 0 })),
      });
    }
    return defs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.waypoints, params.simDays, params.baseShockBp, params.shortEndEvents, inputs.baseDate]);

  const hasPolicy = series.length > 1;

  return (
    <div className="flex h-full w-full flex-col bg-bg-secondary p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-body-strong text-fg-primary">시나리오 커브 미리보기</h3>
        <span data-num className="text-micro text-fg-muted">
          D+{params.simDays} · 최종 {params.baseShockBp}bp
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <LwLineChart series={series} zeroLine />
      </div>
      <p className="mt-1.5 text-center text-micro text-fg-dim">
        국채 3Y 경로{hasPolicy ? " · 점선 = 기준금리 누적 변동" : ""}
      </p>
    </div>
  );
}
