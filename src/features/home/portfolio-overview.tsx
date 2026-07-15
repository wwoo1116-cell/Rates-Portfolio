"use client";

/**
 * Home's Portfolio Overview panel: RP Fund's headline KPIs on a single-line
 * data ribbon, with sector-risk and maturity allocation charted side by side
 * beneath it. Replaces the old Status + Book Summary panels.
 *
 * Two data sources, deliberately independent so neither blocks the other:
 *   - ribbon: POST /api/portfolio/book-summary (current only) via
 *     use-portfolio-analytics.ts
 *   - charts: POST /api/portfolio/allocation-history (five snapshots) via
 *     use-allocation-history.ts
 *
 * The charts' past columns revalue TODAY's holdings against past market data --
 * this deployment has no position history (see allocation_history_service.py).
 * The caveat line under the charts is load-bearing, not decoration: without it
 * the panel implies a historical record that does not exist.
 */
import { useMemo } from "react";
import { BOND_SECTORS } from "@/lib/constants";
import { RV_SERIES_COLORS } from "@/lib/chart-colors";
import { formatDuration, formatKrwCompact } from "@/lib/format";
import { usePortfolioAnalytics } from "@/hooks/use-portfolio-analytics";
import { useAllocationHistory } from "@/hooks/use-allocation-history";
import { Skeleton } from "@/components/ui/skeleton";
import { StackedBar100, type StackedBar100Column } from "@/components/charts/stacked-bar-100";
import type { AllocationSeries } from "@/lib/api-types";

const BOOK = "RP Fund";

/** Stable, distinct hue per series.
 *
 * Indexed off the canonical BOND_SECTORS list rather than the response's own
 * (share-ordered) key order, so a sector keeps its colour even when it moves up
 * or down the stack between refetches. colorForId() would also be stable but
 * hashes into the palette, so two of the eight sectors can collide onto one hue
 * -- fatal for adjacent segments of a stack. Anything off the canonical list
 * (maturity buckets, an unexpected sector) falls back to appended order. */
function makeColorFor(canonical: readonly string[], keys: string[]) {
  return (key: string) => {
    const i = canonical.indexOf(key);
    const idx = i >= 0 ? i : canonical.length + keys.indexOf(key);
    return RV_SERIES_COLORS[idx % RV_SERIES_COLORS.length];
  };
}

function toColumns(series: AllocationSeries): StackedBar100Column[] {
  return series.rows.map((row) => ({
    key: row.key,
    label: row.label,
    sublabel: row.valuationDate,
    empty: row.valuationDate === null,
    values: Object.fromEntries(
      series.keys.map((k) => [k, typeof row[k] === "number" ? (row[k] as number) : 0]),
    ),
  }));
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-micro uppercase text-fg-dim">{label}</span>
      <span className="text-body-strong tabular-nums text-fg-primary">{value}</span>
    </div>
  );
}

function Chart({
  title,
  basis,
  series,
  canonical,
}: {
  title: string;
  basis: string;
  series: AllocationSeries;
  canonical: readonly string[];
}) {
  const columns = useMemo(() => toColumns(series), [series]);
  const colorFor = useMemo(
    () => makeColorFor(canonical, series.keys),
    [canonical, series.keys],
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-label text-fg-primary">{title}</span>
        <span className="text-micro text-fg-dim">{basis}</span>
      </div>
      <div className="min-h-0 flex-1">
        <StackedBar100 columns={columns} seriesKeys={series.keys} colorFor={colorFor} />
      </div>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex gap-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-28" />
        ))}
      </div>
      <div className="flex min-h-0 flex-1 gap-4">
        <Skeleton className="min-h-0 flex-1" />
        <Skeleton className="min-h-0 flex-1" />
      </div>
    </div>
  );
}

/** The "positions exist but the charts can't" states. Rendered INSTEAD of the
 * charts, never instead of the ribbon -- the ribbon's data source is tolerant
 * of missing dates and stays correct.
 *
 * Same centered-text vocabulary as the panel's other empty/error states (no
 * card, no new pattern); the cause and the remedy are spelled out because this
 * exact condition -- all bonds missing issue/maturity dates, query silently
 * disabled -- hid the charts for weeks while reading as a rendering bug
 * (DIAGNOSIS_REPORT.md S3). */
