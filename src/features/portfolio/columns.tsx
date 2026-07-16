"use client";

import type { ColDef, ColGroupDef } from "ag-grid-community";
import { format, parseISO } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { HeatmapPill } from "@/components/data/heatmap-pill";
import { PriceDisplay } from "@/components/data/price-display";
import { NumericCell } from "@/components/ui/numeric-cell";
import { PNL_COLORS, heatRampFill, withAlpha } from "@/lib/chart-colors";
import { getTenorBucket, type AssetClass } from "@/lib/constants";
import type { Position } from "@/types/portfolio";

// Asset class badge accent: all map to accent (#F58220) per color spec
// (non-directional categorical data → accent only, not green/red/blue).
// Partial: AssetClass now also spans bond sectors (국고채/…) which default to
// accent via the lookup site's fallback.
export const ASSET_CLASS_TONE: Partial<Record<AssetClass, "accent">> = {
  KTB: "accent",
  IRS: "accent",
  CRS: "accent",
  KTBF: "accent",
};

const KRD_KEYS = ["krd1y", "krd3y", "krd5y", "krd10y"] as const;

export function computeKrdBounds(positions: Position[]) {
  const bounds = {} as Record<(typeof KRD_KEYS)[number], [number, number]>;
  for (const key of KRD_KEYS) {
    const values = positions.map((p) => p[key]);
    bounds[key] = [Math.min(...values), Math.max(...values)];
  }
  return bounds;
}

function formatDate(iso: string) {
  try { return format(parseISO(iso), "yyyy-MM-dd"); } catch { return iso; }
}

