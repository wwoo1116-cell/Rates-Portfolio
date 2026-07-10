"use client";

/**
 * Home's real rate-history chart: GET /api/rate-history (CD91D/IRS-tenor/BOK
 * base rate daily series), the first frontend consumer of a backend endpoint
 * that previously only had a working reference UI in the old
 * IRS Pricer_Mock/web app (OverviewPage.jsx + rateHistory.js).
 *
 * Fetches the FULL available range (min_date -> max_date) from the backend —
 * the /api/market-data/range endpoint returns min_date: 2010-03-02, giving
 * 16+ years of continuous daily data (4,000+ points).
 *
 * The chart container is ALWAYS mounted regardless of loading/error state so
 * the lightweight-charts instance is never destroyed and re-created mid-session
 * (which would lose the subscribeClick registration). Error/loading states are
 * rendered as an overlay inside the chart area instead.
 *
 * Clicking a date opens the PnL Trace dockview panel to the right (see
 * pnl-trace-panel.tsx), passed that date's own market-rate point via
 * dockview's addPanel `params`.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DockviewApi } from "dockview-react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import { LineSeries } from "lightweight-charts";
import { LwChartBase, rateFormatter } from "@/components/charts/lw-chart-base";
import { CHART_SERIES_COLORS, SPREAD_SERIES_COLORS } from "@/lib/chart-colors";
import { useMarketDataRange, useRateHistory } from "@/hooks/use-api";
import {
  RATE_SERIES_OPTIONS,
  SPREAD_DEFS,
  toLineData,
  toSpreadLineData,
  type RateSeriesKey,
} from "@/lib/rate-history-helpers";

const DEFAULT_SERIES = new Set<RateSeriesKey>(["cd_rate", "1Y", "3Y", "10Y"]);
const PNL_TRACE_PANEL_ID = "home-pnltrace-panel";
const RATES_PANEL_ID = "home-rates-panel";

function toggleButtonStyle(active: boolean): React.CSSProperties {
  return {
    height: 24,
    padding: "0 8px",
    fontSize: 11,
    fontWeight: active ? 700 : 500,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    fontFamily: "var(--font-ui)",
    border: `1px solid ${active ? "var(--accent)" : "var(--border-dim)"}`,
    background: active ? "var(--accent-soft)" : "transparent",
    color: active ? "var(--accent)" : "var(--fg-muted)",
    cursor: "pointer",
    transition: "background-color var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast)",
  };
}

interface RateHistoryChartProps {
  api?: DockviewApi | null;
}

export function RateHistoryChart({ api }: RateHistoryChartProps) {
  const rangeQuery = useMarketDataRange();
  // Use the backend's true min/max — /api/market-data/range returns
  // min_date: 2010-03-02 (16+ years). No artificial lookback window.
  const minDate = rangeQuery.data?.min_date ?? "";
  const maxDate = rangeQuery.data?.max_date ?? "";

  const historyQuery = useRateHistory(minDate, maxDate);
  const points = useMemo(() => historyQuery.data?.points ?? [], [historyQuery.data]);

  const [selectedSeries, setSelectedSeries] = useState<Set<RateSeriesKey>>(DEFAULT_SERIES);
  const [selectedSpreads, setSelectedSpreads] = useState<Set<string>>(new Set());

  const chartRef = useRef<IChartApi | null>(null);
  const rateSeriesRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  const spreadSeriesRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());

  // pointsRef: kept in sync via useLayoutEffect (runs synchronously before
  // paint, ensuring the subscribeClick handler always sees the latest points
  // without a stale closure, without the "access ref during render" lint error).
  const pointsRef = useRef(points);
  useLayoutEffect(() => { pointsRef.current = points; }, [points]);

  // Stable ref to the dockview api so onChartReady doesn't need it in deps.
  const apiRef = useRef(api);
  useLayoutEffect(() => { apiRef.current = api; }, [api]);

  // useCallback: stable identity so LwChartBase's mount-time capture is
  // always valid even if the parent re-renders before the effect fires.
  const onChartReady = useCallback((chart: IChartApi) => {
    chartRef.current = chart;
    rateSeriesRef.current = new Map();
    spreadSeriesRef.current = new Map();
    chart.subscribeClick((param) => {
      if (!param.time || !apiRef.current) return;
      const date = String(param.time);
      const point = pointsRef.current.find((p) => p.valuation_date === date);
      if (!point) return;

      const existing = apiRef.current.getPanel(PNL_TRACE_PANEL_ID);
      if (existing) existing.api.close();

      const reference = apiRef.current.getPanel(RATES_PANEL_ID);
      apiRef.current.addPanel({
        id: PNL_TRACE_PANEL_ID,
        component: "pnltrace",
        title: "PnL Trace",
        params: { point },
        position: reference ? { referencePanel: RATES_PANEL_ID, direction: "right" } : undefined,
      });
    });
  }, []); // empty deps: chart is created once, click handler reads from refs

  // Rate-level series (right price scale, %).
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || points.length === 0) return;
    const seriesMap = rateSeriesRef.current;

    // Remove de-selected series
    for (const [key, series] of seriesMap) {
      if (!selectedSeries.has(key as RateSeriesKey)) {
        chart.removeSeries(series);
        seriesMap.delete(key);
      }
    }
    // Add / update selected series
    RATE_SERIES_OPTIONS.forEach((opt, index) => {
      if (!selectedSeries.has(opt.key)) return;
      let series = seriesMap.get(opt.key);
      if (!series) {
        series = chart.addSeries(LineSeries, {
          color: CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length],
          lineWidth: 2,
          title: opt.label,
          priceFormat: { type: "custom", formatter: rateFormatter },
        });
        seriesMap.set(opt.key, series);
      }
      series.setData(toLineData(points, opt.key) as never);
    });
    chart.timeScale().fitContent();
  }, [points, selectedSeries]);

  // Spread series (left price scale, bp).
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || points.length === 0) return;
    const seriesMap = spreadSeriesRef.current;

    for (const [key, series] of seriesMap) {
      if (!selectedSpreads.has(key)) {
        chart.removeSeries(series);
        seriesMap.delete(key);
      }
    }
    SPREAD_DEFS.forEach((def, index) => {
      if (!selectedSpreads.has(def.key)) return;
      let series = seriesMap.get(def.key);
      if (!series) {
        series = chart.addSeries(LineSeries, {
          color: SPREAD_SERIES_COLORS[index % SPREAD_SERIES_COLORS.length],
          lineWidth: 1,
          lineStyle: 1,
          title: `${def.label} (bp)`,
          priceScaleId: "left",
        });
        chart.priceScale("left").applyOptions({ visible: true });
        seriesMap.set(def.key, series);
      }
      series.setData(toSpreadLineData(points, def) as never);
    });
  }, [points, selectedSpreads]);

  function toggleSeries(key: RateSeriesKey) {
    setSelectedSeries((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function toggleSpread(key: string) {
    setSelectedSpreads((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Derived status — shown as overlay inside the chart area, NOT by
  // conditionally unmounting LwChartBase (which would destroy the chart
  // instance and lose the subscribeClick registration).
  const isLoading = rangeQuery.isLoading || historyQuery.isLoading;
  const isError   = rangeQuery.isError   || historyQuery.isError;

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <span className="text-h2 text-fg-primary">Rate History</span>
        <span className="text-micro text-fg-muted">
          {minDate && maxDate
            ? `${minDate} – ${maxDate} · ${points.length.toLocaleString()} sessions · click a date to trace PnL`
            : "Click a date to trace a hypothetical trade\u2019s PnL to today"}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {RATE_SERIES_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => toggleSeries(opt.key)}
            style={toggleButtonStyle(selectedSeries.has(opt.key))}
          >
            {opt.label}
          </button>
        ))}
        {SPREAD_DEFS.map((def) => (
          <button
            key={def.key}
            type="button"
            onClick={() => toggleSpread(def.key)}
            style={toggleButtonStyle(selectedSpreads.has(def.key))}
          >
            {def.label}
          </button>
        ))}
      </div>

      {/* Chart container is ALWAYS in the DOM — error/loading shown as overlay */}
      <div className="relative min-h-0 flex-1">
        <LwChartBase onChartReady={onChartReady} formatter={rateFormatter} />

        {/* Loading overlay */}
        {isLoading && !isError && (
          <div
            style={{
              position: "absolute", inset: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(22,28,38,0.75)",
              fontSize: 12, color: "var(--fg-muted)", fontFamily: "var(--font-ui)",
              letterSpacing: "0.05em",
            }}
          >
            Loading rate history…
          </div>
        )}

        {/* Error overlay */}
        {isError && (
          <div
            style={{
              position: "absolute", inset: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(22,28,38,0.85)",
              fontSize: 12, color: "var(--fg-muted)", fontFamily: "var(--font-ui)",
            }}
          >
            Could not load rate history — confirm the pricing server is reachable.
          </div>
        )}
      </div>
    </div>
  );
}
