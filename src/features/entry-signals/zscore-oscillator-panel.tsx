"use client";

/**
 * Middle panel: the focused instrument's rolling z-score oscillator. Horizontal
 * threshold lines mark ±entryZ / ±warnZ / 0, and markers flag the dates where
 * the z-score crosses into an entry zone. Time-axis synced with the Price and
 * Equity panels (same master date array -> logical-range lockstep).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { IChartApi, IPriceLine, ISeriesApi, ISeriesMarkersPluginApi, MouseEventParams, SeriesMarker, Time } from "lightweight-charts";
import { LineSeries, LineStyle, createSeriesMarkers } from "lightweight-charts";
import { ChartFrame } from "@/components/chart/ChartFrame";
import { LwChartBase } from "@/components/charts/lw-chart-base";
import { CrosshairReticle, type CrosshairReticlePoint } from "@/components/charts/crosshair-reticle";
import { paneOffsetX, snapReticleToNearestSeries } from "@/components/charts/snap-reticle";
import { alignToDates, rollingZScore } from "@/lib/math/rolling-stats";
import { useEntrySignalsStore } from "@/stores/entry-signals-store";
import { CHART_COLORS } from "./chart-theme";
import { useEntrySignalsData } from "./use-entry-signals-data";
import { PanelEmptyState, SyncedTimeGuide } from "./panel-shell";
import { registerSyncChart, setSharedHoverTime, unregisterSyncChart } from "./use-synced-time-scales";

const PANEL_ID = "es-zscore";
const zFormatter = (v: number) => `${v.toFixed(2)}σ`;

export function ZScoreOscillatorPanel() {
  const { focusedSeries, isLoading } = useEntrySignalsData();
  const focused = useEntrySignalsStore((s) => s.focused);
  const lookback = useEntrySignalsStore((s) => s.lookback);
  const entryZ = useEntrySignalsStore((s) => s.entryZ);
  const warnZ = useEntrySignalsStore((s) => s.warnZ);

  const chartRef = useRef<IChartApi | null>(null);
  const [chart, setChart] = useState<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const prevIdRef = useRef<string>("");
  const [reticle, setReticle] = useState<(CrosshairReticlePoint & { date?: string; paneWidth: number }) | null>(null);

  const onChartReady = useCallback((api: IChartApi) => {
    chartRef.current = api;
    // Fresh chart -> drop stale series refs from a previous one (dev
    // Strict-Mode remount / dockview re-mount) so we never touch disposed series.
    seriesRef.current = null;
    markersRef.current = null;
    priceLinesRef.current = [];
    prevIdRef.current = "";
    setChart(api);
    registerSyncChart(PANEL_ID, api);
    api.subscribeCrosshairMove((params: MouseEventParams) => {
      if (!params.point || !params.time) {
        setReticle(null);
        setSharedHoverTime(null);
        return;
      }
      const date = String(params.time);
      const snapped = snapReticleToNearestSeries(api, params, [seriesRef.current]);
      const p = snapped ?? { x: params.point.x, y: params.point.y };
      setReticle({ x: p.x, y: p.y, date, paneWidth: paneOffsetX(api) + api.timeScale().width() });
      setSharedHoverTime(date);
    });
  }, []);

  useEffect(() => () => unregisterSyncChart(PANEL_ID), []);

  // Keyed off the `chart` STATE (not chartRef.current) so a ChartFrame
  // maximize — which remounts LwChartBase without remounting this panel —
  // triggers a series rebuild on the fresh chart.
  useEffect(() => {
    if (!chart) return;

    const dropSeries = () => {
      if (seriesRef.current) {
        try {
          chart.removeSeries(seriesRef.current);
        } catch {
          // chart/series already disposed
        }
        seriesRef.current = null;
        markersRef.current = null;
        priceLinesRef.current = [];
      }
    };

    if (!focusedSeries || focusedSeries.lineData.length === 0) {
      dropSeries();
      prevIdRef.current = "";
      return;
    }

    const dates = focusedSeries.lineData.map((d) => d.time);
    const values = focusedSeries.lineData.map((d) => d.value);

    const idChanged = prevIdRef.current !== focusedSeries.id;
    if (idChanged) dropSeries();
    if (!seriesRef.current) {
      seriesRef.current = chart.addSeries(LineSeries, {
        color: focusedSeries.color,
        lineWidth: 2,
        title: "z-score",
        priceFormat: { type: "custom", formatter: zFormatter },
      });
      markersRef.current = createSeriesMarkers(seriesRef.current, []);
    }
    const series = seriesRef.current;

    const z = rollingZScore(values, lookback);
    series.setData(alignToDates(dates, z) as never);

    // Threshold lines: rebuild each run so they track entryZ/warnZ changes.
    for (const line of priceLinesRef.current) series.removePriceLine(line);
    priceLinesRef.current = [
      series.createPriceLine({ price: entryZ, color: CHART_COLORS.negative, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `+${entryZ}σ` }),
      series.createPriceLine({ price: -entryZ, color: CHART_COLORS.positive, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `−${entryZ}σ` }),
      series.createPriceLine({ price: warnZ, color: CHART_COLORS.fgDim, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: "" }),
      series.createPriceLine({ price: -warnZ, color: CHART_COLORS.fgDim, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: "" }),
      series.createPriceLine({ price: 0, color: CHART_COLORS.accent, lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: false, title: "" }),
    ];

    // Entry markers: dates where |z| first crosses into an entry zone.
    const markers: SeriesMarker<Time>[] = [];
    let wasBreaching = false;
    for (let i = 0; i < z.length; i++) {
      const zi = z[i];
      if (zi == null) continue;
      const breaching = Math.abs(zi) >= entryZ;
      if (breaching && !wasBreaching) {
        const rich = zi > 0;
        markers.push({
          time: dates[i] as unknown as Time,
          position: rich ? "aboveBar" : "belowBar",
          color: rich ? CHART_COLORS.negative : CHART_COLORS.positive,
          shape: "circle",
          text: rich ? "SHORT" : "LONG",
        });
      }
      wasBreaching = breaching;
    }
    markersRef.current?.setMarkers(markers);

    if (idChanged) {
      prevIdRef.current = focusedSeries.id;
      chart.timeScale().fitContent();
    }
  }, [chart, focusedSeries, lookback, entryZ, warnZ]);

  return (
    <div className="flex h-full flex-col gap-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-label font-bold uppercase text-fg-muted">Z-Score Oscillator</span>
        <span className="text-micro text-fg-muted">
          lookback {lookback}D · entry ±{entryZ}σ · watch ±{warnZ}σ
        </span>
      </div>

      <ChartFrame chartId="es-zscore" title="Z-Score Oscillator" className="min-h-0 flex-1">
        <LwChartBase onChartReady={onChartReady} />
        <SyncedTimeGuide chart={chart} suppressed={reticle != null} />
        <CrosshairReticle point={reticle} date={reticle?.date} paneWidth={reticle?.paneWidth} />

        {!focused && !isLoading && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <PanelEmptyState>Focus an instrument to see its z-score oscillator.</PanelEmptyState>
          </div>
        )}
      </ChartFrame>
    </div>
  );
}
