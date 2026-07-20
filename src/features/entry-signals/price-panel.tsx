"use client";

/**
 * The focused instrument's price/spread line with a rolling SMA overlay and
 * optional ±entryZ·σ Bollinger bands. Since s17 the analysis params
 * (lookback / thresholds) are set on the Configure stage — this panel is the
 * live PREVIEW beside those controls (and the detached /chart/es-price
 * window); only the bands toggle stays here, because it configures nothing
 * but this chart's own display. Time-axis stays synced with the Z-Score and
 * Equity panels via use-synced-time-scales.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { SegmentedControl } from "@blueprintjs/core";
import type { IChartApi, ISeriesApi, MouseEventParams } from "lightweight-charts";
import { LineSeries, LineStyle } from "lightweight-charts";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { LwChartBase, rateFormatter } from "@/components/charts/lw-chart-base";
import { CrosshairReticle, type CrosshairReticlePoint } from "@/components/charts/crosshair-reticle";
import { paneOffsetX, snapReticleToNearestSeries } from "@/components/charts/snap-reticle";
import { formatBp } from "@/lib/format";
import { alignToDates, rollingSeries } from "@/lib/math/rolling-stats";
import { instrumentLabel } from "@/lib/rv-instruments";
import { useEntrySignalsStore } from "@/stores/entry-signals-store";
import { CHART_CHROME_COLORS } from "@/lib/chart-colors";
import { CHART_COLORS } from "./chart-theme";
import { ensureFullDomainFit } from "./full-domain-fit";
import { useEntrySignalsData } from "./use-entry-signals-data";
import { PanelEmptyState, SyncedTimeGuide } from "./panel-shell";
import {
  registerSyncChart,
  setSharedHoverTime,
  syncSetLogicalRange,
  unregisterSyncChart,
} from "./use-synced-time-scales";

const PANEL_ID = "es-price";

/** Display-only toggle for THIS chart's ±σ envelope. */
function BandsToggle() {
  const showBands = useEntrySignalsStore((s) => s.showBands);
  const toggleBands = useEntrySignalsStore((s) => s.toggleBands);
  return (
    <SegmentedControl
      small
      options={[
        { label: "± Bands", value: "on" },
        { label: "Off", value: "off" },
      ]}
      value={showBands ? "on" : "off"}
      onValueChange={(v) => {
        if ((v === "on") !== showBands) toggleBands();
      }}
    />
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
  const fitRef = useRef<(() => void) | null>(null);
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
      // p.x is already overlay-space (snapReticleToNearestSeries adds the
      // offset); paneWidth must use the same origin or the label-flip drifts.
      setReticle({ x: p.x, y: p.y, date, paneWidth: paneOffsetX(api) + api.timeScale().width() });
      setSharedHoverTime(date);
    });
  }, []);

  useEffect(() => () => unregisterSyncChart(PANEL_ID), []);

  // Keyed off the `chart` STATE (not chartRef.current): when LwChartBase
  // remounts without this panel remounting — ChartFrame's maximize re-parents
  // it into the overlay portal — the fresh chart must trigger a series
  // rebuild, and only a dep can do that.
  useEffect(() => {
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
    const fmt = isSpread ? formatBp : rateFormatter;

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
      // s20 (s19 R2a): convergent full-domain fit instead of a one-shot
      // fitContent, which the mount race silently drops on the cache-hit
      // path. Group applier: a lone-chart fit is echoed away by the synced
      // siblings' stale ranges.
      fitRef.current?.();
      fitRef.current = ensureFullDomainFit(chart, dates.length, syncSetLogicalRange);
    }
  }, [chart, focusedSeries, lookback, entryZ, showBands]);

  useEffect(() => () => fitRef.current?.(), []);

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-h2 text-fg-primary">
          {focused ? instrumentLabel(focused) : "Price / Spread"}
        </span>
        <div className="flex items-center gap-3">
          <span className="text-micro text-fg-muted">
            {focused
              ? focused.kind === "spread"
                ? "Spread (bp) · SMA overlay"
                : "Outright yield (%) · SMA overlay"
              : "백테스트 대상을 선택하면 미리보기가 표시됩니다"}
          </span>
          <BandsToggle />
        </div>
      </div>

      <ChartFrame chartId="es-price" title="Price / Spread" className="min-h-0 flex-1">
        <LwChartBase onChartReady={onChartReady} />
        <SyncedTimeGuide chart={chart} suppressed={reticle != null} />
        <CrosshairReticle point={reticle} date={reticle?.date} paneWidth={reticle?.paneWidth} />

        {!focused && !isLoading && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <PanelEmptyState>
              관심 종목을 추가하고 백테스트 대상을 선택하면 가격/스프레드 미리보기가 표시됩니다.
            </PanelEmptyState>
          </div>
        )}
        {isLoading && (
          <div
            className="absolute inset-0 flex items-center justify-center text-micro text-fg-muted"
            style={{ background: CHART_CHROME_COLORS.scrimLightStale }}
          >
            Loading rate history…
          </div>
        )}
        {isError && (
          <div
            className="absolute inset-0 flex items-center justify-center text-micro text-fg-muted"
            style={{ background: CHART_CHROME_COLORS.scrimHeavyStale }}
          >
            Could not load rate history — confirm the pricing server is reachable.
          </div>
        )}
      </ChartFrame>
    </div>
  );
}
