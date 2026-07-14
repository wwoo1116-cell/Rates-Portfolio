"use client";

import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { differenceInCalendarDays, format, parseISO, subYears } from "date-fns";
import { Spinner } from "@blueprintjs/core";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import { LineSeries } from "lightweight-charts";
import { Badge } from "@/components/ui/badge";
import { PriceDisplay } from "@/components/data/price-display";
import { LwChartBase } from "@/components/charts/lw-chart-base";
import { usePortfolioFiltersStore } from "@/stores/portfolio-filters-store";
import { usePortfolioPositions } from "./use-portfolio-positions";
import { useManualPortfolioValuation } from "@/hooks/use-manual-portfolio-valuation";
import { usePositionMtmHistory } from "@/hooks/use-api";
import type { PortfolioCashFlowOut, NpvTraceRequest, NpvTracePointOut } from "@/lib/api-client";
import type { Position } from "@/types/portfolio";

/** Bonds carry empty effectiveDate/maturityDate (the source ledger has no
 * exact dates for them, only remaining-days) -- format(parseISO("")) throws,
 * so this guards every date-display site in the panel instead of assuming
 * every position is a dated IRS swap. */
function formatDateOrDash(iso: string): string {
  if (!iso) return "—";
  const d = parseISO(iso);
  return Number.isNaN(d.getTime()) ? "—" : format(d, "MMM d, yyyy");
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-label font-bold text-fg-muted">{label}</span>
      <span className="text-body font-normal text-fg-primary">{children}</span>
    </div>
  );
}

