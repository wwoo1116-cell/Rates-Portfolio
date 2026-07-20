"use client";

/**
 * Book-level daily P&L, decomposed as ΔNPV = MtM + Theta.
 * Backed by POST /api/portfolio/book-daily-pnl via use-portfolio-analytics.ts.
 * Columns: Book | Theta | MtM | Funding | Total
 *
 * Total is the emphasized figure and includes funding (owner ruling, F1):
 * Total = Theta + MtM + Funding, matching the waterfall's 토탈 definition
 * (which already includes 조달비용). The backend's `total` field remains
 * Theta + known-MtM (the ΔNPV identity is untouched); this table ADDS the
 * response's `funding` at display time. MtM/Theta/Funding are the components
 * and render secondary.
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
import { Fragment } from "react";
import { Spinner, Tooltip } from "@blueprintjs/core";
import { usePortfolioAnalytics } from "@/hooks/use-portfolio-analytics";
import { usePeriodPnl } from "@/hooks/use-period-pnl";
import { useMarketDataRange } from "@/hooks/use-api";
import { useHomeDateStore } from "@/stores/home-date-store";
import { useSettingsStore } from "@/stores/settings-store";
import { CloseDateControl } from "./close-date-control";
import { formatKrwCompact } from "./pnl-format";
import { Skeleton } from "@/components/ui/skeleton";
import type { DailyPnlFigures, PeriodPnlFigure, QuoteSource } from "@/lib/api-types";

/** HARDEN-1 — the class sub-rows under each book row. Display order and the
 * quote source each class prices off (for the class-specific blank tooltip). */
const CLASS_ROWS = [
  { key: "bond", label: "채권", source: "Credit Matrix" },
  { key: "swap", label: "스왑", source: "IRS" },
] as const;

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
  // S12: signed P&L carries the universal Jade/Berry pair (owner lockdown) —
  // the app-wide green/red sem tokens are retired for direction semantics.
  const color =
    value > 0
      ? "var(--chart-pnl-pos)"
      : value < 0
        ? "var(--chart-pnl-neg)"
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
    // `fill` is load-bearing (s16): without it Blueprint wraps the cell in a
    // shrink-to-fit inline-block target, which parks the value at the td's
    // LEFT edge and defeats the block span's right alignment — in the partial
    // state the whole row then reads as shifted one column left.
    <Tooltip content={tooltip} compact placement="top" fill>
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
    // Same `fill` as KrwCell's tooltip branch — see the comment there (s16).
    <Tooltip content={tooltip} compact placement="top" fill>
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

/** One WTD/MTD/YTD figure on the period-comparison ribbon.
 *
 * Same honesty rules as the table below: a null PnL renders an em-dash (the
 * baseline is outside the data range, or nothing was priceable at both dates
 * -- "unknown", which 0 would misstate as "revalued, didn't move"), and a
 * partial figure (unpriceable bonds excluded) carries the same ‡ the partial
 * Totals use. Every figure names its resolved baseline date: "vs last Friday"
 * is meaningless on a screen where holidays shift what Friday means. */
