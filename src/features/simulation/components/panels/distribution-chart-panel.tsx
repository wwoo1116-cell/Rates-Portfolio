"use client";

/**
 * Distribution / Total-Return panel — s11 redesign (T3+T4).
 *
 * T3 (Marquee-style fan): the path display is distribution-based. The backend's
 * additive `distribution` field (deterministic quantile-scenario runs, see
 * simulation_service.build_distribution_bands) renders as a percentile fan:
 * bold median (aggregate emphasis token) + thin percentile edge lines through
 * the canonical SeriesChart (crosshair tooltip therefore reads percentile
 * values at the hovered time), with the 5–95 / 25–75 fills painted by the
 * slice-local FanBandSeries custom series, added through SeriesChart's public
 * onChartReady seam. Individual sample paths do not exist in the engine
 * (deterministic scenario runs), so there is no spaghetti layer.
 *
 * T4 (carry visibility): the additive `fundingCurve` field renders as a slim
 * second pane along the time axis (step line + last-value badge — visible
 * without hovering), and the header readout shows funding rate, position rate
 * and carry bp at the hovered time (last step when idle).
 *
 * Responses without the new fields (older cached runs) fall back to the S5/S7
 * five-series Total-Return view unchanged.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import { LineSeries, LineType } from "lightweight-charts";

import { formatKrwAxis } from "@/lib/format";
import {
  SeriesChart,
  type SeriesChartMarker,
  type SeriesChartSeriesDef,
} from "@/components/charts/series-chart";
import { getSimulationChartTheme } from "../../lib/chart-theme";
import { useSimulationPort } from "../../hooks/use-simulation";
import { dayToTime } from "../charts/lw-line-chart";
import { FanBandSeries, type FanBandData, type FanBandSeriesOptions } from "../charts/fan-band-series";
import type { FundingCurvePoint } from "../../api/simulate-dto";

const asNum = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

const formatPct = (v: number) => `${v.toFixed(2)}%`;
const formatBp = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}bp`;

/** Hover readout for the funding strip: funding / position / carry at a time. */
function FundingReadout({ point, hovered }: { point: FundingCurvePoint; hovered: boolean }) {
  return (
    <span className="flex items-baseline gap-2 whitespace-nowrap text-micro text-fg-muted" data-num>
      <span className="text-fg-dim">{hovered ? `D+${point.day}` : "현재"}</span>
      <span>
        Funding <span className="text-fg-primary">{formatPct(point.fundingRate * 100)}</span>
      </span>
      <span>
        운용{" "}
        <span className="text-fg-primary">
          {point.positionRate === null ? "—" : formatPct(point.positionRate * 100)}
        </span>
      </span>
      <span>
        Carry{" "}
        <span className={point.carryBp === null ? "text-fg-dim" : point.carryBp >= 0 ? "text-chart-pnl-pos" : "text-chart-pnl-neg"}>
          {point.carryBp === null ? "—" : formatBp(point.carryBp)}
        </span>
      </span>
    </span>
  );
}

