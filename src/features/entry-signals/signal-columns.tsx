"use client";

import type { CellStyle, ColDef, ValueFormatterParams } from "ag-grid-community";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { PriceDisplay } from "@/components/data/price-display";
import { SIGNAL_LABEL, type Signal } from "@/lib/math/rolling-stats";
import type { SelectedInstrument } from "@/lib/rv-instruments";

export interface SignalRow {
  id: string;
  inst: SelectedInstrument;
  label: string;
  kind: "outright" | "spread";
  /** Latest value: decimal rate for outrights, bp for spreads. */
  value: number | null;
  mean: number | null;
  std: number | null;
  z: number | null;
  signal: Signal;
  /** value − mean, in the same raw units as `value`. */
  distance: number | null;
  /** |z| (or -1 when z is null) — natural sort key. */
  absZ: number;
}

const SIGNAL_TONE: Record<Signal, BadgeTone> = {
  ENTRY_LONG: "positive",
  ENTRY_SHORT: "negative",
  WATCH: "risk",
  NONE: "accent",
};

const RIGHT_MONO: CellStyle = {
  fontFamily: "var(--font-mono)",
  fontVariantNumeric: "tabular-nums",
  textAlign: "right",
  color: "var(--fg-secondary)",
};

/** Format a raw value in display units: bp (spread) or %-points (outright). */
function fmtUnits(kind: "outright" | "spread", v: number | null): string {
  if (v == null) return "—";
  return kind === "spread" ? v.toFixed(2) : (v * 100).toFixed(3);
}

export function createSignalColumnDefs(entryZ: number, warnZ: number): ColDef<SignalRow>[] {
  return [
    {
      field: "label",
      headerName: "INSTRUMENT",
      width: 210,
      cellStyle: { color: "var(--fg-primary)" },
    },
    {
      field: "kind",
      headerName: "TYPE",
      width: 96,
      cellRenderer: (p: { data?: SignalRow }) =>
        p.data ? <Badge tone="accent">{p.data.kind === "spread" ? "Spread" : "Outright"}</Badge> : null,
    },
    {
      field: "value",
      headerName: "VALUE",
      width: 110,
      type: "numericColumn",
      cellRenderer: (p: { data?: SignalRow }) => {
        const row = p.data;
        if (!row || row.value == null) return "—";
        return row.kind === "spread" ? (
          <span style={RIGHT_MONO}>{row.value.toFixed(2)} bp</span>
        ) : (
          <PriceDisplay value={row.value * 100} unit="%" />
        );
      },
    },
    {
      field: "mean",
      headerName: "MEAN",
      width: 96,
      type: "numericColumn",
      valueFormatter: (p: ValueFormatterParams<SignalRow>) =>
        fmtUnits(p.data?.kind ?? "outright", p.data?.mean ?? null),
      cellStyle: RIGHT_MONO,
    },
    {
      field: "std",
      headerName: "σ",
      width: 84,
      type: "numericColumn",
      valueFormatter: (p: ValueFormatterParams<SignalRow>) =>
        fmtUnits(p.data?.kind ?? "outright", p.data?.std ?? null),
      cellStyle: { ...RIGHT_MONO, color: "var(--fg-muted)" },
    },
    {
      field: "z",
      headerName: "Z-SCORE",
      width: 104,
      type: "numericColumn",
      comparator: (a, b) => (a ?? 0) - (b ?? 0),
      cellRenderer: (p: { data?: SignalRow }) => {
        const z = p.data?.z ?? null;
        if (z == null) return <span style={{ color: "var(--fg-dim)", display: "block", textAlign: "right" }}>—</span>;
        const a = Math.abs(z);
        const color =
          a >= entryZ ? (z > 0 ? "var(--sem-negative)" : "var(--sem-positive)") : a >= warnZ ? "var(--accent)" : "var(--fg-muted)";
        return (
          <span style={{ display: "block", textAlign: "right", color, fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
            {z > 0 ? "+" : ""}
            {z.toFixed(2)}σ
          </span>
        );
      },
    },
    {
      field: "signal",
      headerName: "SIGNAL",
      width: 128,
      cellRenderer: (p: { data?: SignalRow }) => {
        const signal = p.data?.signal ?? "NONE";
        if (signal === "NONE") return <span style={{ color: "var(--fg-dim)" }}>—</span>;
        return <Badge tone={SIGNAL_TONE[signal]}>{SIGNAL_LABEL[signal]}</Badge>;
      },
    },
    {
      field: "distance",
      headerName: "DIST TO MEAN",
      width: 120,
      type: "numericColumn",
      valueFormatter: (p: ValueFormatterParams<SignalRow>) => {
        const row = p.data;
        if (!row || row.distance == null) return "—";
        const s = fmtUnits(row.kind, row.distance);
        return row.distance > 0 ? `+${s}` : s;
      },
      cellStyle: RIGHT_MONO,
    },
  ];
}
