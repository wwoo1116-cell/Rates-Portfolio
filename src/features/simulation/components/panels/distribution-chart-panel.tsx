"use client";

/**
 * Distribution / Total-Return panel (S5) — the source ScenarioSimulator's multi-series
 * Total-Return trace: 채권 MTM / 캐리 / 스왑세타 / 스왑평가 / 합계, with a y=0 baseline
 * and a BEP marker. Reads port.lastRun; colors from chart-theme.ts. Loaded via
 * next/dynamic({ ssr:false }).
 *
 * S7 re-skin: rendered on the canonical SeriesChart (@/components/charts — the
 * sanctioned S7 addition to the slice's import allowlist), replacing the footer
 * text legend with series pills, adding last-value badges, the shared crosshair
 * reticle + tooltip, and 억/만-scaled y-axis units. Presentation only — the
 * simulation port, its data shape, and the BEP computation are untouched.
 */
import { useMemo } from "react";

import { formatKrwAxis } from "@/lib/format";
import {
  SeriesChart,
  type SeriesChartMarker,
  type SeriesChartSeriesDef,
} from "@/components/charts/series-chart";
import { getSimulationChartTheme } from "../../lib/chart-theme";
import { useSimulationPort } from "../../hooks/use-simulation";
import { dayToTime } from "../charts/lw-line-chart";

const asNum = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function DistributionChartPanel() {
  const { lastRun, inputs, status } = useSimulationPort();

  const series = useMemo<SeriesChartSeriesDef[]>(() => {
    if (!lastRun) return [];
    const t = getSimulationChartTheme();
    const rows = lastRun.chartData;
    const line = (
      key: string,
      label: string,
      color: string,
      lineWidth: 1 | 2 | 3 | 4 = 2,
    ): SeriesChartSeriesDef => ({
      id: key,
      label,
      color,
      lineWidth,
      // Pills name the series; keep the price-scale badges value-only.
      axisTitle: "",
      formatter: formatKrwAxis,
      data: rows.map((r) => ({ time: dayToTime(inputs.baseDate, asNum(r.day)), value: asNum(r[key]) })),
    });
    // Same order as the retired footer legend (MTM · 캐리 · 스왑세타 · 스왑평가 ·
    // 합계): 합계 added last so the emphasized width-3 line draws on top.
    return [
      line("mtmPnL", "MTM", t.series.mtm),
      line("cumulativeCarry", "캐리", t.series.carry),
      line("swapThetaPnL", "스왑세타", t.series.swapTheta),
      line("swapValuationPnL", "스왑평가", t.series.swapValuation),
      line("totalPnL", "합계", t.series.total, 3),
    ];
  }, [lastRun, inputs.baseDate]);

  const markers = useMemo<SeriesChartMarker[]>(() => {
    const bep = lastRun?.summary.breakEvenDay ?? -1;
    if (!lastRun || bep <= 0) return [];
    return [{ time: dayToTime(inputs.baseDate, bep), text: "BEP", color: getSimulationChartTheme().bepLine }];
  }, [lastRun, inputs.baseDate]);

  // Canvas sits on the canonical panel surface (--bg-surface), read at render
  // time like every other slice chart color.
  const chartOptions = useMemo(
    () => ({ layout: { background: { color: getSimulationChartTheme().background } } }),
    [],
  );

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
        <SeriesChart
          series={series}
          pills
          tooltip
          zeroLine
          markers={markers}
          priceLineVisible={false}
          chartOptions={chartOptions}
        />
      </div>
    </div>
  );
}