function AllocationUnavailable({ bondCount }: { bondCount: number }) {
  if (bondCount === 0) {
    // An IRS-only book: nothing to chart, and re-running the upload would not
    // change that -- so no remedy line, just the reason.
    return (
      <div className="flex flex-1 items-center justify-center text-center text-body text-fg-muted">
        표시할 채권 포지션이 없습니다 — 배분 차트는 채권 전용입니다.
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
      <span className="text-body-strong text-fg-primary">배분 차트를 표시할 수 없습니다</span>
      <span className="text-body text-fg-muted">
        채권 {bondCount}종목 모두 발행일·만기일이 비어 있어 과거 시점 재평가가 불가능합니다.
      </span>
      <span className="text-micro text-fg-dim">
        Upload 탭에서 Process Files를 다시 실행하면 날짜가 채워집니다.
      </span>
    </div>
  );
}

export function PortfolioOverview() {
  const { hasPositions, closeDate, bookSummary, bookSummaryLoading, bookSummaryError } =
    usePortfolioAnalytics();
  const { allocation, allocationLoading, allocationError, bondCount, schedulableCount } =
    useAllocationHistory(BOOK);

  const book = useMemo(
    () => (bookSummary ?? []).find((b: { book: string }) => b.book === BOOK),
    [bookSummary],
  );

  const isLoading = bookSummaryLoading || allocationLoading;
  const isError = bookSummaryError || allocationError;

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <span className="text-h2 text-fg-primary">Portfolio Overview</span>
        <span className="text-label text-fg-muted">
          {/* Close-based, like PVBP. Daily P&L next door shows T (= next
              business day), so every panel states which date it prices off. */}
          {closeDate ? `${closeDate} close · ` : ""}
          {BOOK}
        </span>
      </div>

      {!hasPositions ? (
        <div className="flex flex-1 items-center justify-center text-center text-body text-fg-muted">
          Upload portfolio data to view the portfolio overview.
        </div>
      ) : isLoading && !allocation ? (
        <OverviewSkeleton />
      ) : isError ? (
        <div className="flex flex-1 items-center justify-center text-body text-sem-negative">
          Failed to load portfolio overview.
        </div>
      ) : (
        <>
          {/* Data ribbon -- one line, no cards */}
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-border-subtle pb-3">
            <Stat label="평가금액" value={formatKrwCompact(book?.totalEvaluationAmount ?? 0)} />
            <Stat label="액면금액" value={formatKrwCompact(book?.totalNotional ?? 0)} />
            <Stat label="평균 YTM" value={`${(book?.weightedAvgYTM ?? 0).toFixed(3)}%`} />
            <Stat label="헷지 듀레이션" value={formatDuration(book?.hedgedDuration ?? 0)} />
          </div>

          {allocation ? (
            <>
              <div className="flex min-h-0 flex-1 gap-4">
                <Chart
                  title="섹터 배분"
                  basis="PVBP 기준"
                  series={allocation.sector}
                  canonical={BOND_SECTORS}
                />
                <div className="w-px shrink-0 bg-border-subtle" />
                <Chart
                  title="만기 배분"
                  basis="평가금액 기준"
                  series={allocation.maturity}
                  canonical={MATURITY_ORDER}
                />
              </div>

              <p className="text-micro text-fg-dim">
                과거 시점은 보유 이력이 아니라 <span className="text-fg-muted">현재 보유 종목을 해당
                일자 시장데이터로 재평가</span>한 값입니다. 당시 미발행 종목은 제외됩니다.
              </p>
            </>
          ) : schedulableCount === 0 ? (
            // No allocation data AND no query in flight: the query was never
            // enabled. Positions exist (we're past the !hasPositions branch),
            // so this is either an IRS-only book or a bond blotter with empty
            // dates -- say which, out loud, instead of ending the panel after
            // the ribbon as if the charts had never existed.
            <AllocationUnavailable bondCount={bondCount} />
          ) : null}
        </>
      )}
    </div>
  );
}

/** Mirrors allocation_history_service.MATURITY_BUCKETS' order (short → long) so
 * the stack reads bottom-up by tenor rather than by size. */
const MATURITY_ORDER = ["단기(1년 미만)", "중기(1~3년)", "장기(3년 이상)"] as const;
