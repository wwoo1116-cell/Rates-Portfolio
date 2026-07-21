"use client";

/**
 * RECON-DAILY — the Home PVBP matrix's presentational grammar, extracted so
 * the 일별 대사 panel's three matrices (M1 KRD@D−1, M2 Δbp, M3 contribution)
 * reuse the existing design instead of inventing a new one (owner ruling:
 * no new matrix design). DOM/classes/styles are byte-identical to what
 * pvbp-sensitivity-table.tsx rendered inline — its N-1/N-2 pins run against
 * this markup unchanged.
 *
 * Data-free by design: rows in, table out. All arithmetic stays in the
 * caller/lib (daily-recon-math.ts), all fetching in the hooks.
 */
import { heatRampFill } from "@/lib/chart-colors";

const SECTOR_COL_PX = 100;
const TENOR_COL_PX = 64;
const TOTAL_COL_PX = 80;

export interface MatrixRow {
  label: string;
  /** Per-column values. null = NOT KNOWN/unmapped — rendered as the same
   * muted em-dash a zero uses (the matrix grammar's empty-bucket treatment);
   * the caller's exclusion note carries the "excluded from Σ" distinction. */
  cells: Array<number | null>;
  /** Row total over KNOWN cells; null hides the figure (em-dash). */
  total: number | null;
  /** 합계-style emphasis (heavier top border + bold). */
  emphasized?: boolean;
}

function Cell({
  value,
  range,
  format,
  zeroAsDash,
}: {
  value: number | null;
  range: number;
  format: (v: number) => string;
  zeroAsDash: boolean;
}) {
  // range > 0 → the PVBP heat treatment (Jade/Berry ramp, white text).
  // range 0 → no fill; the signed Jade/Berry pair colors the text instead
  // (S12 universal signed pair) — used by the Δbp row.
  const bg = value == null ? "transparent" : heatRampFill(value, range);
  const color =
    value == null || value === 0
      ? "var(--fg-dim)"
      : range > 0
        ? "var(--chart-heat-text)"
        : value > 0
          ? "var(--chart-pnl-pos)"
          : "var(--chart-pnl-neg)";
  return (
    <span
      style={{
        display: "block",
        textAlign: "right",
        padding: "2px 6px",
        background: bg,
        color,
        fontFamily: "var(--font-mono)",
        fontVariantNumeric: "tabular-nums",
        fontWeight: 600,
        fontSize: 11,
      }}
    >
      {value == null || (value === 0 && zeroAsDash) ? "—" : format(value)}
    </span>
  );
}

/** The PVBP table's own cell text: signed thousands, "+29,278k". */
export function formatCellK(value: number): string {
  return `${value > 0 ? "+" : ""}${Math.round(value / 1000).toLocaleString()}k`;
}

export function SectorTenorMatrix({
  columns,
  rows,
  cellRange,
  formatCell = formatCellK,
  leadHeader = "Sector",
  totalHeader = "Total",
  zeroAsDash = true,
}: {
  columns: readonly string[];
  rows: MatrixRow[];
  /** Heat-ramp saturation cap (₩ or bp, matching the cell unit); 0 disables
   * the fill entirely (plain signed text). */
  cellRange: number;
  formatCell?: (v: number) => string;
  leadHeader?: string;
  totalHeader?: string;
  /** true (default, PVBP grammar): a zero renders the muted em-dash — right
   * for aggregation matrices where 0 means "no mass here". The Δbp row passes
   * FALSE: there 0 is a real measurement ("didn't move"), and rendering it
   * like an unmapped pillar's — would make "didn't move" look like "don't
   * know" — the exact blank-vs-zero confusion the honesty rules ban. */
  zeroAsDash?: boolean;
}) {
  // The width at which all columns render at full size. Narrower panels get
  // a horizontal scrollbar (callers wrap in overflow-auto) instead of
  // squeezed-to-illegible cells.
  const minWidth = SECTOR_COL_PX + columns.length * TENOR_COL_PX + TOTAL_COL_PX;
  return (
    <table
      className="w-full border-collapse text-body"
      style={{ tableLayout: "fixed", fontSize: 12, minWidth }}
    >
      <colgroup>
        <col style={{ width: SECTOR_COL_PX }} />
        {columns.map((c) => (
          <col key={c} style={{ width: TENOR_COL_PX }} />
        ))}
        <col style={{ width: TOTAL_COL_PX }} />
      </colgroup>
      <thead>
        <tr className="border-b border-border-subtle">
          <th className="py-1.5 text-left text-label text-fg-muted font-bold uppercase">
            {leadHeader}
          </th>
          {columns.map((c) => (
            <th
              key={c}
              className="py-1.5 text-right text-label text-fg-muted font-bold uppercase"
            >
              {c}
            </th>
          ))}
          <th className="py-1.5 text-right text-label text-fg-muted font-bold uppercase">
            {totalHeader}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.label}
            className="border-t border-border-subtle"
            style={
              row.emphasized
                ? { borderTop: "1px solid var(--border-dim)", fontWeight: 700 }
                : {}
            }
          >
            <td className="py-1.5 text-label text-fg-muted uppercase truncate">
              {row.label}
            </td>
            {row.cells.map((v, i) => (
              <td key={columns[i]} className="py-1">
                <Cell value={v} range={cellRange} format={formatCell} zeroAsDash={zeroAsDash} />
              </td>
            ))}
            <td className="py-1">
              <Cell value={row.total} range={cellRange} format={formatCell} zeroAsDash={zeroAsDash} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
