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
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
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

/** Stable identity for the default: `markers = []` in the signature would mint a
 * new array every render, re-running the series effect (and re-creating the
 * markers plugin) on every render even when nothing changed. */
const EMPTY_MARKERS: LwMarker[] = [];

export function LwLineChart({ series, zeroLine = false, markers = EMPTY_MARKERS }: LwLineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line">[]>([]);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  // Guards every deferred callback that closes over `chart`. lightweight-charts
  // throws "Object is disposed" if anything touches a chart after remove(), and
  // a ResizeObserver notification already queued when the panel unmounts can
  // still land after cleanup has run.
  const disposedRef = useRef(false);

  // Create + dispose the chart once; ResizeObserver keeps it container-relative
  // (§3.3 — no viewport units; dockview resizes the panel, the chart follows).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    disposedRef.current = false;
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
      // s18 T6 — vertical gridlines off (owner feedback ①, app-wide). This is
      // a slice-local chart HOST (not the canonical SeriesChart), so s14's
      // shared BASE_CHART_OPTIONS default will never reach it at integration;
      // the local vertical grid it used to draw is removed here instead.
      grid: { vertLines: { visible: false }, horzLines: { color: t.grid } },
      timeScale: { borderColor: t.grid, timeVisible: false, secondsVisible: false },
      rightPriceScale: { borderColor: t.grid },
      crosshair: { mode: CrosshairMode.Normal },
    });
    chartRef.current = chart;

    const ro = new ResizeObserver((entries) => {
      // `chart` is captured, so a notification delivered after remove() would
      // hit a disposed object -- ro.observe() itself queues an initial callback,
      // and dockview resizes the panel constantly.
      if (disposedRef.current) return;
      const e = entries[0];
      if (e) chart.applyOptions({ width: e.contentRect.width, height: e.contentRect.height });
    });
    ro.observe(el);

    return () => {
      // Order matters: flag first so any in-flight callback bails, then stop
      // observing, detach the markers plugin (it holds a series reference), and
      // only then dispose the chart.
      disposedRef.current = true;
      ro.disconnect();
      markersRef.current?.detach();
      markersRef.current = null;
      chart.remove();
      chartRef.current = null;
      seriesRef.current = [];
    };
  }, []);

  // Rebuild series whenever the data changes (memoize `series` in callers).
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || disposedRef.current) return;
    // The markers plugin holds a reference to the series it was attached to, so
    // it has to go before those series are removed.
    markersRef.current?.detach();
    markersRef.current = null;
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
      markersRef.current = createSeriesMarkers(
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
