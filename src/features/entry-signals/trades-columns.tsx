"use client";

import type { CellStyle, ColDef, ValueFormatterParams } from "ag-grid-community";
import { Badge } from "@/components/ui/badge";
import type { BtTrade } from "@/lib/math/backtest";

const RIGHT_MONO: CellStyle = {
  fontFamily: "var(--font-mono)",
  fontVariantNumeric: "tabular-nums",
  textAlign: "right",
  color: "var(--fg-secondary)",
};

function fmtDate(p: ValueFormatterParams<BtTrade>): string {
  return (p.value as string) ?? "—";
}

export function createTradeColumnDefs(): ColDef<BtTrade>[] {
  return [
    { field: "entryDate", headerName: "ENTRY", width: 110, valueFormatter: fmtDate, cellStyle: { ...RIGHT_MONO, textAlign: "left", color: "var(--fg-muted)" } },
    { field: "exitDate", headerName: "EXIT", width: 110, valueFormatter: fmtDate, cellStyle: { ...RIGHT_MONO, textAlign: "left", color: "var(--fg-muted)" } },
    {
      field: "direction",
      headerName: "DIR",
      width: 84,
      cellRenderer: (p: { data?: BtTrade }) => {
        if (!p.data) return null;
        const long = p.data.direction > 0;
        // Chart P&L pair (S10): matches the equity curve's L/S entry markers.
        return <Badge tone={long ? "pnl-positive" : "pnl-negative"}>{long ? "Long" : "Short"}</Badge>;
      },
    },
    {
      field: "entryZ",
      headerName: "ENTRY Z",
      width: 92,
      type: "numericColumn",
      valueFormatter: (p) => (p.value == null ? "—" : `${(p.value as number).toFixed(2)}σ`),
      cellStyle: RIGHT_MONO,
    },
    {
      field: "exitZ",
      headerName: "EXIT Z",
      width: 92,
      type: "numericColumn",
      valueFormatter: (p) => (p.value == null ? "—" : `${(p.value as number).toFixed(2)}σ`),
      cellStyle: RIGHT_MONO,
    },
    {
      field: "entryValue",
      headerName: "ENTRY BP",
      width: 96,
      type: "numericColumn",
      valueFormatter: (p) => (p.value == null ? "—" : (p.value as number).toFixed(2)),
      cellStyle: RIGHT_MONO,
    },
    {
      field: "exitValue",
      headerName: "EXIT BP",
      width: 96,
      type: "numericColumn",
      valueFormatter: (p) => (p.value == null ? "—" : (p.value as number).toFixed(2)),
      cellStyle: RIGHT_MONO,
    },
    {
      field: "pnl",
      headerName: "PNL",
      width: 110,
      type: "numericColumn",
      cellRenderer: (p: { value?: number }) => {
        const v = p.value ?? 0;
        return (
          <span style={{ display: "block", textAlign: "right", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", color: v >= 0 ? "var(--chart-pnl-pos)" : "var(--chart-pnl-neg)" }}>
            {v > 0 ? "+" : ""}
            {Math.round(v).toLocaleString()}
          </span>
        );
      },
    },
    {
      field: "exitReason",
      headerName: "EXIT REASON",
      width: 120,
      cellRenderer: (p: { value?: string }) =>
        p.value ? <Badge tone="accent">{p.value}</Badge> : null,
    },
  ];
}
