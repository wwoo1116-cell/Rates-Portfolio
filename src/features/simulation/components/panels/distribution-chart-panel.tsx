"use client";

/**
 * Distribution / Total-Return panel — s11 redesign (T3+T4), s15 fan semantics.
 *
 * s15 T4 (scenario identity): each percentile band is the actual engine run of
 * its generating RATE-quantile scenario (z-shock path) — the backend no longer
 * re-sorts per day, so bands may cross on non-monotone books, and on a book
 * that loses when rates rise the p95 (rates-up) band sits BELOW the median.
 * That is information and is rendered honestly. The center line is pinned to
 * the BASE run (p50 == chartData.totalPnL byte-equal, σ-independent).
 *
 * s15 T4 (rendering): the percentile edges are drawn by the slice-local
 * FanBandSeries (fills + 1px edge strokes) instead of four SeriesChart line
 * series — so the price scale carries exactly ONE last-value badge, on the
 * center line (s14 is making center-only badges the shared default; the panel
 * simply no longer creates badge-bearing edge series to fight it). Percentile
 * values remain readable via the header readout (hover) since the edges are
 * no longer crosshair-snappable series. The TradingView attribution logo that
 * rendered as a broken glyph at the funding strip's lower-left is disabled via
 * chart options, matching the slice's LwLineChart.
 *
 * T4 (carry visibility, s11): the additive `fundingCurve` field renders as a
 * slim second pane along the time axis (step line + last-value badge), and the
 * header readout shows funding rate, position rate and carry bp at the hovered
 * time (last step when idle). With s15's funding spec the strip is the
 * 기준금리+10bp constant on every row.
 *
 * Responses without the new fields (older cached runs) fall back to the S5/S7
 * five-series Total-Return view unchanged.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import { LineSeries, LineType } from "lightweight-charts";

import { formatKrwAxis, formatKrwAxisSigned } from "@/lib/format";
import {
  SeriesChart,
  type SeriesChartMarker,
  type SeriesChartSeriesDef,
} from "@/components/charts/series-chart";
import { getSimulationChartTheme } from "../../lib/chart-theme";
import { useSimulationPort } from "../../hooks/use-simulation";
import { dayToTime } from "../charts/lw-line-chart";
import { FanBandSeries, type FanBandData, type FanBandSeriesOptions } from "../charts/fan-band-series";
import type { DistributionBand, FundingCurvePoint } from "../../api/simulate-dto";

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

/** Percentile readout: band values at the hovered day (edges are custom-series
 * strokes now, not crosshair-snappable series, so this is where they read). */
