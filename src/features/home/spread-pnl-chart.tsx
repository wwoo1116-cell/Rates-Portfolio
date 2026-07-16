"use client";

/**
 * Strategy P&L line for spread-position-panel. Deliberately thin: it renders a
 * single already-computed series (lib/math/pvbp-sizing.spreadPnlPath) on the
 * canonical SeriesChart (s14 migration off a hand-rolled LwChartBase host), so
 * the shared defaults — no vertical gridlines, signed 억/만 KRW formatting,
 * crosshair reticle + tooltip — arrive without local wiring. The last-value
 * badge stays off (pre-s14 behavior): the panel header's final-P&L readout
 * already owns that number.
 */
import { useMemo } from "react";
import { SeriesChart, type SeriesChartSeriesDef } from "@/components/charts/series-chart";
import { CHART_CHROME_COLORS } from "@/lib/chart-colors";

export function SpreadPnlChart({ data }: { data: { time: string; value: number }[] }) {
  const series = useMemo<SeriesChartSeriesDef[]>(
    () => [
      {
        id: "spread-pnl",
        label: "Strategy P&L",
        color: CHART_CHROME_COLORS.accentLine, // --sem-info (canvas can't resolve CSS custom properties)
        data,
        valueKind: "krw",
        axisTitle: "",
        lastValueBadge: false,
      },
    ],
    [data],
  );
  return <SeriesChart series={series} tooltip zeroLine priceLineVisible={false} />;
}
