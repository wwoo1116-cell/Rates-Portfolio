"use client";

/**
 * Strategy P&L line for spread-position-panel. Deliberately thin: it renders a
 * single already-computed series (lib/math/pvbp-sizing.spreadPnlPath) on the
 * app's shared LwChartBase, with a zero baseline so the break-even is readable.
 */
import { useEffect, useRef, useState } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import { LineSeries, LineStyle } from "lightweight-charts";

import { LwChartBase } from "@/components/charts/lw-chart-base";
import { formatPnlKrw } from "./pnl-format";

/** Canvas can't resolve CSS custom properties, so series colours must be
 * literals — same constraint (and same values) as rate-history-chart. */
const PNL_LINE = "#3B82F6"; // --sem-info
const ZERO_LINE = "rgba(255,255,255,0.25)";

export function SpreadPnlChart({ data }: { data: { time: string; value: number }[] }) {
  const [chart, setChart] = useState<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  useEffect(() => {
    if (!chart) return;
    if (!seriesRef.current) {
      seriesRef.current = chart.addSeries(LineSeries, {
        color: PNL_LINE,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        priceFormat: { type: "custom", formatter: formatPnlKrw },
      });
      seriesRef.current.createPriceLine({
        price: 0,
        color: ZERO_LINE,
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: false,
        title: "",
      });
    }
    seriesRef.current.setData(data as never);
    chart.timeScale().fitContent();
  }, [chart, data]);

  return (
    <LwChartBase
      onChartReady={(c) => {
        // A remounted LwChartBase disposes the old chart; drop the stale series
        // handle with it or the next setData hits a disposed object.
        seriesRef.current = null;
        setChart(c);
      }}
    />
  );
}
