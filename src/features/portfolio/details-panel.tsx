"use client";

import { memo, useMemo } from "react";
import { format, parseISO } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { PriceDisplay } from "@/components/data/price-display";
import { usePortfolioFiltersStore } from "@/stores/portfolio-filters-store";
import { usePortfolioPositions } from "./use-portfolio-positions";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-label font-bold text-fg-muted">{label}</span>
      <span className="text-body font-normal text-fg-primary">{children}</span>
    </div>
  );
}

export const DetailsPanel = memo(function DetailsPanel() {
  const selectedPositionId = usePortfolioFiltersStore((state) => state.selectedPositionId);
  const { positions } = usePortfolioPositions();

  const position = useMemo(
    () => positions.find((item) => item.id === selectedPositionId) ?? null,
    [positions, selectedPositionId],
  );

  if (!position) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-body text-fg-muted">
        Select a position to view details
      </div>
    );
  }

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
        <Field label="Effective Date">{format(parseISO(position.effectiveDate), "MMM d, yyyy")}</Field>
        <Field label="Maturity Date">{format(parseISO(position.maturityDate), "MMM d, yyyy")}</Field>
        <Field label="Notional (100M KRW)">{position.notionalKrwEok.toLocaleString()}</Field>
        <Field label="Fixed / Strike Rate">
          <PriceDisplay value={position.fixedRate} unit="%" />
        </Field>
        {/* Per-position DV01/convexity isn't wired -- only an aggregate
            portfolio-level DV01-by-tenor-bucket exists (usePortfolioRiskBuckets,
            Home's heatmap). Showing 0 here would misleadingly read as zero risk. */}
        <Field label="DV01 (KRW/bp)">—</Field>
        <Field label="Convexity">—</Field>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-label text-fg-muted">Cashflow Schedule</span>
        <div className="flex h-24 items-center justify-center rounded bg-bg-tertiary text-micro text-fg-dim">
          Cashflow model pending
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-label text-fg-muted">MTM</span>
        <div className="flex h-24 items-center justify-center rounded bg-bg-tertiary text-micro text-fg-dim">
          {position.npv != null ? (
            <PriceDisplay value={position.npv} unit="KRW" />
          ) : (
            "MTM chart pending"
          )}
        </div>
      </div>
    </div>
  );
});