function CashflowTable({ cashflows }: { cashflows: PortfolioCashFlowOut[] }) {
  if (cashflows.length === 0) {
    return (
      <div className="flex h-16 items-center justify-center rounded bg-bg-tertiary text-micro text-fg-dim">
        No cashflows.
      </div>
    );
  }
  const sorted = [...cashflows].sort((a, b) => a.payment_date.localeCompare(b.payment_date));
  return (
    <div className="max-h-48 overflow-auto rounded bg-bg-tertiary">
      <table className="w-full text-body">
        <thead>
          <tr className="border-b border-border-subtle">
            <th className="py-1.5 px-2 text-left text-label font-bold text-fg-muted">Payment Date</th>
            <th className="py-1.5 px-2 text-left text-label font-bold text-fg-muted">Leg</th>
            <th className="py-1.5 px-2 text-right text-label font-bold text-fg-muted">Rate</th>
            <th className="py-1.5 px-2 text-right text-label font-bold text-fg-muted">Cashflow</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((cf, i) => (
            <tr key={`${cf.payment_date}-${cf.leg}-${i}`} className="border-t border-border-subtle">
              <td className="py-1.5 px-2 font-mono tabular-nums text-fg-secondary">
                {format(parseISO(cf.payment_date), "yyyy-MM-dd")}
              </td>
              <td className="py-1.5 px-2 text-fg-muted uppercase">{cf.leg}</td>
              <td className="py-1.5 px-2 text-right font-mono tabular-nums text-fg-secondary">
                {cf.rate != null ? `${(cf.rate * 100).toFixed(4)}%` : "—"}
              </td>
              <td className="py-1.5 px-2 text-right font-mono tabular-nums text-fg-primary">
                {cf.cashflow != null ? Math.round(cf.cashflow).toLocaleString() : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Builds the request for a real 1-year MTM history (POST /api/mtm/npv-trace,
 * genuine curve-based repricing per date -- not mocked) for any IRS position
 * (real trade, manual entry, or uploaded), clipped to
 * [max(effective date, 1 year ago), min(today, maturity date)]. Returns null
 * for bonds (no pricing engine exists for them) or positions missing the
 * dates a swap needs to be reconstructed. */
function buildMtmTraceRequest(position: Position): NpvTraceRequest | null {
  if (position.assetClass !== "IRS" || !position.effectiveDate || !position.maturityDate) return null;

  const start = parseISO(position.effectiveDate);
  const maturity = parseISO(position.maturityDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(maturity.getTime())) return null;

  const today = new Date();
  const oneYearAgo = subYears(today, 1);
  const windowStart = start > oneYearAgo ? start : oneYearAgo;
  const windowEnd = maturity < today ? maturity : today;
  if (windowStart >= windowEnd) return null;

  const tenorYears = differenceInCalendarDays(maturity, start) / 365;
  if (tenorYears <= 0) return null;

  return {
    swap: {
      trade_date: position.effectiveDate,
      tenor_years: tenorYears,
      maturity_date: position.maturityDate,
      notional: position.notionalKrwEok * 100_000_000,
      fixed_rate: position.fixedRate / 100,
      pay_fixed: position.direction === "Pay",
    },
    start_date: format(windowStart, "yyyy-MM-dd"),
    end_date: format(windowEnd, "yyyy-MM-dd"),
  };
}

function MtmHistoryChart({ points }: { points: NpvTracePointOut[] }) {
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  const onChartReady = useCallback((chart: IChartApi) => {
    chartRef.current = chart;
    seriesRef.current = chart.addSeries(LineSeries, {
      color: "var(--accent)",
      lineWidth: 2,
      priceFormat: { type: "custom", formatter: (v: number) => Math.round(v).toLocaleString() },
    });
  }, []);

  useEffect(() => {
    if (!seriesRef.current) return;
    seriesRef.current.setData(points.map((p) => ({ time: p.valuation_date, value: p.clean_npv })) as never);
    chartRef.current?.timeScale().fitContent();
  }, [points]);

  return (
    <div className="relative h-40 w-full">
      <LwChartBase onChartReady={onChartReady} />
    </div>
  );
}

export const DetailsPanel = memo(function DetailsPanel() {
  const selectedPositionId = usePortfolioFiltersStore((state) => state.selectedPositionId);
  const { positions } = usePortfolioPositions();
  const { priceQuery } = useManualPortfolioValuation();

  const position = useMemo(
    () => positions.find((item) => item.id === selectedPositionId) ?? null,
    [positions, selectedPositionId],
  );

  // Hooks below must run unconditionally (before the `!position` early
  // return) per the Rules of Hooks -- buildMtmTraceRequest/usePositionMtmHistory
  // both tolerate a null position, returning/disabling cleanly.
  const mtmTraceRequest = useMemo(() => (position ? buildMtmTraceRequest(position) : null), [position]);
  const mtmHistory = usePositionMtmHistory(mtmTraceRequest);

  if (!position) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-body text-fg-muted">
        Select a position to view details
      </div>
    );
  }

  const isManual = position.isManual === true;
  const cashflows = isManual
    ? priceQuery.data?.cashflows.filter((cf) => cf.position_id === position.id) ?? []
    : [];

  return (
    <div className="flex h-full flex-col gap-6 overflow-auto p-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-micro text-fg-muted">{position.id}</span>
        <Badge tone={position.direction === "Pay" || position.direction === "Buy" ? "positive" : "negative"}>
          {position.direction}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Asset Class">{position.assetClass}</Field>
        <Field label="Book">{position.book}</Field>
        <Field label="Ticker / Instrument">{position.ticker}</Field>
        <Field label="Tenor">{position.tenor}</Field>
        <Field label="Effective Date">{formatDateOrDash(position.effectiveDate)}</Field>
        <Field label="Maturity Date">{formatDateOrDash(position.maturityDate)}</Field>
        <Field label="Notional (100M KRW)">{position.notionalKrwEok.toLocaleString()}</Field>
        <Field label="Fixed / Strike Rate">
          <PriceDisplay value={position.fixedRate} unit="%" />
        </Field>
        {/* Real per-position DV01 for manual positions (POST /api/portfolio/delta);
            real trades still have no per-position DV01 wired (Phase 4, engine/risk.py). */}
        <Field label="DV01 (KRW/bp)">{isManual ? Math.round(position.dv01).toLocaleString() : "—"}</Field>
        <Field label="Convexity">—</Field>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-label text-fg-muted">Cashflow Schedule</span>
        {!isManual ? (
          <div className="flex h-24 items-center justify-center rounded bg-bg-tertiary text-micro text-fg-dim">
            Cashflow model pending
          </div>
        ) : priceQuery.isLoading ? (
          <div className="flex h-24 items-center justify-center gap-2 rounded bg-bg-tertiary text-micro text-fg-dim">
            <Spinner size={14} /> Pricing…
          </div>
        ) : priceQuery.isError ? (
          <div className="flex h-24 items-center justify-center rounded bg-bg-tertiary text-micro text-fg-dim">
            Could not price this position.
          </div>
        ) : (
          <CashflowTable cashflows={cashflows} />
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-label text-fg-muted">MTM (Last 1Y)</span>
        {mtmTraceRequest == null ? (
          <div className="flex h-24 items-center justify-center rounded bg-bg-tertiary text-micro text-fg-dim">
            {position.assetClass === "IRS"
              ? "MTM history unavailable for this position"
              : "MTM history unavailable for bonds -- no pricing engine"}
          </div>
        ) : mtmHistory.isLoading ? (
          <div className="flex h-40 items-center justify-center gap-2 rounded bg-bg-tertiary text-micro text-fg-dim">
            <Spinner size={14} /> Loading MTM history…
          </div>
        ) : mtmHistory.isError ? (
          <div className="flex h-40 items-center justify-center rounded bg-bg-tertiary text-micro text-fg-dim">
            Could not load MTM history.
          </div>
        ) : mtmHistory.data && mtmHistory.data.points.length > 0 ? (
          <div className="flex flex-col gap-1">
            <MtmHistoryChart points={mtmHistory.data.points} />
            <div className="flex items-center justify-between text-micro text-fg-muted">
              <span>{mtmHistory.data.points[0].valuation_date}</span>
              <PriceDisplay value={mtmHistory.data.points.at(-1)!.clean_npv} unit="KRW" />
            </div>
          </div>
        ) : (
          <div className="flex h-24 items-center justify-center rounded bg-bg-tertiary text-micro text-fg-dim">—</div>
        )}
      </div>
    </div>
  );
});
