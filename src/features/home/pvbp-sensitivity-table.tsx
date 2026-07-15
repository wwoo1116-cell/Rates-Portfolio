"use client";

/**
 * PVBP sensitivity grid: Sector × Tenor key-rate bucketed PVBP (₩/bp).
 * Backed by POST /api/portfolio/pvbp-sensitivity via use-portfolio-analytics.ts.
 * Bonds contribute their pre-computed pvbp per tenor_bucket; IRS positions
 * are re-priced delta by the real backend and bucketed by pillar.
 */
import { Spinner } from "@blueprintjs/core";
import { usePortfolioAnalytics } from "@/hooks/use-portfolio-analytics";

const TENOR_COLS = [
  "3M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "30Y",
] as const;

function Cell({ value }: { value: number }) {
  const t = Math.min(Math.abs(value) / 10_000_000, 1);
  const alpha = (0.07 + t * 0.45).toFixed(2);
  let bg = "transparent";
  let color = "var(--fg-dim)";
  if (value > 0) {
    bg = `rgba(15,153,96,${alpha})`;
    color = "var(--sem-positive)";
  } else if (value < 0) {
    bg = `rgba(219,55,55,${alpha})`;
    color = "var(--sem-negative)";
  }
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

  // The backend buckets 16 tenors but this table shows the 9 fixed by spec, so
  // Total legitimately exceeds the sum of visible cells whenever risk sits in a
  // hidden bucket (1D/9M/1.5Y/4Y/6Y/8Y/9Y). Disclose the gap instead of letting
  // the row fail eyeball reconciliation -- and instead of re-bucketing, which
  // would misattribute tenor risk to columns it isn't in.
  const grandTotal = pvbpSensitivity?.find((r: any) => r.sector === "합계");
  const hiddenAmount = grandTotal
    ? grandTotal.total - TENOR_COLS.reduce((s, c) => s + (grandTotal[c] ?? 0), 0)
    : 0;
  const hasHidden = Math.abs(hiddenAmount) >= 500; // below cell display precision (1k)

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
            style={{ tableLayout: "fixed", fontSize: 12 }}
          >
            <colgroup>
              <col style={{ width: 100 }} />
              {TENOR_COLS.map((c) => (
                <col key={c} style={{ width: 72 }} />
              ))}
              <col style={{ width: 80 }} />
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
            /* Same ‡ + --fg-dim disclosure pattern as the Daily P&L partial
               footnote: the number is right, the column set just can't show
               all of it. */
            <div className="pt-2 text-label text-fg-dim">
              ‡ Total includes {hiddenAmount > 0 ? "+" : ""}
              {Math.round(hiddenAmount / 1000).toLocaleString()}k from tenor buckets not shown
              (1D · 9M · 1.5Y · 4Y · 6Y · 8Y · 9Y).
            </div>
          )}
        </div>
      )}
    </div>
  );
}
