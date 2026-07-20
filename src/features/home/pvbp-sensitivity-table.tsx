"use client";

/**
 * PVBP sensitivity grid: Sector × Tenor key-rate bucketed PVBP (₩/bp).
 * Backed by POST /api/portfolio/pvbp-sensitivity via use-portfolio-analytics.ts.
 * Bonds contribute their pre-computed pvbp per tenor_bucket; IRS positions
 * are re-priced delta by the real backend and bucketed by pillar.
 *
 * RECON-DAILY: the table markup itself now lives in sector-tenor-matrix.tsx
 * (extracted verbatim) so the 일별 대사 panel reuses this matrix's design
 * grammar rather than forking it. This file keeps the data plumbing, the
 * dead-man switch, and the panel chrome.
 */
import { Spinner } from "@blueprintjs/core";
import { usePortfolioAnalytics } from "@/hooks/use-portfolio-analytics";
import { SectorTenorMatrix, type MatrixRow } from "./sector-tenor-matrix";

/** ALL 16 backend tenor buckets, in the backend's own order -- mirrors
 * portfolio_analytics_service._TENOR_COLUMNS and must stay in sync with it.
 *
 * This used to be a 9-column "spec subset", which silently hid 98.9% of bond
 * KRD mass (the book concentrates at 9M/1.5Y/4Y -- all hidden) and made the
 * IRS row look ~12,255k short of its own Total (SESSION4_REPORT N-1/N-2).
 * The panel scrolls horizontally rather than dropping data: a column set may
 * never decide which risk the desk gets to see. */
export const TENOR_COLS = [
  "1D", "3M", "6M", "9M", "1Y", "1.5Y", "2Y", "3Y",
  "4Y", "5Y", "6Y", "7Y", "8Y", "9Y", "10Y", "30Y",
] as const;

/** Fill scale saturates at ±10M ₩/bp — same magnitude cap the old continuous
 * alpha scale used; only the palette moved to the S10 Jade/Berry heat ramp
 * (white text on any fill, zero keeps the muted em-dash). */
const CELL_RANGE = 10_000_000;

/** Response rows → matrix rows, missing buckets zero-filled (the API always
 * sends all 16, so `?? 0` is belt-and-braces, not a hidden default). */
export function toMatrixRows(rows: Array<Record<string, unknown>>): MatrixRow[] {
  return rows.map((row) => ({
    label: String(row.sector),
    cells: TENOR_COLS.map((c) => (typeof row[c] === "number" ? (row[c] as number) : 0)),
    total: typeof row.total === "number" ? row.total : 0,
    emphasized: row.sector === "합계",
  }));
}

export function PvbpSensitivityTable() {
  const {
    hasPositions,
    closeDate,
    pvbpSensitivity,
    pvbpLoading: isLoading,
    pvbpError: isError,
  } = usePortfolioAnalytics();

  // Dead-man switch, not a feature: with all 16 backend buckets drawn, every
  // row's visible cells sum to its Total and this stays silent (a test pins
  // that). If the backend ever grows a 17th bucket, the gap and the offending
  // bucket names surface immediately instead of silently understating risk
  // the way the old 9-column subset did.
  const grandTotal = pvbpSensitivity?.find((r: any) => r.sector === "합계");
  const hiddenAmount = grandTotal
    ? grandTotal.total - TENOR_COLS.reduce((s, c) => s + (grandTotal[c] ?? 0), 0)
    : 0;
  const hasHidden = Math.abs(hiddenAmount) >= 500; // below cell display precision (1k)
  const unknownBuckets = grandTotal
    ? Object.keys(grandTotal).filter(
        (k) => k !== "sector" && k !== "total" && !(TENOR_COLS as readonly string[]).includes(k),
      )
    : [];

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <span className="text-h2 text-fg-primary">PVBP Sensitivity</span>
        <span className="text-label text-fg-muted">
          {/* Priced off the CLOSE snapshot -- Daily P&L next door shows the
              next business day (its as_of), so both panels carry their date. */}
          {closeDate ? `${closeDate} close · ` : ""}Sector × Tenor (₩/bp · 000)
        </span>
      </div>

      {!hasPositions ? (
        <div className="flex flex-1 items-center justify-center text-center text-body text-fg-muted">
          Upload portfolio data to view PVBP sensitivity.
        </div>
      ) : isLoading && !pvbpSensitivity ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-body text-fg-muted">
          <Spinner size={16} /> Computing…
        </div>
      ) : isError ? (
        <div className="flex flex-1 items-center justify-center text-body text-sem-danger">
          Failed to load sensitivity data.
        </div>
      ) : (
        <div className="min-h-0 overflow-auto flex-1">
          <SectorTenorMatrix
            columns={TENOR_COLS}
            rows={toMatrixRows(pvbpSensitivity ?? [])}
            cellRange={CELL_RANGE}
          />

          {hasHidden && (
            /* Should never render: TENOR_COLS covers every backend bucket. If
               it does, the backend grew a bucket this table doesn't know --
               same ‡ + --fg-dim disclosure pattern as the Daily P&L partial
               footnote until TENOR_COLS is updated. */
            <div className="pt-2 text-label text-fg-dim">
              ‡ Total includes {hiddenAmount > 0 ? "+" : ""}
              {Math.round(hiddenAmount / 1000).toLocaleString()}k from tenor buckets missing from
              this table{unknownBuckets.length > 0 ? ` (${unknownBuckets.join(" · ")})` : ""} —
              update TENOR_COLS.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
