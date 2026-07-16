"use client";

/**
 * Rate fan (s18 T3, 이중축 분리의 1축) — quantile bands over the 국채 3Y rate
 * path. Rates are monotone in the quantile by construction, so these bands
 * NEVER cross and the P5..P95 labels are truthful here (fan-labels.ts).
 *
 * Slice-local lightweight-charts host (the migration boundary forbids the
 * app's LwChartBase, same as lw-line-chart.tsx): FanBandSeries paints the
 * 5–95/25–75 fills + 1px edges, a LineSeries carries the P50 (base scenario)
 * path with the single last-value badge. Calendar-gap whitespace slots keep
 * weekend moves at their true width (s15 rule: real calendar slots, no
 * invented points).
 *
 * s18 T6: no vertical gridlines (drawn locally NOWHERE — the owner's app-wide
 * ruling; horizontal guides stay), and the bp badge passes a FULL custom
 * priceFormat incl. `minMove` — lightweight-charts v5 requires it, and its
 * absence in the shared SeriesChart's custom priceFormat is the suspected
 * root cause of the raw-float badges (see REPORT_s18 T6).
 */
import { useEffect, useRef } from "react";
import {
  CrosshairMode,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
} from "lightweight-charts";

import { getSimulationChartTheme } from "../../lib/chart-theme";
import type { DistributionBand } from "../../api/simulate-dto";
import { dayToTime } from "./lw-line-chart";
import { FanBandSeries, type FanBandData, type FanBandSeriesOptions } from "./fan-band-series";

const formatBpAxis = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}bp`;

export interface RateFanChartProps {
  ratePaths: DistributionBand[];
  baseDate: string;
}

export function RateFanChart({ ratePaths, baseDate }: RateFanChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const bandRef = useRef<ISeriesApi<"Custom"> | null>(null);
  const centerRef = useRef<ISeriesApi<"Line"> | null>(null);
  const disposedRef = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    disposedRef.current = false;
    const t = getSimulationChartTheme();
    const chart = createChart(el, {
      width: el.clientWidth || 320,
      height: el.clientHeight || 160,
      layout: {
        background: { color: t.background },
        textColor: t.axis,
        fontSize: 11,
        fontFamily: "Inter, system-ui, sans-serif",
        attributionLogo: false,
      },
      // s18 T6 — vertical gridlines off (app-wide owner ruling; s14 makes it
      // the shared default, this host is slice-local and sets it itself).
      grid: { vertLines: { visible: false }, horzLines: { color: t.grid } },
      timeScale: { borderColor: t.grid, timeVisible: false, secondsVisible: false },
      rightPriceScale: { borderColor: t.grid },
      crosshair: { mode: CrosshairMode.Normal },
    });
    chartRef.current = chart;

    const ro = new ResizeObserver((entries) => {
      if (disposedRef.current) return;
      const e = entries[0];
      if (e) chart.applyOptions({ width: e.contentRect.width, height: e.contentRect.height });
    });
    ro.observe(el);

    return () => {
      disposedRef.current = true;
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      bandRef.current = null;
      centerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || disposedRef.current) return;
    const t = getSimulationChartTheme();

    if (!bandRef.current) {
      // Z-ORDER DRIVES THE SCALE FORMAT (s18 T6 root cause, from the LWC 5.2
      // source, PriceScale._updateFormatter: "choose source with the lowest
      // zorder"). setSeriesOrder(-1) — needed so the fills paint BEHIND the
      // line — also makes the band series the scale's formatter source, so a
      // format-less band series silently reverts the whole scale (ticks AND
      // every badge on it) to raw default formatting no matter what the line
      // declares. This was the raw-float mechanism all along (s15's return
      // panel had the same setSeriesOrder(-1) band series); creation order and
      // minMove were red herrings. Therefore: the band series carries the SAME
      // custom priceFormat as the line.
      centerRef.current = chart.addSeries(LineSeries, {
        color: t.series.total,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        title: "",
        priceFormat: { type: "custom", formatter: formatBpAxis, minMove: 0.1 },
      });
      bandRef.current = chart.addCustomSeries(new FanBandSeries(), {
        priceScaleId: "right",
        lastValueVisible: false,
        priceLineVisible: false,
        priceFormat: { type: "custom", formatter: formatBpAxis, minMove: 0.1 },
        outerColor: t.series.swapTheta,
        innerColor: t.series.carry,
        outerAlpha: 0.14,
        innerAlpha: 0.2,
        edgeWidth: 1,
        edgeAlpha: 0.85,
      } as Partial<FanBandSeriesOptions>);
      if (typeof bandRef.current.setSeriesOrder === "function") bandRef.current.setSeriesOrder(-1);
    }

    // Whitespace calendar slots between business-day rows (s15 rule).
    const byDay = new Map(ratePaths.map((b) => [b.day, b]));
    const lastDay = ratePaths.length ? ratePaths[ratePaths.length - 1].day : 0;
    const bandData: FanBandData[] = [];
    const centerData: { time: ReturnType<typeof dayToTime>; value: number }[] = [];
    for (let d = 0; d <= lastDay; d++) {
      const time = dayToTime(baseDate, d);
      const b = byDay.get(d);
      if (b) {
        bandData.push({ time, p5: b.p5, p25: b.p25, p75: b.p75, p95: b.p95 });
        centerData.push({ time, value: b.p50 });
      } else {
        bandData.push({ time } as FanBandData);
      }
    }
    bandRef.current.setData(bandData as never);
    centerRef.current?.setData(centerData as never);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        try {
          chart.timeScale().fitContent();
        } catch {
          /* disposed mid-transition */
        }
      }),
    );
  }, [ratePaths, baseDate]);

  return <div ref={containerRef} className="h-full w-full" />;
}
