"use client";

/**
 * Book summary card grid: one card per book showing total notional,
 * evaluation amount, weighted YTM, hedged duration, sector allocation,
 * and maturity allocation.
 * Backed by POST /api/portfolio/book-summary via use-portfolio-analytics.ts.
 */
import { Spinner } from "@blueprintjs/core";
import { usePortfolioAnalytics } from "@/hooks/use-portfolio-analytics";

function PctBar({ label, pct }: { label: string; pct: number }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 10,
          color: "var(--fg-muted)",
          marginBottom: 2,
        }}
      >
        <span>{label}</span>
        <span>{pct.toFixed(1)}%</span>
      </div>
      <div
        style={{
          height: 4,
          background: "var(--bg-tint)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.min(pct, 100)}%`,
            background: "var(--accent)",
            borderRadius: 2,
          }}
        />
      </div>
    </div>
  );
}

function BookCard({ book }: { book: any }) {
  const evalAmt = book.totalEvaluationAmount ?? 0;
  const notional = book.totalNotional ?? 0;
  const ytm = book.weightedAvgYTM ?? 0;
  const dur = book.hedgedDuration ?? 0;

  const sectorEntries = Object.entries(book.sectorAllocation ?? {}).sort(
    ([, a], [, b]) => (b as number) - (a as number),
  );
  const maturityEntries = Object.entries(book.maturityAllocation ?? {});

  function fmtKrw(v: number) {
    if (Math.abs(v) >= 1e12) return `${(v / 1e12).toFixed(2)}조`;
    if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(1)}억`;
    return v.toLocaleString();
  }

  return (
    <div
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 4,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minWidth: 220,
      }}
    >
      {/* Header */}
      <div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "var(--fg-primary)",
            marginBottom: 6,
          }}
        >
          {book.book}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "4px 12px",
          }}
        >
          {[
            ["평가금액", fmtKrw(evalAmt)],
            ["액면금액", fmtKrw(notional)],
            ["평균 YTM", `${ytm.toFixed(3)}%`],
            ["헷지 듀레이션", dur.toFixed(2)],
          ].map(([label, val]) => (
            <div key={label}>
              <div style={{ fontSize: 9, color: "var(--fg-dim)", textTransform: "uppercase" }}>
                {label}
              </div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--fg-primary)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {val}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sector allocation */}
      {sectorEntries.length > 0 && (
        <div>
          <div
            style={{
              fontSize: 9,
              color: "var(--fg-dim)",
              textTransform: "uppercase",
              marginBottom: 4,
            }}
          >
            섹터 배분
          </div>
          {sectorEntries.slice(0, 4).map(([sector, pct]) => (
            <PctBar key={sector} label={sector} pct={pct as number} />
          ))}
        </div>
      )}

      {/* Maturity allocation */}
      {maturityEntries.length > 0 && (
        <div>
          <div
            style={{
              fontSize: 9,
              color: "var(--fg-dim)",
              textTransform: "uppercase",
              marginBottom: 4,
            }}
          >
            만기 배분
          </div>
          {maturityEntries.map(([bucket, pct]) => (
            <PctBar key={bucket} label={bucket} pct={pct as number} />
          ))}
        </div>
      )}
    </div>
  );
}

export function BookSummaryCard() {
  const { hasPositions, bookSummary, isLoading, isError } = usePortfolioAnalytics();

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <span className="text-h2 text-fg-primary">Book Summary</span>
        <span className="text-label text-fg-muted">Per-book breakdown</span>
      </div>

      {!hasPositions ? (
        <div className="flex flex-1 items-center justify-center text-center text-body text-fg-muted">
          Upload portfolio data to view book summary.
        </div>
      ) : isLoading && !bookSummary ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-body text-fg-muted">
          <Spinner size={16} /> Computing…
        </div>
      ) : isError ? (
        <div className="flex flex-1 items-center justify-center text-body text-sem-negative">
          Failed to load book summary.
        </div>
      ) : (
        <div
          className="flex-1 min-h-0 overflow-auto"
          style={{ display: "flex", flexWrap: "wrap", gap: 12, alignContent: "flex-start" }}
        >
          {(bookSummary ?? []).map((book: any) => (
            <BookCard key={book.book} book={book} />
          ))}
        </div>
      )}
    </div>
  );
}
