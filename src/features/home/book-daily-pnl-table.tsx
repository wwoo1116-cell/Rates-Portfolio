"use client";

/**
 * Book-level daily P&L, decomposed as ΔNPV = MtM + Theta.
 * Backed by POST /api/portfolio/book-daily-pnl via use-portfolio-analytics.ts.
 * Columns: Book | Theta | MtM | Total | Funding
 *
 * Total is the emphasized figure; MtM/Theta are its two components and are
 * rendered secondary. They sum to Total exactly -- the backend derives them by
 * revaluation (roll the date holding quotes fixed / hold the date and move the
 * quotes), so there is no residual bucket to hide a discrepancy in.
 *
 * Funding sits OUTSIDE Total: it's a financing cost, not a change in NPV.
 *
 * THREE HONESTY RULES, all about not overstating what we know:
 *  1. An unknown MtM renders "—", never 0. 0 asserts "quotes arrived, nothing
 *     moved"; blank says "we don't know yet". On a risk screen those must not
 *     look the same.
 *  2. Freshness is per SOURCE, not one "market open" flag -- swaps price off
 *     IRS/CD and bonds off the Credit Matrix, and their coverage genuinely
 *     differs. The ribbon names each source and its date so a half-empty
 *     column explains itself.
 *  3. A row summing over any unknown MtM is PARTIAL and is marked (muted Total
 *     + ‡ footnote), never presented as a finished total.
 */
import { Spinner, Tooltip } from "@blueprintjs/core";
import { usePortfolioAnalytics } from "@/hooks/use-portfolio-analytics";
import { useSettingsStore } from "@/stores/settings-store";
import type { QuoteSource } from "@/lib/api-types";

function formatKrwCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  return Math.round(value).toLocaleString();
}

function KrwCell({
  value,
  emphasis = false,
  suffix,
  tooltip,
}: {
  value: number;
  emphasis?: boolean;
  suffix?: string;
  tooltip?: string;
}) {
  const color =
    value > 0
      ? "var(--sem-positive)"
      : value < 0
        ? "var(--sem-negative)"
        : "var(--fg-dim)";
  const cell = (
    <span
      style={{
        display: "block",
        textAlign: "right",
        fontFamily: "var(--font-mono)",
        fontVariantNumeric: "tabular-nums",
        color,
        fontSize: 12,
        // Total carries the weight; MtM/Theta are its components and stay
        // secondary. Hierarchy comes from weight, not hue -- the semantic
        // colour above still means direction, not importance. A partial Total
        // drops back to the component weight: it hasn't earned the emphasis.
        fontWeight: emphasis ? 600 : 400,
        cursor: tooltip ? "help" : undefined,
      }}
    >
      {value > 0 ? "+" : ""}
      {formatKrwCompact(value)}
      {suffix && <span style={{ color: "var(--fg-dim)" }}>{suffix}</span>}
    </span>
  );
  return tooltip ? (
    <Tooltip content={tooltip} compact placement="top">
      {cell}
    </Tooltip>
  ) : (
    cell
  );
}

/** Placeholder for an MtM we don't know yet. Deliberately the same em-dash +
 * --fg-dim treatment the PVBP table uses for an empty bucket, so "no number
 * here" reads identically across the Home tab. */
function UnknownCell({ tooltip }: { tooltip: string }) {
  return (
    <Tooltip content={tooltip} compact placement="top">
      <span
        style={{
          display: "block",
          textAlign: "right",
          fontFamily: "var(--font-mono)",
          fontVariantNumeric: "tabular-nums",
          color: "var(--fg-dim)",
          fontSize: 12,
          cursor: "help",
        }}
      >
        —
      </span>
    </Tooltip>
  );
}

/** Per-source freshness ribbon. Replaces a single "market open" flag, which
 * couldn't be honest here: the sources have different coverage, so a blank MtM
 * cell needs to say WHICH feed is behind and as of when. */