export function createPositionColumnDefs(
  krdBounds: Record<(typeof KRD_KEYS)[number], [number, number]>,
): (ColDef<Position> | ColGroupDef<Position>)[] {
  return [
    {
      field: "book",
      headerName: "BOOK",
      width: 110,
      hide: true,    // used for grouping only
      rowGroup: false,
    },
    {
      colId: "tenorBucket",
      headerName: "BUCKET",
      width: 80,
      hide: true,
      valueGetter: ({ data }) => (data ? getTenorBucket(data.tenor) : ""),
    },
    {
      field: "assetClass",
      headerName: "CLASS",
      width: 80,
      cellRenderer: ({ value }: { value: AssetClass }) => {
        const span = document.createElement("span");
        span.style.cssText = `
          display:inline-flex;align-items:center;padding:1px 6px;
          font-size:10px;font-weight:600;letter-spacing:0.06em;
          text-transform:uppercase;font-family:var(--font-ui);
          background:var(--accent-soft);color:var(--accent);line-height:1.5;
        `;
        span.textContent = value;
        return span;
      },
    },
    {
      field: "id",
      headerName: "POS ID",
      width: 120,
      cellStyle: {
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color: "var(--fg-muted)",
      },
    },
    {
      field: "ticker",
      headerName: "TICKER / INSTRUMENT",
      width: 180,
      cellStyle: { color: "var(--fg-primary)" },
    },
    {
      field: "direction",
      headerName: "DIR",
      width: 70,
      // S12: Jade/Berry direction pair (soft fills via withAlpha, matching
      // Badge's pnl-* tones). NOTE: this module is currently DEAD CODE —
      // positions-grid.tsx builds its own columnDefs inline and nothing
      // imports createPositionColumnDefs — migrated anyway so no green/red
      // survives to be resurrected with it (REPORT_s12.md).
      cellRenderer: ({ value }: { value: string }) => {
        const isPos = value === "Pay" || value === "Buy";
        const span = document.createElement("span");
        span.style.cssText = `
          display:inline-flex;align-items:center;padding:1px 6px;
          font-size:10px;font-weight:600;letter-spacing:0.06em;
          text-transform:uppercase;font-family:var(--font-ui);
          background:${isPos ? withAlpha(PNL_COLORS.pos, 0.15) : withAlpha(PNL_COLORS.neg, 0.15)};
          color:${isPos ? "var(--chart-pnl-pos)" : "var(--chart-pnl-neg)"};
          line-height:1.5;
        `;
        span.textContent = value;
        return span;
      },
    },
    {
      field: "tenor",
      headerName: "TENOR",
      width: 70,
      cellStyle: { color: "var(--fg-secondary)" },
    },
    {
      field: "effectiveDate",
      headerName: "EFFECTIVE",
      width: 110,
      valueFormatter: ({ value }) => formatDate(value as string),
      cellStyle: { color: "var(--fg-muted)", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" },
    },
    {
      field: "maturityDate",
      headerName: "MATURITY",
      width: 110,
      valueFormatter: ({ value }) => formatDate(value as string),
      cellStyle: { color: "var(--fg-muted)", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" },
    },
    {
      field: "notionalKrwEok",
      headerName: "NOTIONAL (100M)",
      width: 130,
      type: "numericColumn",
      valueFormatter: ({ value }) => (value as number).toLocaleString(),
      cellStyle: {
        fontFamily: "var(--font-mono)",
        fontVariantNumeric: "tabular-nums",
        textAlign: "right",
        color: "var(--fg-secondary)",
      },
    },
    {
      field: "fixedRate",
      headerName: "FIXED/STRIKE %",
      width: 130,
      type: "numericColumn",
      valueFormatter: ({ value }) => `${(value as number).toFixed(4)}%`,
      cellStyle: {
        fontFamily: "var(--font-mono)",
        fontVariantNumeric: "tabular-nums",
        textAlign: "right",
        color: "var(--accent)",
      },
    },
    {
      field: "dv01",
      headerName: "DV01 (KRW/bp)",
      width: 130,
      type: "numericColumn",
      cellRenderer: ({ value }: { value: number }) => {
        const span = document.createElement("span");
        span.style.cssText = `
          display:block;text-align:right;
          font-family:var(--font-mono);font-variant-numeric:tabular-nums;
          font-size:var(--text-sm);
          color:${value >= 0 ? "var(--chart-pnl-pos)" : "var(--chart-pnl-neg)"};
        `;
        span.textContent = Math.round(value).toLocaleString();
        return span;
      },
    },
    // KRD column group
    {
      headerName: "KEY RATE DURATION",
      marryChildren: true,
      children: [
        {
          field: "krd1y",
          headerName: "1Y",
          width: 72,
          type: "numericColumn",
          cellRenderer: ({ value }: { value: number }) => makeHeatCell(value, krdBounds.krd1y),
        },
        {
          field: "krd3y",
          headerName: "3Y",
          width: 72,
          type: "numericColumn",
          cellRenderer: ({ value }: { value: number }) => makeHeatCell(value, krdBounds.krd3y),
        },
        {
          field: "krd5y",
          headerName: "5Y",
          width: 72,
          type: "numericColumn",
          cellRenderer: ({ value }: { value: number }) => makeHeatCell(value, krdBounds.krd5y),
        },
        {
          field: "krd10y",
          headerName: "10Y",
          width: 72,
          type: "numericColumn",
          cellRenderer: ({ value }: { value: number }) => makeHeatCell(value, krdBounds.krd10y),
        },
      ],
    } as ColGroupDef<Position>,
  ];
}

// Vanilla DOM cell renderer for KRD heatmap cells (AG Grid vanilla renderer
// pattern). S10: fills come from the Jade/Berry signed-sensitivity heat ramp
// (lib/chart-colors) with fixed white text — replaces the green/red fills.
function makeHeatCell(value: number, bounds: [number, number]): HTMLElement {
  const range = Math.max(Math.abs(bounds[0]), Math.abs(bounds[1])) || 1;
  const bg = heatRampFill(value, range);
  const color = value === 0 ? "var(--fg-muted)" : "var(--chart-heat-text)";
  const sign = value > 0 ? "+" : "";
  const span = document.createElement("span");
  span.style.cssText = `
    display:block;text-align:right;padding:0 4px;
    background:${bg};color:${color};
    font-family:var(--font-mono);font-variant-numeric:tabular-nums;
    font-size:var(--text-sm);line-height:1.8;
  `;
  span.textContent = `${sign}${value.toFixed(1)}`;
  return span;
}
