"use client";

/**
 * Middle panel: the focused instrument's rolling z-score oscillator. Horizontal
 * threshold lines mark ±entryZ / ±warnZ / 0. Since s20 the SHORT/LONG markers
 * are the PINNED run's trade entries (pinnedOscillatorMarkers — the same
 * backtest result object that feeds the KPI block, trades table and equity
 * curve), not raw z-crossings; when the live config drifts from the pinned
 * run they are suppressed and the Results stale banner explains why.
 * Time-axis synced with the Price and Equity panels (same master date
 * array -> logical-range lockstep).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { IChartApi, IPriceLine, ISeriesApi, ISeriesMarkersPluginApi, MouseEventParams, SeriesMarker, Time } from "lightweight-charts";
import { LineSeries, LineStyle, createSeriesMarkers } from "lightweight-charts";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { LwChartBase } from "@/components/charts/lw-chart-base";
import { CrosshairReticle, type CrosshairReticlePoint } from "@/components/charts/crosshair-reticle";
import { paneOffsetX, snapReticleToNearestSeries } from "@/components/charts/snap-reticle";
import { alignToDates, rollingZScore } from "@/lib/math/rolling-stats";
import { useEntrySignalsStore } from "@/stores/entry-signals-store";
import { CHART_COLORS } from "./chart-theme";
import { ensureFullDomainFit } from "./full-domain-fit";
import { pinnedOscillatorMarkers } from "./marker-trade-correspondence";
import { useEntrySignalsData } from "./use-entry-signals-data";
import { usePinnedBacktest, useRunIsStale } from "./use-pinned-backtest";
import { PanelEmptyState, SyncedTimeGuide } from "./panel-shell";
import { registerSyncChart, setSharedHoverTime, syncSetLogicalRange, unregisterSyncChart } from "./use-synced-time-scales";

const PANEL_ID = "es-zscore";
const zFormatter = (v: number) => `${v.toFixed(2)}σ`;

export function ZScoreOscillatorPanel() {
  const { focusedSeries, isLoading } = useEntrySignalsData();
  const focused = useEntrySignalsStore((s) => s.focused);
  const lookback = useEntrySignalsStore((s) => s.lookback);
  const entryZ = useEntrySignalsStore((s) => s.entryZ);
  const warnZ = useEntrySignalsStore((s) => s.warnZ);
  // s20: trade markers come from the pinned run (single source with the KPI
  // block); stale live params suppress them rather than mixing sources.
  const pinned = usePinnedBacktest();
  const stale = useRunIsStale();
  const pinnedResult = pinned?.result ?? null;

  const chartRef = useRef<IChartApi | null>(null);
  const [chart, setChart] = useState<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const prevIdRef = useRef<string>("");
  const fitRef = useRef<(() => void) | null>(null);
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

    // Trade markers (s20): the pinned run's trade entries — the same backtest
    // result object as the KPI block / trades table / cumulative P&L. When
    // the live config drifts from the pinned run, pinnedOscillatorMarkers
    // returns [] (suppression; the Results stale banner explains) — pinned
    // markers are never drawn over a mismatched live series. While not
    // stale, the live series IS the pinned run's series, so every entry date
    // is a member of this chart's bar array (on-bar by construction).
    const markers: SeriesMarker<Time>[] = pinnedOscillatorMarkers(pinnedResult, stale).map((m) => ({
      time: m.time as unknown as Time,
      position: m.position,
      color: m.text === "LONG" ? CHART_COLORS.positive : CHART_COLORS.negative,
      shape: m.shape,
      text: m.text,
    }));
    markersRef.current?.setMarkers(markers);

    if (idChanged) {
      prevIdRef.current = focusedSeries.id;
      // s20 (s19 R2a): convergent full-domain fit instead of a one-shot
      // fitContent, which the mount race silently drops on the cache-hit
      // path. Group applier: a lone-chart fit is echoed away by the synced
      // siblings' stale ranges.
      fitRef.current?.();
      fitRef.current = ensureFullDomainFit(chart, dates.length, syncSetLogicalRange);
    }
  }, [chart, focusedSeries, lookback, entryZ, warnZ, pinnedResult, stale]);

  useEffect(() => () => fitRef.current?.(), []);

  return (
    <div className="flex h-full flex-col gap-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-label font-bold uppercase text-fg-muted">Z-Score Oscillator</span>
        <span className="text-micro text-fg-muted">
          lookback {lookback}D · entry ±{entryZ}σ · watch ±{warnZ}σ
          {pinned && stale && (
            /* s20: markers belong to the pinned run; on live drift they are
               suppressed, and (unlike the Results stage) the detached /chart
               window has no stale banner — this is its honesty marker. */
            <span className="text-sem-risk"> · 체결 마커 숨김(설정 변경)</span>
          )}
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
