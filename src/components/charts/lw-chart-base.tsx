"use client";

import {
  useEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
} from "react";
import {
  createChart,
  CrosshairMode,
  type IChartApi,
  type DeepPartial,
  type ChartOptions,
  type ISeriesApi,
  type SeriesType,
} from "lightweight-charts";

/**
 * Global formatter for interest rates (e.g., 0.0239 -> 2.3900%).
 */
export const rateFormatter = (v: number) => `${(v * 100).toFixed(4)}%`;

export const BASE_CHART_OPTIONS: DeepPartial<ChartOptions> = {
  localization: {
    locale: "en-US",
  },
  layout: {
    background: { color: "#161c26" },      // --bg-surface
    textColor: "#a0aab8",                  // --fg-secondary
    fontSize: 12,
    fontFamily: "Inter, system-ui, sans-serif",
  },
  grid: {
    vertLines: { color: "rgba(255,255,255,0.07)", style: 0 },
    horzLines: { color: "rgba(255,255,255,0.07)", style: 0 },
  },
  crosshair: {
    // Native line/label rendering fully disabled -- superseded by
    // CrosshairReticle (src/components/charts/crosshair-reticle.tsx), a
    // DOM/SVG overlay each consumer renders as a sibling to <LwChartBase />.
    // Per-series crosshairMarkerVisible dots are unaffected.
    mode: CrosshairMode.Normal,
    vertLine: { visible: false, labelVisible: false },
    horzLine: { visible: false, labelVisible: false },
  },
  timeScale: {
    borderColor: "rgba(255,255,255,0.11)",
    // Date-only data ("YYYY-MM-DD" strings) — keep timeVisible false so
    // lightweight-charts renders date ticks cleanly and doesn't introduce
    // whitespace gaps for weekend/holiday dates missing from the series.
    timeVisible: false,
    secondsVisible: false,
    fixLeftEdge: false,
    fixRightEdge: false,
  },
  rightPriceScale: {
    borderColor: "rgba(255,255,255,0.11)",
    scaleMargins: { top: 0.08, bottom: 0.08 },
  },
  handleScroll: true,
  handleScale: true,
};

export interface LwChartHandle {
  chart: IChartApi | null;
  addSeries: <T extends SeriesType>(type: T) => ISeriesApi<T> | null;
}

export interface LwChartBaseProps {
  onChartReady?: (chart: IChartApi) => void;
  style?: React.CSSProperties;
  className?: string;
  formatter?: (price: number) => string;
  /** Mount-time overrides merged over BASE_CHART_OPTIONS (e.g. a host whose
   * canvas must sit on the canonical --bg-surface rather than the base
   * background). Read once at mount, like onChartReady. */
  options?: DeepPartial<ChartOptions>;
}

/**
 * Base wrapper for lightweight-charts (TradingView).
 * - 1px solid white precision crosshair
 * - Deep slate background matching --bg-surface
 * - Institutional grid lines at 0.07 opacity
 * - ResizeObserver for responsive layout
 */
export const LwChartBase = forwardRef<LwChartHandle, LwChartBaseProps>(
  ({ onChartReady, style, className, formatter, options }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef     = useRef<IChartApi | null>(null);

    useImperativeHandle(ref, () => ({
      get chart() {
        return chartRef.current;
      },
      addSeries<T extends SeriesType>(_type: T): ISeriesApi<T> | null {
        return null; // caller uses chartRef directly via onChartReady
      },
    }));

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const chart = createChart(container, {
        ...BASE_CHART_OPTIONS,
        ...(formatter ? { localization: { ...BASE_CHART_OPTIONS.localization, priceFormatter: formatter } } : {}),
        ...(options ?? {}),
        width:  container.clientWidth,
        height: container.clientHeight,
      });
      chartRef.current = chart;

      onChartReady?.(chart);

      // Responsive resize
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          chartRef.current?.applyOptions({ width, height });
        }
      });
      ro.observe(container);

      return () => {
        ro.disconnect();
        chart.remove();
        chartRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // stable mount/unmount — onChartReady captured at mount time

    return (
      <div
        ref={containerRef}
        className={className}
        style={{ width: "100%", height: "100%", ...style }}
      />
    );
  },
);
LwChartBase.displayName = "LwChartBase";
