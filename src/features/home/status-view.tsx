"use client";

/**
 * Home's minimal overall-status view (MIGRATION_PLAN.md Phase 5), replacing
 * the removed KPI tile row/Top Movers/curve-compare (§2.2). IRS-only --
 * cross-asset (KTB/KTBF) P&L aggregation isn't computable until that
 * separate project exists (§2.2/§5 non-goals).
 */
import { format, parseISO, subDays } from "date-fns";
import { useMemo } from "react";
import { PriceDisplay } from "@/components/data/price-display";
import { useHistoricalPnlQuery, useMarketDataRange, useTrades } from "@/hooks/use-api";
import { tradesToPositionsIn } from "@/lib/portfolio-request";
import type { HistoricalPnlRequest } from "@/lib/api-client";

const LOOKBACK_DAYS = 30;

function StatField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-label font-bold text-fg-muted">{label}</span>
      <span className="text-body font-normal text-fg-primary">{children}</span>
    </div>
  );
}

export function StatusView() {
  const tradesQuery = useTrades();
  const rangeQuery = useMarketDataRange();
  const trades = useMemo(() => tradesQuery.data ?? [], [tradesQuery.data]);
  const maxDate = rangeQuery.data?.max_date;

  const pnlRequest: HistoricalPnlRequest | undefined = useMemo(() => {
    if (!maxDate || trades.length === 0) return undefined;
    return {
      positions: tradesToPositionsIn(trades),
      start_date: format(subDays(parseISO(maxDate), LOOKBACK_DAYS), "yyyy-MM-dd"),
      end_date: maxDate,
    };
  }, [maxDate, trades]);

  const pnlQuery = useHistoricalPnlQuery(pnlRequest);
  const latestPoint = pnlQuery.data?.points.at(-1);

  const isLoading = tradesQuery.isLoading || rangeQuery.isLoading || (Boolean(pnlRequest) && pnlQuery.isLoading);
  const isError = tradesQuery.isError || rangeQuery.isError || pnlQuery.isError;
  const hasIrsPositions = trades.length > 0;

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <span className="text-h2 text-fg-primary">Status</span>

      {!hasIrsPositions || !latestPoint ? (
        <div className="flex flex-1 items-center justify-center text-center text-body text-fg-muted">
          {isError
            ? "Could not load IRS positions from the pricing server."
            : isLoading
              ? "Loading…"
              : "No IRS positions booked yet."}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <StatField label="Net NPV (IRS)">
            <PriceDisplay value={latestPoint.net_npv} unit="KRW" />
          </StatField>
          <StatField label="Cumulative P&L (IRS)">
            <PriceDisplay value={latestPoint.cumulative_pnl} unit="KRW" />
          </StatField>
          <StatField label="As Of">{format(parseISO(latestPoint.valuation_date), "MMM d, yyyy")}</StatField>
          <StatField label="Baseline">
            {pnlQuery.data ? format(parseISO(pnlQuery.data.baseline_date), "MMM d, yyyy") : "—"}
          </StatField>
        </div>
      )}
    </div>
  );
}
