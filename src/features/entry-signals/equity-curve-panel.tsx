"use client";

/**
 * Bottom-left panel: the mean-reversion backtest's cumulative-P&L equity curve
 * for the focused instrument, computed client-side (lib/math/backtest.ts) so it
 * works for any spread OR outright. Entry/exit markers come from the sim's
 * trade list. The sim runs over the focused instrument's own date array, so it
 * is index-aligned with the Price and Z-Score charts (logical-range lockstep).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { IChartApi, ISeriesApi, ISeriesMarkersPluginApi, MouseEventParams, SeriesMarker, Time } from "lightweight-charts";
import { LineSeries, createSeriesMarkers } from "lightweight-charts";
import { ChartFrame } from "@/components/chart/ChartFrame";
import { LwChartBase } from "@/components/charts/lw-chart-base";
import { CrosshairReticle, type CrosshairReticlePoint } from "@/components/charts/crosshair-reticle";
import { paneOffsetX } from "@/components/charts/snap-reticle";
import { formatKrwAxisSigned } from "@/lib/format";
import { useEntrySignalsStore } from "@/stores/entry-signals-store";
import { CHART_COLORS } from "./chart-theme";
import { useEntrySignalsData } from "./use-entry-signals-data";
import { useFocusedBacktest } from "./use-backtest";
import { PanelEmptyState, SyncedTimeGuide } from "./panel-shell";
import { registerSyncChart, setSharedHoverTime, unregisterSyncChart } from "./use-synced-time-scales";

const PANEL_ID = "es-equity";

export function EquityCurvePanel() {
  const { focusedSeries } = useEntrySignalsData();
  const focused = useEntrySignalsStore((s) => s.focused);
  const result = useFocusedBacktest(focusedSeries);

  const chartRef = useRef<IChartApi | null>(null);
  const [chart, setChart] = useState<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const [reticle, setReticle] = useState<(CrosshairReticlePoint & { date?: string; paneWidth: number }) | null>(null);

  const onChartReady = useCallback((api: IChartApi) => {
    chartRef.current = api;
    // Fresh chart -> drop stale series refs from a previous one (dev
    // Strict-Mode remount / dockview re-mount) so we never touch disposed series.
    seriesRef.current = null;
    markersRef.current = null;
    setChart(api);
    registerSyncChart(PANEL_ID, api);
    api.subscribeCrosshairMove((params: MouseEventParams) => {
      if (!params.point || !params.time) {
        setReticle(null);
        setSharedHoverTime(null);
        return;
      }
      const date = String(params.time);
      // params.point is pane-space; the overlay is container-space. This panel
      // doesn't snap to a series, so it adds paneOffsetX itself.
      const offsetX = paneOffsetX(api);
      setReticle({
        x: params.point.x + offsetX,
        y: params.point.y,
        date,
        paneWidth: offsetX + api.timeScale().width(),
      });
      setSharedHoverTime(date);
    });
  }, []);

  useEffect(() => () => unregisterSyncChart(PANEL_ID), []);

  // Keyed off the `chart` STATE (not chartRef.current) so a ChartFrame
  // maximize — which remounts LwChartBase without remounting this panel —
  // triggers a series rebuild on the fresh chart.
  useEffect(() => {
    if (!chart) return;

    if (!result) {
      if (seriesRef.current) {
        try {
          chart.removeSeries(seriesRef.current);
        } catch {
          // chart/series already disposed
        }
        seriesRef.current = null;
        markersRef.current = null;
      }
      return;
    }

    if (!seriesRef.current) {
      seriesRef.current = chart.addSeries(LineSeries, {
        color: CHART_COLORS.accent,
        lineWidth: 2,
        title: "Cumulative P&L",
        // Signed 억/만 on the KRW axis/badge (s14) — raw won digits before.
        priceFormat: { type: "custom", formatter: formatKrwAxisSigned },
      });
      markersRef.current = createSeriesMarkers(seriesRef.current, []);
    }

    // Sim runs over the focused instrument's own dates, so this is already
    // index-aligned with the Price / Z-Score charts (no whitespace needed).
    seriesRef.current.setData(result.points.map((p) => ({ time: p.date, value: p.cumulativePnl })) as never);

    const markers: SeriesMarker<Time>[] = [];
    for (const t of result.trades) {
      const long = t.direction > 0;
      markers.push({
        time: t.entryDate as unknown as Time,
        position: long ? "belowBar" : "aboveBar",
        color: long ? CHART_COLORS.positive : CHART_COLORS.negative,
        shape: "circle",
        text: long ? "L" : "S",
      });
      markers.push({
        time: t.exitDate as unknown as Time,
        position: "aboveBar",
        color: t.pnl >= 0 ? CHART_COLORS.positive : CHART_COLORS.negative,
        shape: "square",
        text: "×",
      });
    }
    markers.sort((a, b) => String(a.time).localeCompare(String(b.time)));
    markersRef.current?.setMarkers(markers);

    chart.timeScale().fitContent();
  }, [chart, result]);

  return (
    <div className="flex h-full flex-col gap-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-label font-bold uppercase text-fg-muted">Backtest · Cumulative P&amp;L</span>
        {result && (
          <span className="text-micro text-fg-muted">
            {result.trades.length} trades · net{" "}
            <span style={{ color: result.summary.totalPnl >= 0 ? "var(--chart-pnl-pos)" : "var(--chart-pnl-neg)" }}>
              {formatKrwAxisSigned(result.summary.totalPnl)}
            </span>
          </span>
        )}
      </div>

      <ChartFrame chartId="es-equity" title="Backtest — Cumulative P&L" className="min-h-0 flex-1">
        <LwChartBase onChartReady={onChartReady} />
        <SyncedTimeGuide chart={chart} suppressed={reticle != null} />
        <CrosshairReticle point={reticle} date={reticle?.date} paneWidth={reticle?.paneWidth} />

        {!focused && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <PanelEmptyState>
              Focus an instrument in the Signals panel to run its mean-reversion backtest.
            </PanelEmptyState>
          </div>
        )}
      </ChartFrame>
    </div>
  );
}
