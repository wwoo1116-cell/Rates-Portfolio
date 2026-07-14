"use client";

/**
 * Book-level daily P&L attribution table.
 * Backed by POST /api/portfolio/book-daily-pnl via use-portfolio-analytics.ts.
 * Columns: Book | Carry | Funding Cost | Bond Valuation | Swap Valuation | Swap Theta | Total
 */
import { Spinner } from "@blueprintjs/core";
import { usePortfolioAnalytics } from "@/hooks/use-portfolio-analytics";
import { useSettingsStore } from "@/stores/settings-store";

function KrwCell({ value }: { value: number }) {
  const abs = Math.abs(value);
  let display: string;
  if (abs >= 1_000_000_000) {
    display = `${(value / 1_000_000_000).toFixed(2)}B`;
  } else if (abs >= 1_000_000) {
    display = `${(value / 1_000_000).toFixed(1)}M`;
  } else {
    display = Math.round(value).toLocaleString();
  }
  const color =
    value > 0
      ? "var(--sem-positive)"
      : value < 0
        ? "var(--sem-negative)"
        : "var(--fg-dim)";
  return (
    <span
      style={{
        display: "block",
        textAlign: "right",
        fontFamily: "var(--font-mono)",
        fontVariantNumeric: "tabular-nums",
        color,
        fontSize: 12,
      }}
    >
      {value > 0 ? "+" : ""}
      {display}
    </span>
  );
}

const COLUMNS = [
  { key: "dailyCarry", label: "Carry" },
  { key: "fundingCost", label: "Funding" },
  { key: "bondValuation", label: "Bond Val." },
  { key: "swapValuation", label: "Swap Val." },
  { key: "swapThetaPnL", label: "Swap θ" },
  { key: "total", label: "Total" },
] as const;

export function BookDailyPnlTable() {
  const { hasPositions, bookDailyPnl, isLoading, isError } = usePortfolioAnalytics();
  const fundingSpreadBp = useSettingsStore((s) => s.fundingSpreadBp);

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-h2 text-fg-primary">Daily P&amp;L by Book</span>
        <span className="text-label text-fg-muted whitespace-nowrap">
          Funding: BOK + {fundingSpreadBp}bp · ₩ day-over-day
        </span>
      </div>

      {!hasPositions ? (
        <div className="flex flex-1 items-center justify-center text-center text-body text-fg-muted">
          Upload portfolio data to view daily P&amp;L.
        </div>
      ) : isLoading && !bookDailyPnl ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-body text-fg-muted">
          <Spinner size={16} /> Computing…
        </div>
      ) : isError ? (
        <div className="flex flex-1 items-center justify-center text-body text-sem-negative">
          Failed to load P&amp;L data.
        </div>
      ) : (
        <div className="min-h-0 overflow-auto flex-1">
          <table
            className="w-full border-collapse text-body"
            style={{ tableLayout: "fixed", fontSize: 12 }}
          >
            <colgroup>
              <col style={{ width: 110 }} />
              {COLUMNS.map((c) => (
                <col key={c.key} style={{ minWidth: 80 }} />
              ))}
            </colgroup>
            <thead>
              <tr className="border-b border-border-subtle">
                <th className="py-1.5 text-left text-label text-fg-muted font-bold uppercase">
                  Book
                </th>
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    className="py-1.5 text-right text-label text-fg-muted font-bold uppercase"
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(bookDailyPnl ?? []).map((row: any) => (
                <tr
                  key={row.book}
                  className="border-t border-border-subtle"
                  style={
                    row.book === "Total"
                      ? { borderTop: "1px solid var(--border-dim)", fontWeight: 700 }
                      : {}
                  }
                >
                  <td className="py-1.5 text-label text-fg-muted truncate">{row.book}</td>
                  {COLUMNS.map((c) => (
                    <td key={c.key} className="py-1">
                      <KrwCell value={row[c.key] ?? 0} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
