"use client";

/**
 * Slice-local lightweight-charts multi-line wrapper (S5). The migration boundary
 * forbids importing the app's @/components/charts/LwChartBase, so this re-implements
 * the same createChart + ResizeObserver pattern using the `lightweight-charts`
 * package directly, with all colors sourced from ../../lib/chart-theme (no hex here,
 * so it satisfies the slice's no-raw-color lint). Loaded via next/dynamic ssr:false.
 */
import { useEffect, useRef } from "react";
import {
  CrosshairMode,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type UTCTimestamp,
} from "lightweight-charts";

import { getSimulationChartTheme } from "../../lib/chart-theme";

export interface LwPoint {
  time: UTCTimestamp;
  value: number;
}

export interface LwSeriesDef {
  color: string;
  data: LwPoint[];
  lineWidth?: 1 | 2 | 3 | 4;
  dashed?: boolean;
}

export interface LwMarker {
  time: UTCTimestamp;
  text: string;
  color: string;
}

export interface LwLineChartProps {
  series: LwSeriesDef[];
  /** Draw a horizontal baseline at y=0 (on the first series). */
  zeroLine?: boolean;
  /** Point markers on the first series (e.g. break-even day). */
  markers?: LwMarker[];
}

/** Map a D+n horizon offset to an ascending UTC timestamp for the time axis. */
export function dayToTime(baseDate: string, day: number): UTCTimestamp {
  const baseMs = baseDate && !Number.isNaN(Date.parse(baseDate)) ? Date.parse(baseDate) : Date.UTC(2025, 0, 1);
  return (Math.floor(baseMs / 1000) + day * 86400) as UTCTimestamp;
}

export function LwLineChart({ series, zeroLine = false, markers = [] }: LwLineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line">[]>([]);

  // Create + dispose the chart once; ResizeObserver keeps it container-relative
  // (§3.3 — no viewport units; dockview resizes the panel, the chart follows).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const t = getSimulationChartTheme();
    const chart = createChart(el, {
      width: el.clientWidth || 320,
      height: el.clientHeight || 200,
      layout: {
        background: { color: t.background },
        textColor: t.axis,
        fontSize: 11,
        fontFamily: "Inter, system-ui, sans-serif",
        attributionLogo: false,
      },
      grid: { vertLines: { color: t.grid }, horzLines: { color: t.grid } },
      timeScale: { borderColor: t.grid, timeVisible: false, secondsVisible: false },
      rightPriceScale: { borderColor: t.grid },
      crosshair: { mode: CrosshairMode.Normal },
    });
    chartRef.current = chart;

    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) chart.applyOptions({ width: e.contentRect.width, height: e.contentRect.height });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = [];
    };
  }, []);

  // Rebuild series whenever the data changes (memoize `series` in callers).
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const s of seriesRef.current) {
      try {
        chart.removeSeries(s);
      } catch {
        /* already disposed */
      }
    }
    seriesRef.current = [];

    const t = getSimulationChartTheme();
    const created: ISeriesApi<"Line">[] = [];
    series.forEach((def, i) => {
      const s = chart.addSeries(LineSeries, {
        color: def.color,
        lineWidth: def.lineWidth ?? 2,
        lineStyle: def.dashed ? LineStyle.Dashed : LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      s.setData(def.data);
      if (zeroLine && i === 0) {
        s.createPriceLine({
          price: 0,
          color: t.zeroLine,
          lineWidth: 1,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: false,
          title: "",
        });
      }
      created.push(s);
    });

    if (markers.length > 0 && created[0]) {
      createSeriesMarkers(
        created[0],
        markers.map(
          (m): SeriesMarker<UTCTimestamp> => ({
            time: m.time,
            position: "inBar",
            color: m.color,
            shape: "circle",
            text: m.text,
          }),
        ),
      );
    }

    seriesRef.current = created;
    chart.timeScale().fitContent();
  }, [series, zeroLine, markers]);

  return <div ref={containerRef} className="h-full w-full" />;
}