function FanReadout({ band }: { band: DistributionBand }) {
  const cells: { label: string; value: number }[] = [
    { label: "P95", value: band.p95 },
    { label: "P75", value: band.p75 },
    { label: "P25", value: band.p25 },
    { label: "P5", value: band.p5 },
  ];
  return (
    <span className="flex items-baseline gap-2 whitespace-nowrap text-micro text-fg-muted" data-num>
      {cells.map((c) => (
        <span key={c.label}>
          {c.label} <span className="text-fg-primary">{formatKrwAxisSigned(c.value)}</span>
        </span>
      ))}
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

    const rows = lastRun.chartData;
    const fromRows = (key: string) =>
      rows.map((r) => ({ time: dayToTime(inputs.baseDate, asNum(r.day)), value: asNum(r[key]) }));

    if (hasFan) {
      // s15 T4: ONE line series — the center line, pinned to the BASE run
      // (p50 is byte-equal by backend invariant). Percentile edges render
      // inside FanBandSeries, so no per-band price-scale badges exist.
      return [line("base", "기본 시나리오", t.series.total, fromRows("totalPnL"), 3)];
    }

    // Fallback: the S5/S7 five-series Total-Return view for responses without
    // the s11 distribution field.
    return [
      line("mtmPnL", "MTM", t.series.mtm, fromRows("mtmPnL")),
      line("cumulativeCarry", "캐리", t.series.carry, fromRows("cumulativeCarry")),
      line("swapThetaPnL", "스왑세타", t.series.swapTheta, fromRows("swapThetaPnL")),
      line("swapValuationPnL", "스왑평가", t.series.swapValuation, fromRows("swapValuationPnL")),
      line("totalPnL", "합계", t.series.total, fromRows("totalPnL"), 3),
    ];
  }, [lastRun, inputs.baseDate, hasFan]);

  const markers = useMemo<SeriesChartMarker[]>(() => {
    const bep = lastRun?.summary.breakEvenDay ?? -1;
    if (!lastRun || bep <= 0) return [];
    return [{ time: dayToTime(inputs.baseDate, bep), text: "BEP", color: getSimulationChartTheme().bepLine }];
  }, [lastRun, inputs.baseDate]);

  const chartOptions = useMemo(
    () => ({
      layout: {
        background: { color: getSimulationChartTheme().background },
        // s15 T4(b): the library's attribution logo painted at the chart's
        // bottom-left — the funding pane's lower-left in this two-pane layout —
        // was the "broken glyph" artifact. Off, like the slice's LwLineChart.
        attributionLogo: false,
      },
    }),
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

    // Band fills + edge strokes (s11 T3 / s15 T4). Created lazily, kept across
    // runs, cleared when the run has no distribution. setSeriesOrder pushes the
    // fills behind SeriesChart's line series.
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
          edgeWidth: 1,
          edgeAlpha: 0.85,
        } as Partial<FanBandSeriesOptions>);
        if (typeof s.setSeriesOrder === "function") s.setSeriesOrder(-1);
        bandSeriesRef.current = s;
      }
      // s15 T4(a) — staircase fix. The engine's rows are BUSINESS days with
      // calendar-day accrual, so a Monday row carries ~3 days of P&L movement;
      // lightweight-charts places points equidistantly, which compressed that
      // 3-day move into a 1-day-wide slot — a sharp riser every five points
      // (the live "staircase"). Injecting WHITESPACE time slots for the
      // calendar days between rows lets each move span its true width. No data
      // point is fabricated: whitespace rows carry no values, band fills and
      // the center line simply span the gap.
      const byDay = new Map(distribution.bands.map((b) => [b.day, b]));
      const lastDay = distribution.bands[distribution.bands.length - 1].day;
      const data: FanBandData[] = [];
      for (let d = 0; d <= lastDay; d++) {
        const b = byDay.get(d);
        if (b) {
          data.push({
            time: dayToTime(inputs.baseDate, d),
            p5: b.p5,
            p25: b.p25,
            p75: b.p75,
            p95: b.p95,
          });
        } else {
          data.push({ time: dayToTime(inputs.baseDate, d) } as FanBandData);
        }
      }
      bandSeriesRef.current.setData(data as never);
      // New run replaces the previous one outright — refit so the horizon
      // fills the hero. Deferred two frames: the stage has just swapped in and
      // the chart's ResizeObserver must apply the hero's final width first
      // (an immediate fit keeps the pre-layout width and strands the data on
      // the right half — observed live).
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          try {
            chart.timeScale().fitContent();
          } catch {
            /* chart disposed mid-transition */
          }
        }),
      );
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

  // ── hover → D+day resolution shared by both readouts ──────────────────────
  const hoveredDayIndex = useMemo<number | null>(() => {
    if (hoverDay === null || !inputs.baseDate) return null;
    const base = dayToTime(inputs.baseDate, 0);
    return Math.round((hoverDay - base) / 86400);
  }, [hoverDay, inputs.baseDate]);

  const readoutPoint = useMemo<FundingCurvePoint | null>(() => {
    if (!fundingCurve || fundingCurve.length === 0) return null;
    if (hoveredDayIndex !== null) {
      const hit = fundingCurve.filter((p) => p.day <= hoveredDayIndex).at(-1);
      if (hit) return hit;
    }
    return fundingCurve[fundingCurve.length - 1];
  }, [fundingCurve, hoveredDayIndex]);

  const readoutBand = useMemo<DistributionBand | null>(() => {
    if (!distribution || distribution.bands.length === 0) return null;
    if (hoveredDayIndex !== null) {
      const hit = distribution.bands.filter((b) => b.day <= hoveredDayIndex).at(-1);
      if (hit) return hit;
    }
    return distribution.bands[distribution.bands.length - 1];
  }, [distribution, hoveredDayIndex]);

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
        <div className="flex flex-wrap items-baseline gap-3">
          {hasFan && distribution && (
            <span className="text-micro text-fg-dim" data-num>
              σ {distribution.sigmaBpDaily.toFixed(1)}bp/일 · 만기 ±{distribution.sigmaTerminalBp.toFixed(1)}bp
            </span>
          )}
          {readoutBand && <FanReadout band={readoutBand} />}
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
      {hasFan && (
        <p className="mt-1 text-micro text-fg-dim">
          밴드 = 금리 분위수 시나리오의 실제 엔진 런 (P95 = 금리 +1.645σ 경로) · 중앙선 = 기본 시나리오 · 비단조 북에서는 밴드가 교차할 수 있음
        </p>
      )}
    </div>
  );
}