export function DistributionChartPanel() {
  const { lastRun, inputs, status } = useSimulationPort();
  const [chart, setChart] = useState<IChartApi | null>(null);
  const bandSeriesRef = useRef<ISeriesApi<"Custom"> | null>(null);
  const fundingSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const [hoverDay, setHoverDay] = useState<number | null>(null);

  const distribution = lastRun?.distribution ?? null;
  const fundingCurve = lastRun?.fundingCurve ?? null;
  const hasFan = Boolean(distribution && distribution.bands.length > 0);

  // ── SeriesChart line defs ──────────────────────────────────────────────────
  const series = useMemo<SeriesChartSeriesDef[]>(() => {
    if (!lastRun) return [];
    const t = getSimulationChartTheme();
    const line = (
      id: string,
      label: string,
      color: string,
      data: { time: ReturnType<typeof dayToTime>; value: number }[],
      lineWidth: 1 | 2 | 3 | 4 = 2,
    ): SeriesChartSeriesDef => ({
      id,
      label,
      color,
      lineWidth,
      axisTitle: "",
      formatter: formatKrwAxis,
      data,
    });

    if (hasFan && distribution) {
      const at = (key: "p5" | "p25" | "p50" | "p75" | "p95") =>
        distribution.bands.map((b) => ({ time: dayToTime(inputs.baseDate, b.day), value: b[key] }));
      // Median carries the aggregate emphasis; percentile edges stay subdued
      // component hues (outer envelope = swapTheta gray, inner = carry ocean).
      // First series = median so BEP markers + zero line anchor to it.
      return [
        line("p50", "중앙값", t.series.total, at("p50"), 3),
        line("p95", "P95", t.series.carry, at("p95"), 1),
        line("p75", "P75", t.series.carry, at("p75"), 1),
        line("p25", "P25", t.series.carry, at("p25"), 1),
        line("p5", "P5", t.series.swapTheta, at("p5"), 1),
      ];
    }

    // Fallback: the S5/S7 five-series Total-Return view for responses without
    // the s11 distribution field.
    const rows = lastRun.chartData;
    const fromRows = (key: string) =>
      rows.map((r) => ({ time: dayToTime(inputs.baseDate, asNum(r.day)), value: asNum(r[key]) }));
    return [
      line("mtmPnL", "MTM", t.series.mtm, fromRows("mtmPnL")),
      line("cumulativeCarry", "캐리", t.series.carry, fromRows("cumulativeCarry")),
      line("swapThetaPnL", "스왑세타", t.series.swapTheta, fromRows("swapThetaPnL")),
      line("swapValuationPnL", "스왑평가", t.series.swapValuation, fromRows("swapValuationPnL")),
      line("totalPnL", "합계", t.series.total, fromRows("totalPnL"), 3),
    ];
  }, [lastRun, inputs.baseDate, hasFan, distribution]);

  const markers = useMemo<SeriesChartMarker[]>(() => {
    const bep = lastRun?.summary.breakEvenDay ?? -1;
    if (!lastRun || bep <= 0) return [];
    return [{ time: dayToTime(inputs.baseDate, bep), text: "BEP", color: getSimulationChartTheme().bepLine }];
  }, [lastRun, inputs.baseDate]);

  const chartOptions = useMemo(
    () => ({ layout: { background: { color: getSimulationChartTheme().background } } }),
    [],
  );

  // ── fan fills + funding strip, through the public onChartReady seam ───────
  const handleChartReady = useCallback((c: IChartApi) => {
    setChart(c);
    c.subscribeCrosshairMove((params) => {
      if (params.time == null) {
        setHoverDay(null);
        return;
      }
      setHoverDay(typeof params.time === "number" ? params.time : null);
    });
  }, []);

  useEffect(() => {
    if (!chart) return;
    const t = getSimulationChartTheme();

    // Band fills (T3). Created lazily, kept across runs, cleared when the run
    // has no distribution. setSeriesOrder pushes the fills behind SeriesChart's
    // line series (which are created before this effect runs).
    if (hasFan && distribution) {
      if (!bandSeriesRef.current) {
        const s = chart.addCustomSeries(new FanBandSeries(), {
          priceScaleId: "right",
          lastValueVisible: false,
          priceLineVisible: false,
          outerColor: t.series.swapTheta,
          innerColor: t.series.carry,
          outerAlpha: 0.12,
          innerAlpha: 0.18,
        } as Partial<FanBandSeriesOptions>);
        if (typeof s.setSeriesOrder === "function") s.setSeriesOrder(-1);
        bandSeriesRef.current = s;
      }
      const data: FanBandData[] = distribution.bands.map((b) => ({
        time: dayToTime(inputs.baseDate, b.day),
        p5: b.p5,
        p25: b.p25,
        p75: b.p75,
        p95: b.p95,
      }));
      bandSeriesRef.current.setData(data as never);
    } else if (bandSeriesRef.current) {
      bandSeriesRef.current.setData([]);
    }

    // Funding strip (T4): slim second pane sharing the time axis. The step
    // line + its last-value badge keep the funding rate visible with no hover.
    if (fundingCurve && fundingCurve.length > 0) {
      if (!fundingSeriesRef.current) {
        const s = chart.addSeries(
          LineSeries,
          {
            color: t.series.carry,
            lineWidth: 1,
            lineType: LineType.WithSteps,
            priceLineVisible: false,
            lastValueVisible: true,
            title: "",
            priceFormat: { type: "custom", formatter: formatPct, minMove: 0.001 },
          },
          1,
        );
        fundingSeriesRef.current = s;
        try {
          chart.panes()[1]?.setHeight(56);
        } catch {
          /* pane sizing is cosmetic — older lib builds keep the default split */
        }
      }
      fundingSeriesRef.current.setData(
        fundingCurve.map((p) => ({
          time: dayToTime(inputs.baseDate, p.day),
          value: p.fundingRate * 100,
        })) as never,
      );
    } else if (fundingSeriesRef.current) {
      fundingSeriesRef.current.setData([]);
    }
  }, [chart, hasFan, distribution, fundingCurve, inputs.baseDate]);

  // Refs die with the chart (LwChartBase disposes it); drop them so a remount
  // doesn't touch disposed series.
  useEffect(() => {
    if (!chart) return;
    return () => {
      bandSeriesRef.current = null;
      fundingSeriesRef.current = null;
    };
  }, [chart]);

  // ── funding readout: hovered step, else the latest one ─────────────────────
  const readoutPoint = useMemo<FundingCurvePoint | null>(() => {
    if (!fundingCurve || fundingCurve.length === 0) return null;
    if (hoverDay !== null) {
      const base = dayToTime(inputs.baseDate, 0);
      const day = Math.round((hoverDay - base) / 86400);
      const hit = fundingCurve.filter((p) => p.day <= day).at(-1);
      if (hit) return hit;
    }
    return fundingCurve[fundingCurve.length - 1];
  }, [fundingCurve, hoverDay, inputs.baseDate]);

  if (!lastRun) {
    return (
      <div className="flex h-full w-full items-center justify-center p-4 text-center">
        <p className="text-body text-fg-muted">
          {status === "running" ? "엔진 계산 중..." : "시뮬레이션을 실행하면 Total Return 분포가 표시됩니다."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-body-strong text-fg-primary">
          {hasFan ? "Total Return 분포 (Percentile Fan)" : "Total Return 누적 궤적"}
        </h3>
        <div className="flex items-baseline gap-3">
          {hasFan && distribution && (
            <span className="text-micro text-fg-dim" data-num>
              σ {distribution.sigmaBpDaily.toFixed(1)}bp/일 · 만기 ±{distribution.sigmaTerminalBp.toFixed(1)}bp
            </span>
          )}
          {readoutPoint && <FundingReadout point={readoutPoint} hovered={hoverDay !== null} />}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <SeriesChart
          series={series}
          pills
          tooltip
          zeroLine
          markers={markers}
          priceLineVisible={false}
          chartOptions={chartOptions}
          onChartReady={handleChartReady}
        />
      </div>
    </div>
  );
}
