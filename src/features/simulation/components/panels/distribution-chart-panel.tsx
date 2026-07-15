"use client";

/**
 * Distribution / Total-Return panel (S5) — the source ScenarioSimulator's multi-series
 * Total-Return trace, rewritten from recharts onto lightweight-charts: 채권 MTM / 캐리 /
 * 스왑세타 / 스왑평가 / 합계, with a y=0 baseline and a BEP marker. Reads port.lastRun;
 * colors from chart-theme.ts. Loaded via next/dynamic({ ssr:false }).
 *
 * Deferred to the S5 visual-baseline pass: rich hover tooltip (won/억 formatting, weekend
 * flags) and the inline legend chips — the current 5-line trace + BEP marker is the core.
 */
import { useMemo } from "react";

import { getSimulationChartTheme } from "../../lib/chart-theme";
import { useSimulationPort } from "../../hooks/use-simulation";
import { LwLineChart, dayToTime, type LwMarker, type LwSeriesDef } from "../charts/lw-line-chart";

const asNum = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function DistributionChartPanel() {
  const { lastRun, inputs, status } = useSimulationPort();

  const series = useMemo<LwSeriesDef[]>(() => {
    if (!lastRun) return [];
    const t = getSimulationChartTheme();
    const rows = lastRun.chartData;
    const line = (key: string, color: string, lineWidth: 1 | 2 | 3 | 4 = 2): LwSeriesDef => ({
      color,
      lineWidth,
      data: rows.map((r) => ({ time: dayToTime(inputs.baseDate, asNum(r.day)), value: asNum(r[key]) })),
    });
    return [
      line("mtmPnL", t.series.mtm),
      line("cumulativeCarry", t.series.carry),
      line("swapThetaPnL", t.series.swapTheta),
      line("swapValuationPnL", t.series.swapValuation),
      line("totalPnL", t.series.total, 3),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastRun, inputs.baseDate]);

  const markers = useMemo<LwMarker[]>(() => {
    const bep = lastRun?.summary.breakEvenDay ?? -1;
    if (!lastRun || bep <= 0) return [];
    return [{ time: dayToTime(inputs.baseDate, bep), text: "BEP", color: getSimulationChartTheme().bepLine }];
  }, [lastRun, inputs.baseDate]);

  if (!lastRun) {
    return (
      <div className="flex h-full w-full items-center justify-center p-4 text-center">
        <p className="text-body text-fg-muted">
          {status === "running" ? "엔진 계산 중..." : "시뮬레이션을 실행하면 Total Return 궤적이 표시됩니다."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col p-3">
      <h3 className="mb-2 text-body-strong text-fg-primary">Total Return 누적 궤적</h3>
      <div className="min-h-0 flex-1">
        <LwLineChart series={series} zeroLine markers={markers} />
      </div>
      <p className="mt-1.5 text-center text-micro text-fg-dim">
        MTM · 캐리 · 스왑세타 · 스왑평가 · <span className="text-fg-secondary">합계</span>
      </p>
    </div>
  );
}