function QuoteSourceRibbon({ asOf, sources }: { asOf: string; sources: QuoteSource[] }) {
  return (
    <span className="text-label text-fg-muted whitespace-nowrap">
      {sources.map((s, i) => (
        <span key={s.source}>
          {i > 0 && <span className="text-fg-dim"> · </span>}
          <span style={{ color: s.has_as_of ? "var(--fg-muted)" : "var(--fg-dim)" }}>
            {s.source} {s.latest ?? "—"}
            {!s.has_as_of && (
              <Tooltip
                content={`${s.source} has no ${asOf} data yet (latest ${s.latest ?? "none"}) — MtM for its instruments is unknown, not zero`}
                compact
                placement="bottom"
              >
                <span style={{ cursor: "help" }}> ⌛</span>
              </Tooltip>
            )}
          </span>
        </span>
      ))}
    </span>
  );
}

export function BookDailyPnlTable() {
  const {
    hasPositions,
    bookDailyPnl,
    bookDailyPnlLoading: isLoading,
    bookDailyPnlError: isError,
  } = usePortfolioAnalytics();
  const fundingSpreadBp = useSettingsStore((s) => s.fundingSpreadBp);

  const asOf = bookDailyPnl?.as_of;
  const sources = bookDailyPnl?.quote_sources ?? [];
  const rows = bookDailyPnl?.by_book ?? [];
  const anyPartial = rows.some((r) => !r.mtm_complete);
  const staleSources = sources.filter((s) => !s.has_as_of).map((s) => s.source);

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-h2 text-fg-primary">Daily P&amp;L by Book</span>
        <div className="flex items-baseline gap-2">
          {asOf && <span className="text-label text-fg-muted whitespace-nowrap">{asOf}</span>}
          {asOf && sources.length > 0 && <QuoteSourceRibbon asOf={asOf} sources={sources} />}
          <span className="text-label text-fg-muted whitespace-nowrap">
            Funding: BOK + {fundingSpreadBp}bp
          </span>
        </div>
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
              <col style={{ minWidth: 84 }} />
              <col style={{ minWidth: 84 }} />
              <col style={{ minWidth: 92 }} />
              <col style={{ minWidth: 84 }} />
            </colgroup>
            <thead>
              <tr className="border-b border-border-subtle">
                <th className="py-1.5 text-left text-label text-fg-muted font-bold uppercase">
                  Book
                </th>
                <th className="py-1.5 text-right text-label text-fg-muted font-bold uppercase">
                  Theta
                </th>
                <th className="py-1.5 text-right text-label text-fg-muted font-bold uppercase">
                  MtM
                </th>
                <th className="py-1.5 text-right text-label text-fg-primary font-bold uppercase">
                  Total
                </th>
                <th className="py-1.5 text-right text-label text-fg-muted font-bold uppercase">
                  Funding
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
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
                  <td className="py-1">
                    <KrwCell value={row.theta} />
                  </td>
                  <td className="py-1">
                    {row.mtm === null ? (
                      <UnknownCell
                        tooltip={`No ${asOf} quotes from ${staleSources.join(" / ")} — MtM is unknown, not zero`}
                      />
                    ) : (
                      <KrwCell value={row.mtm} />
                    )}
                  </td>
                  <td className="py-1">
                    {/* A partial Total is still worth showing -- theta is real
                        money and already known -- but it must not pass for a
                        finished ΔNPV. Marked with ‡ and dropped to the
                        secondary weight the components use. */}
                    <KrwCell
                      value={row.total}
                      emphasis={row.mtm_complete}
                      suffix={row.mtm_complete ? undefined : "‡"}
                      tooltip={
                        row.mtm_complete
                          ? undefined
                          : `Partial — excludes MtM from ${staleSources.join(" / ")}, which has no ${asOf} quotes yet.`
                      }
                    />
                  </td>
                  <td className="py-1">
                    <KrwCell value={row.funding} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {anyPartial && (
            /* Not "theta only" -- a source that HAS as_of data still contributes
               real MtM (e.g. Credit Matrix current while IRS lags), so the
               total is theta plus whatever MtM has landed. It's incomplete, not
               MtM-free, and the wording has to survive both cases. */
            <div className="pt-2 text-label text-fg-dim">
              ‡ Partial — excludes MtM from {staleSources.join(" / ")}, which has no {asOf} quotes
              yet.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