function PeriodPnlStat({ label, figure }: { label: string; figure: PeriodPnlFigure }) {
  const value = figure.pnl;
  const color =
    value === null || value === 0
      ? "var(--fg-dim)"
      : value > 0
        ? "var(--chart-pnl-pos)"
        : "var(--chart-pnl-neg)";
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-micro uppercase text-fg-dim">{label}</span>
      {value === null ? (
        <Tooltip
          content={
            figure.baseline_date
              ? `${figure.baseline_date} 기준 재평가 가능한 종목이 없습니다 — 0이 아니라 미확정입니다`
              : "기준일이 보유 시장데이터 범위 밖입니다 — 0이 아니라 미확정입니다"
          }
          compact
          placement="bottom"
        >
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontVariantNumeric: "tabular-nums",
              fontSize: 12,
              color: "var(--fg-dim)",
              cursor: "help",
            }}
          >
            —
          </span>
        </Tooltip>
      ) : (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontVariantNumeric: "tabular-nums",
            fontSize: 12,
            fontWeight: 600,
            color,
          }}
        >
          {value > 0 ? "+" : ""}
          {formatKrwCompact(value)}
          {!figure.complete && <span style={{ color: "var(--fg-dim)" }}>‡</span>}
        </span>
      )}
      <span className="text-micro text-fg-dim">
        {figure.baseline_date ? `vs ${figure.baseline_date}` : "기준일 없음"}
      </span>
    </div>
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
    dailyPnlCloseDate,
  } = usePortfolioAnalytics();
  const { periodPnl, periodPnlLoading, periodPnlError } = usePeriodPnl();
  const fundingSpreadBp = useSettingsStore((s) => s.fundingSpreadBp);
  const { data: range } = useMarketDataRange();
  // The raw pick behind the resolved close (null = automatic/latest); the
  // extracted CloseDateControl needs both — see close-date-control.tsx.
  const pickedCloseDate = useHomeDateStore((s) => s.dailyPnlCloseDate);
  const setPickedCloseDate = useHomeDateStore((s) => s.setDailyPnlCloseDate);

  // T2b: a past view is "the resolved close is not the latest one". Drives
  // the period-ribbon suppression below.
  const viewingPast = Boolean(
    dailyPnlCloseDate && range?.max_date && dailyPnlCloseDate !== range.max_date,
  );

  const asOf = bookDailyPnl?.as_of;
  const sources = bookDailyPnl?.quote_sources ?? [];
  const rows = bookDailyPnl?.by_book ?? [];
  const anyPartial = rows.some((r) => !r.mtm_complete);
  const staleSources = sources.filter((s) => !s.has_as_of).map((s) => s.source);

  // The ribbon shows the portfolio-level row; the response also carries
  // per-book rows for a future drill-in.
  const periodTotal = periodPnl?.rows.find((r) => r.book === "Total");

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      {/* flex-wrap (T2b): the date control widened the right cluster past what
          narrow dockview widths can fit on one line — without wrap the title
          gets crushed into a vertical word stack. Wrapping drops the whole
          control cluster under the title instead. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="text-h2 text-fg-primary whitespace-nowrap">Daily P&amp;L by Book</span>
        <div className="flex flex-wrap items-center gap-2">
          {/* T2b — which close to price off; the label to its right stays the
              backend's as_of (T), so past picks label themselves honestly. */}
          {hasPositions && dailyPnlCloseDate && (
            <CloseDateControl
              closeDate={dailyPnlCloseDate}
              picked={pickedCloseDate}
              onPick={setPickedCloseDate}
            />
          )}
          {asOf && <span className="text-label text-fg-muted whitespace-nowrap">{asOf}</span>}
          {asOf && sources.length > 0 && <QuoteSourceRibbon asOf={asOf} sources={sources} />}
          <span className="text-label text-fg-muted whitespace-nowrap">
            Funding: BOK + {fundingSpreadBp}bp
          </span>
        </div>
      </div>

      {/* Period comparison ribbon (WTD/MTD/YTD vs prior week/month/year-end
          close). Sits INSIDE this panel, above the daily table -- summary
          first, decomposition below; no new card. Absent entirely when no
          bonds are schedulable: Portfolio Overview already explains that
          data-quality state, and a ribbon of dashes would just repeat it.
          T2b: also absent on a past-date view -- /period-pnl takes no
          valuation date, its baselines are server-anchored to the CURRENT
          close, so under a historical header its figures would be mislabeled.
          The one-line note keeps the disappearance from reading as a bug. */}
      {viewingPast && (
        <div className="border-b border-border-subtle pb-3 text-label text-fg-dim">
          과거 시점 조회 중 — WTD/MTD/YTD 기간 손익은 최신 종가 기준이라 표시하지 않습니다.
        </div>
      )}
      {!viewingPast && hasPositions && (periodPnl || periodPnlLoading || periodPnlError) && (
        <div className="border-b border-border-subtle pb-3">
          {periodTotal ? (
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <PeriodPnlStat label="WTD" figure={periodTotal.wtd} />
              <PeriodPnlStat label="MTD" figure={periodTotal.mtd} />
              <PeriodPnlStat label="YTD" figure={periodTotal.ytd} />
            </div>
          ) : periodPnlLoading ? (
            <div className="flex gap-6">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-36" />
              ))}
            </div>
          ) : (
            <span className="text-label text-sem-danger">
              기간 손익을 불러오지 못했습니다.
            </span>
          )}
          {periodTotal && (
            /* Load-bearing caveat, same treatment as the allocation charts:
               without it these figures read as realized period P&L, which
               they are not -- there is no position history to realize from. */
            <p className="pt-1.5 text-micro text-fg-dim">
              기간 손익은 실현 손익이 아니라 <span className="text-fg-muted">현재 보유
              채권을 각 기준일 시장데이터로 재평가</span>한 값입니다. 기준일 당시 미발행
              종목은 제외됩니다.
            </p>
          )}
        </div>
      )}

      {!hasPositions ? (
        <div className="flex flex-1 items-center justify-center text-center text-body text-fg-muted">
          Upload portfolio data to view daily P&amp;L.
        </div>
      ) : isLoading && !bookDailyPnl ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-body text-fg-muted">
          <Spinner size={16} /> Computing…
        </div>
      ) : isError ? (
        <div className="flex flex-1 items-center justify-center text-body text-sem-danger">
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
              <col style={{ minWidth: 84 }} />
              <col style={{ minWidth: 92 }} />
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
                <th className="py-1.5 text-right text-label text-fg-muted font-bold uppercase">
                  Funding
                </th>
                <th className="py-1.5 text-right text-label text-fg-primary font-bold uppercase">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Fragment key={row.book}>
                  <tr
                    className="border-t border-border-subtle"
                    style={
                      row.book === "Total"
                        ? { borderTop: "1px solid var(--border-dim)", fontWeight: 700 }
                        : {}
                    }
                  >
                    {/* Numeric tds carry text-right themselves (s16): alignment
                        is the COLUMN's property, never the value's — a
                        shrink-wrapped child (e.g. a tooltip target) must still
                        land at the right edge of its own column. */}
                    <td className="py-1.5 text-label text-fg-muted truncate">{row.book}</td>
                    <td className="py-1 text-right">
                      <KrwCell value={row.theta} />
                    </td>
                    <td className="py-1 text-right">
                      {row.mtm === null ? (
                        <UnknownCell
                          tooltip={`No ${asOf} quotes from ${staleSources.join(" / ")} — MtM is unknown, not zero`}
                        />
                      ) : (
                        <KrwCell value={row.mtm} />
                      )}
                    </td>
                    <td className="py-1 text-right">
                      <KrwCell value={row.funding} />
                    </td>
                    <td className="py-1 text-right">
                      {/* F1 (owner ruling): Total = Theta + MtM + Funding. The
                          backend's `total` is Theta + known-MtM; funding is
                          added HERE, display-side — presentation arithmetic,
                          not engine math. A partial Total is still worth
                          showing -- theta and funding are real money and
                          already known -- but it must not pass for a finished
                          figure. Marked with ‡ and dropped to the secondary
                          weight the components use. */}
                      <KrwCell
                        value={row.total + row.funding}
                        emphasis={row.mtm_complete}
                        suffix={row.mtm_complete ? undefined : "‡"}
                        tooltip={
                          row.mtm_complete
                            ? undefined
                            : `Partial — excludes MtM from ${staleSources.join(" / ")}, which has no ${asOf} quotes yet.`
                        }
                      />
                    </td>
                  </tr>

                  {/* HARDEN-1 (owner feedback) — 채권/스왑 sub-rows: the same
                      legs the book row sums, re-grouped by asset class. Only
                      classes the book actually holds appear (an absent class
                      is no row, not a zero row). The Total row keeps its
                      portfolio-level split too. Blank policy is per class:
                      a class whose source is stale shows — and its partial
                      class total carries the same ‡. */}
                  {CLASS_ROWS.map(({ key, label, source }) => {
                    const cls: DailyPnlFigures | undefined = row.by_class?.[key];
                    if (!cls) return null;
                    return (
                      <tr key={`${row.book}:${key}`}>
                        <td className="py-0.5 pl-4 text-label text-fg-dim truncate">{label}</td>
                        {/* s16 mechanism inherited verbatim: numeric tds carry
                            text-right; tooltip targets keep Blueprint `fill`
                            via KrwCell/UnknownCell. */}
                        <td className="py-0.5 text-right">
                          <KrwCell value={cls.theta} />
                        </td>
                        <td className="py-0.5 text-right">
                          {cls.mtm === null ? (
                            <UnknownCell
                              tooltip={`No ${asOf} quotes from ${source} — ${label} MtM is unknown, not zero`}
                            />
                          ) : (
                            <KrwCell value={cls.mtm} />
                          )}
                        </td>
                        <td className="py-0.5 text-right">
                          <KrwCell value={cls.funding} />
                        </td>
                        <td className="py-0.5 text-right">
                          {/* F1: each sub-row's Total includes its OWN funding
                              (채권 carries the book's funding attribution,
                              스왑 0) — so per column the sub-rows still sum
                              to the book row. */}
                          <KrwCell
                            value={cls.total + cls.funding}
                            suffix={cls.mtm_complete ? undefined : "‡"}
                            tooltip={
                              cls.mtm_complete
                                ? undefined
                                : `Partial — ${label} MtM from ${source} has no ${asOf} quotes yet.`
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
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
