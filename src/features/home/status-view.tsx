"use client";

/**
 * Home's minimal overall-status view, bound to manually-entered positions
 * (manual-positions-store.ts) priced by the real backend's stateless,
 * DB-independent portfolio endpoints -- see use-manual-portfolio-metrics.ts.
 * Each stat's 1-year trend (use-manual-portfolio-trend.ts) fills the space
 * below the figure.
 */
import { Spinner } from "@blueprintjs/core";
import { formatDuration, formatKrw, formatNotionalKrw } from "@/lib/format";
import { useManualPortfolioMetrics } from "@/hooks/use-manual-portfolio-metrics";
import { useManualPortfolioTrend } from "@/hooks/use-manual-portfolio-trend";
import { Sparkline, type SparklinePoint } from "@/components/charts/sparkline";
import { format as formatDate, parseISO } from "date-fns";

function StatField({
  label,
  value,
  trend,
  trendColor,
  formatValue,
}: {
  label: string;
  value: string;
  trend: SparklinePoint[];
  trendColor?: string;
  formatValue: (value: number) => string;
}) {
  return (
    <div className="flex h-full flex-col gap-1">
      <span className="text-label font-bold text-fg-muted">{label}</span>
      <span className="text-body font-normal text-fg-primary font-mono tabular-nums">{value}</span>
      <div className="flex-1 min-h-[40px]">
        {trend.length >= 2 && (
          <Sparkline
            points={trend}
            color={trendColor}
            formatValue={formatValue}
            formatDate={(d) => formatDate(parseISO(d), "MMM d, yyyy")}
          />
        )}
      </div>
    </div>
  );
}

export function StatusView() {
  const { hasPositions, totalNotional, totalPnl, overallDuration, isLoading } = useManualPortfolioMetrics();
  const { pnlTrend, durationTrend, notionalTrend } = useManualPortfolioTrend();

  const pnlColor = totalPnl >= 0 ? "var(--sem-positive)" : "var(--sem-negative)";

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <span className="text-h2 text-fg-primary">Status</span>

      {!hasPositions ? (
        <div className="flex flex-1 items-center justify-center text-center text-body text-fg-muted">
          No positions added yet — add one from the Positions tab.
        </div>
      ) : isLoading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-center text-body text-fg-muted">
          <Spinner size={16} /> Pricing…
        </div>
      ) : (
        <div className="grid flex-1 min-h-0 grid-cols-3 gap-4">
          <StatField
            label="Overall Duration"
            value={formatDuration(overallDuration)}
            trend={durationTrend}
            formatValue={formatDuration}
          />
          <StatField
            label="Cumulative P&L"
            value={formatKrw(totalPnl)}
            trend={pnlTrend}
            trendColor={pnlColor}
            formatValue={formatKrw}
          />
          <StatField
            label="Total Notional"
            value={formatNotionalKrw(totalNotional)}
            trend={notionalTrend}
            formatValue={formatNotionalKrw}
          />
        </div>
      )}
    </div>
  );
}
