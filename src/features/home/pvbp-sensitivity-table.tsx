"use client";

/**
 * PVBP sensitivity grid: Sector × Tenor key-rate bucketed PVBP (₩/bp).
 * Backed by POST /api/portfolio/pvbp-sensitivity via use-portfolio-analytics.ts.
 * Bonds contribute their pre-computed pvbp per tenor_bucket; IRS positions
 * are re-priced delta by the real backend and bucketed by pillar.
 */
import { Spinner } from "@blueprintjs/core";
import { heatRampFill } from "@/lib/chart-colors";
import { usePortfolioAnalytics } from "@/hooks/use-portfolio-analytics";

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

const SECTOR_COL_PX = 100;
const TENOR_COL_PX = 64;
const TOTAL_COL_PX = 80;
// The width at which all 17 columns render at full size. Narrower panels get
// a horizontal scrollbar (the wrapper is already overflow-auto) instead of
// squeezed-to-illegible cells.
const TABLE_MIN_PX = SECTOR_COL_PX + TENOR_COLS.length * TENOR_COL_PX + TOTAL_COL_PX;

/** Fill scale saturates at ±10M ₩/bp — same magnitude cap the old continuous
 * alpha scale used; only the palette moved to the S10 Jade/Berry heat ramp
 * (white text on any fill, zero keeps the muted em-dash). */
const CELL_RANGE = 10_000_000;

function Cell({ value }: { value: number }) {
  const bg = heatRampFill(value, CELL_RANGE);
  const color = value === 0 ? "var(--fg-dim)" : "var(--chart-heat-text)";
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
      {value === 0 ? "—" : `${value > 0 ? "+" : ""}${Math.round(value / 1000).toLocaleString()}k`}
    </span>
  );
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
        <div className="flex flex-1 items-center justify-center text-body text-sem-negative">
          Failed to load sensitivity data.
        </div>
      ) : (
        <div className="min-h-0 overflow-auto flex-1">
          <table
            className="w-full border-collapse text-body"
            style={{ tableLayout: "fixed", fontSize: 12, minWidth: TABLE_MIN_PX }}
          >
            <colgroup>
              <col style={{ width: SECTOR_COL_PX }} />
              {TENOR_COLS.map((c) => (
                <col key={c} style={{ width: TENOR_COL_PX }} />
              ))}
              <col style={{ width: TOTAL_COL_PX }} />
            </colgroup>
            <thead>
              <tr className="border-b border-border-subtle">
                <th className="py-1.5 text-left text-label text-fg-muted font-bold uppercase">
                  Sector
                </th>
                {TENOR_COLS.map((c) => (
                  <th
                    key={c}
                    className="py-1.5 text-right text-label text-fg-muted font-bold uppercase"
                  >
                    {c}
                  </th>
                ))}
                <th className="py-1.5 text-right text-label text-fg-muted font-bold uppercase">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {(pvbpSensitivity ?? []).map((row: any) => (
                <tr
                  key={row.sector}
                  className="border-t border-border-subtle"
                  style={
                    row.sector === "합계"
                      ? { borderTop: "1px solid var(--border-dim)", fontWeight: 700 }
                      : {}
                  }
                >
                  <td className="py-1.5 text-label text-fg-muted uppercase truncate">
                    {row.sector}
                  </td>
                  {TENOR_COLS.map((c) => (
                    <td key={c} className="py-1">
                      <Cell value={row[c] ?? 0} />
                    </td>
                  ))}
                  <td className="py-1">
                    <Cell value={row.total ?? 0} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

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
