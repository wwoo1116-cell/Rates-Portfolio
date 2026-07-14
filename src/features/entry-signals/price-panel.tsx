"use client";

/**
 * Top panel of the Entry Signals tab: the focused instrument's price/spread
 * line with a rolling SMA overlay and optional ±entryZ·σ Bollinger bands.
 * Also hosts the global analysis control bar (lookback / thresholds / bands),
 * since those params drive every other panel. Time-axis is synced with the
 * Z-Score and Equity panels via use-synced-time-scales.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { SegmentedControl } from "@blueprintjs/core";
import type { IChartApi, ISeriesApi, MouseEventParams } from "lightweight-charts";
import { LineSeries, LineStyle } from "lightweight-charts";
import { LwChartBase, rateFormatter } from "@/components/charts/lw-chart-base";
import { CrosshairReticle, type CrosshairReticlePoint } from "@/components/charts/crosshair-reticle";
import { snapReticleToNearestSeries } from "@/components/charts/snap-reticle";
import { alignToDates, rollingSeries } from "@/lib/math/rolling-stats";
import { instrumentLabel } from "@/lib/rv-instruments";
import { LOOKBACK_PRESETS, useEntrySignalsStore } from "@/stores/entry-signals-store";
import { CHART_COLORS } from "./chart-theme";
import { useEntrySignalsData } from "./use-entry-signals-data";
import { NumberField, PanelEmptyState, SyncedTimeGuide } from "./panel-shell";
import {
  registerSyncChart,
  setSharedHoverTime,
  unregisterSyncChart,
} from "./use-synced-time-scales";

const PANEL_ID = "es-price";
const spreadFormatter = (v: number) => v.toFixed(2);

function ControlBar() {
  const lookback = useEntrySignalsStore((s) => s.lookback);
  const entryZ = useEntrySignalsStore((s) => s.entryZ);
  const warnZ = useEntrySignalsStore((s) => s.warnZ);
  const showBands = useEntrySignalsStore((s) => s.showBands);
  const setLookback = useEntrySignalsStore((s) => s.setLookback);
  const setEntryZ = useEntrySignalsStore((s) => s.setEntryZ);
  const setWarnZ = useEntrySignalsStore((s) => s.setWarnZ);
  const toggleBands = useEntrySignalsStore((s) => s.toggleBands);

  const presetValue = LOOKBACK_PRESETS.includes(lookback as (typeof LOOKBACK_PRESETS)[number])
    ? String(lookback)
    : "";

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-2">
        <span className="text-label text-fg-muted">LOOKBACK</span>
        <SegmentedControl
          small
          options={LOOKBACK_PRESETS.map((p) => ({ label: `${p}D`, value: String(p) }))}
          value={presetValue}
          onValueChange={(v) => setLookback(Number(v))}
        />
      </div>
      <NumberField
        label="CUSTOM (D)"
        value={lookback}
        step="1"
        min={2}
        onCommit={setLookback}
        className="w-24"
      />
      <NumberField label="ENTRY ±σ" value={entryZ} step="0.1" min={0} onCommit={setEntryZ} className="w-24" />
      <NumberField label="WATCH ±σ" value={warnZ} step="0.1" min={0} onCommit={setWarnZ} className="w-24" />
      <div className="flex flex-col gap-2">
        <span className="text-label text-fg-muted">± BANDS</span>
        <SegmentedControl
          small
          options={[
            { label: "On", value: "on" },
            { label: "Off", value: "off" },
          ]}
          value={showBands ? "on" : "off"}
          onValueChange={(v) => {
            if ((v === "on") !== showBands) toggleBands();
          }}
        />
      </div>
    </div>
  );
}

export function PricePanel() {
  const { focusedSeries, isLoading, isError } = useEntrySignalsData();
  const focused = useEntrySignalsStore((s) => s.focused);
  const lookback = useEntrySignalsStore((s) => s.lookback);
  const entryZ = useEntrySignalsStore((s) => s.entryZ);
  const showBands = useEntrySignalsStore((s) => s.showBands);

  const chartRef = useRef<IChartApi | null>(null);
  const [chart, setChart] = useState<IChartApi | null>(null);
  const mainRef = useRef<ISeriesApi<"Line"> | null>(null);
  const smaRef = useRef<ISeriesApi<"Line"> | null>(null);
  const upperRef = useRef<ISeriesApi<"Line"> | null>(null);
  const lowerRef = useRef<ISeriesApi<"Line"> | null>(null);
  const prevIdRef = useRef<string>("");
  const [reticle, setReticle] = useState<(CrosshairReticlePoint & { date?: string; paneWidth: number }) | null>(null);

  const onChartReady = useCallback((api: IChartApi) => {
    chartRef.current = api;
    // A fresh chart invalidates every series from a previous one (dev
    // Strict-Mode remount / dockview re-mount): drop the stale refs so the data
    // effect rebuilds on the new chart instead of touching disposed series.
    mainRef.current = null;
    smaRef.current = null;
    upperRef.current = null;
    lowerRef.current = null;
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
      // Snap to the main price/spread line only (SMA/bands have no marker).
      const snapped = snapReticleToNearestSeries(api, params, [mainRef.current]);
      const p = snapped ?? { x: params.point.x, y: params.point.y };
      setReticle({ x: p.x, y: p.y, date, paneWidth: api.timeScale().width() });
      setSharedHoverTime(date);
    });
  }, []);

  useEffect(() => () => unregisterSyncChart(PANEL_ID), []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const dropAll = () => {
      for (const r of [mainRef, smaRef, upperRef, lowerRef]) {
        if (r.current) {
          try {
            chart.removeSeries(r.current);
          } catch {
            // chart/series already disposed -- nothing to remove
          }
          r.current = null;
        }
      }
    };

    if (!focusedSeries || focusedSeries.lineData.length === 0) {
      dropAll();
      prevIdRef.current = "";
      return;
    }

    const dates = focusedSeries.lineData.map((d) => d.time);
    const values = focusedSeries.lineData.map((d) => d.value);
    const isSpread = focusedSeries.kind === "spread";
    const priceScaleId = focusedSeries.priceScaleId;
    const fmt = isSpread ? spreadFormatter : rateFormatter;

    const idChanged = prevIdRef.current !== focusedSeries.id;
    if (idChanged) {
      dropAll();
      mainRef.current = chart.addSeries(LineSeries, {
        color: focusedSeries.color,
        lineWidth: 2,
        title: focusedSeries.label,
        priceScaleId,
        priceFormat: { type: "custom", formatter: fmt },
      });
      smaRef.current = chart.addSeries(LineSeries, {
        color: CHART_COLORS.fgMuted,
        lineWidth: 1,
        priceScaleId,
        priceFormat: { type: "custom", formatter: fmt },
        crosshairMarkerVisible: false,
        lastValueVisible: false,
      });
    }

    const { mean, std } = rollingSeries(values, lookback);
    mainRef.current!.setData(alignToDates(dates, values) as never);
    smaRef.current!.setData(alignToDates(dates, mean) as never);
    smaRef.current!.applyOptions({ title: `SMA(${lookback})` });

    if (showBands) {
      const upper = mean.map((m, i) => (m == null || std[i] == null ? null : m + entryZ * (std[i] as number)));
      const lower = mean.map((m, i) => (m == null || std[i] == null ? null : m - entryZ * (std[i] as number)));
      const bandOpts = {
        color: CHART_COLORS.fgDim,
        lineWidth: 1 as const,
        lineStyle: LineStyle.Dotted,
        priceScaleId,
        priceFormat: { type: "custom" as const, formatter: fmt },
        crosshairMarkerVisible: false,
        lastValueVisible: false,
      };
      if (!upperRef.current) upperRef.current = chart.addSeries(LineSeries, bandOpts);
      if (!lowerRef.current) lowerRef.current = chart.addSeries(LineSeries, bandOpts);
      upperRef.current.setData(alignToDates(dates, upper) as never);
      lowerRef.current.setData(alignToDates(dates, lower) as never);
    } else {
      for (const r of [upperRef, lowerRef]) {
        if (r.current) {
          chart.removeSeries(r.current);
          r.current = null;
        }
      }
    }

    chart.priceScale(priceScaleId).applyOptions({ visible: true });

    if (idChanged) {
      prevIdRef.current = focusedSeries.id;
      chart.timeScale().fitContent();
    }
  }, [focusedSeries, lookback, entryZ, showBands]);

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-h2 text-fg-primary">
          {focused ? instrumentLabel(focused) : "Price / Spread"}
        </span>
        <span className="text-micro text-fg-muted">
          {focused
            ? focused.kind === "spread"
              ? "Spread (bp) · SMA overlay"
              : "Outright yield (%) · SMA overlay"
            : "Select an instrument in the Signals panel"}
        </span>
      </div>

      <ControlBar />

      <div className="relative min-h-0 flex-1">
        <LwChartBase onChartReady={onChartReady} />
        <SyncedTimeGuide chart={chart} suppressed={reticle != null} />
        <CrosshairReticle point={reticle} date={reticle?.date} paneWidth={reticle?.paneWidth} />

        {!focused && !isLoading && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <PanelEmptyState>
              No instrument focused — add one to the watchlist and click its row in the Signals panel.
            </PanelEmptyState>
          </div>
        )}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[rgba(22,28,38,0.75)] text-micro text-fg-muted">
            Loading rate history…
          </div>
        )}
        {isError && (
          <div className="absolute inset-0 flex items-center justify-center bg-[rgba(22,28,38,0.85)] text-micro text-fg-muted">
            Could not load rate history — confirm the pricing server is reachable.
          </div>
        )}
      </div>
    </div>
  );
}
