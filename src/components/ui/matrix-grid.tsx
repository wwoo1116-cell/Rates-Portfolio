"use client";

/**
 * MatrixGrid — the Home PVBP sensitivity table's matrix grammar as a shared,
 * prop-driven component (RECON-SCEN). The grammar is a faithful mirror of
 * features/home/pvbp-sensitivity-table.tsx: fixed-width colgroup (label col +
 * tenor cols + optional total col), uppercase label headers, right-aligned
 * mono cells filled by the S10 Jade/Berry heat ramp with white text and a
 * muted em-dash at zero, an emphasized 합계 row, and a horizontal scrollbar
 * instead of squeezed cells (a column set may never decide which risk the
 * desk gets to see).
 *
 * WHY a mirror and not an import: the Home component is bound to
 * usePortfolioAnalytics with no data props (and its file is owned by the
 * parallel RECON-DAILY lane — zero diffs allowed there this session), so
 * "import the component" is structurally impossible without editing it.
 * Post-merge follow-up recorded in RECON_SCEN_REPORT.md: rebase the Home
 * table onto this shared grid so the grammar has one implementation.
 */
import { heatRampFill } from "@/lib/chart-colors";

const LABEL_COL_PX = 100;
const VALUE_COL_PX = 64;
const TOTAL_COL_PX = 80;

export interface MatrixGridRow {
  key: string;
  label: string;
  /** Aligned to `columns`; null renders the muted em-dash (absent ≠ 0). */
  cells: (number | null)[];
  total?: number | null;
  /** 합계-style emphasis (stronger top border + bold). */
  emphasis?: boolean;
}

export interface MatrixGridProps {
  /** Column headers, already ordered (full set — no abbreviation). */
  columns: string[];
  rows: MatrixGridRow[];
  /** Heat-ramp saturation range (|value| at full saturation). */
  cellRange: number;
  /** Cell text. Default: signed thousands "+123k" (the Home PVBP format). */
  formatCell?: (v: number) => string;
  /** Header of the label column (uppercase like Home's "Sector"). */
  leadHeader: string;
  /** Total column header; omit the column by passing null. */
  totalHeader?: string | null;
  /** FB3 F4a — the honest-display rule. Default true = the Home PVBP grammar
   * (a ZERO KRD MASS keeps its em-dash: nothing to show). Pass false on
   * surfaces whose cells are MEASUREMENTS (e.g. the M2 path matrix): a
   * genuine 0.0 renders as 0.0; only `null` cells (unmapped/absent) keep the
   * em-dash. Same rule the daily recon's SectorTenorMatrix carries (48a6b15
   * zero-vs-unmapped fix). */
  zeroAsDash?: boolean;
}

const defaultFormat = (v: number) =>
  `${v > 0 ? "+" : ""}${Math.round(v / 1000).toLocaleString()}k`;

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
  const v = value ?? 0;
  // null = absent/unmapped — ALWAYS an em-dash. A numeric 0 dashes only under
  // the mass grammar (zeroAsDash); measurement surfaces render it as a value.
  const dash = value === null || (zeroAsDash && v === 0);
  const bg = heatRampFill(v, range);
  return (
    <span
      style={{
        display: "block",
        textAlign: "right",
        padding: "2px 6px",
        background: bg,
        color: dash || v === 0 ? "var(--fg-dim)" : "var(--chart-heat-text)",
        fontFamily: "var(--font-mono)",
        fontVariantNumeric: "tabular-nums",
        fontWeight: 600,
        fontSize: 11,
      }}
    >
      {dash ? "—" : format(v)}
    </span>
  );
}

export function MatrixGrid({
  columns,
  rows,
  cellRange,
  formatCell = defaultFormat,
  leadHeader,
  totalHeader = "Total",
  zeroAsDash = true,
}: MatrixGridProps) {
  const minWidth =
    LABEL_COL_PX + columns.length * VALUE_COL_PX + (totalHeader ? TOTAL_COL_PX : 0);
  return (
    <div className="min-h-0 overflow-auto">
      <table
        className="w-full border-collapse text-body"
        style={{ tableLayout: "fixed", fontSize: 12, minWidth }}
      >
        <colgroup>
          <col style={{ width: LABEL_COL_PX }} />
          {columns.map((c) => (
            <col key={c} style={{ width: VALUE_COL_PX }} />
          ))}
          {totalHeader && <col style={{ width: TOTAL_COL_PX }} />}
        </colgroup>
        <thead>
          <tr className="border-b border-border-subtle">
            <th className="py-1.5 text-left text-label text-fg-muted font-bold uppercase">
              {leadHeader}
            </th>
            {columns.map((c) => (
              <th key={c} className="py-1.5 text-right text-label text-fg-muted font-bold uppercase">
                {c}
              </th>
            ))}
            {totalHeader && (
              <th className="py-1.5 text-right text-label text-fg-muted font-bold uppercase">
                {totalHeader}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.key}
              className="border-t border-border-subtle"
              style={row.emphasis ? { borderTop: "1px solid var(--border-dim)", fontWeight: 700 } : {}}
            >
              <td className="py-1.5 text-label text-fg-muted uppercase truncate">{row.label}</td>
              {row.cells.map((v, i) => (
                <td key={columns[i]} className="py-1">
                  <Cell value={v} range={cellRange} format={formatCell} zeroAsDash={zeroAsDash} />
                </td>
              ))}
              {totalHeader && (
                <td className="py-1">
                  <Cell
                    value={row.total ?? null}
                    range={cellRange}
                    format={formatCell}
                    zeroAsDash={zeroAsDash}
                  />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
