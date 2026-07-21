"use client";

/**
 * RECON-DAILY range mode — the per-day residual strip, rendered only on the
 * Rates History mount (DailyReconPanel showRange). Lazy: nothing computes
 * until 계산 is pressed (each day costs the full single-date machinery —
 * see use-recon-range.ts), rows appear incrementally, and a missing figure
 * renders — with its reason, never a silent 0.
 */
import { useState } from "react";
import { Spinner } from "@blueprintjs/core";
import { useReconRange } from "@/hooks/use-recon-range";
import { RESIDUAL_LABEL } from "@/lib/daily-recon-math";
import { cn } from "@/lib/utils";
import { formatKrwCompact } from "./pnl-format";
import { ReconDeltaBpChart } from "./recon-deltabp-chart";

/** RECON2-RH — the two views over one computed row set: the 잔차 table
 * (default, pre-existing) and the M2 Δbp time series. One 계산 run feeds
 * both; toggling never refetches. */
const STRIP_VIEWS = ["table", "chart"] as const;
type StripView = (typeof STRIP_VIEWS)[number];
const STRIP_VIEW_LABELS: Record<StripView, string> = {
  table: "잔차 표",
  chart: "Δbp 시계열",
};

function SignedCell({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <span
        style={{
          display: "block",
          textAlign: "right",
          fontFamily: "var(--font-mono)",
          fontVariantNumeric: "tabular-nums",
          fontSize: 12,
          color: "var(--fg-dim)",
        }}
      >
        —
      </span>
    );
  }
  const color =
    value > 0 ? "var(--chart-pnl-pos)" : value < 0 ? "var(--chart-pnl-neg)" : "var(--fg-dim)";
  return (
    <span
      style={{
        display: "block",
        textAlign: "right",
        fontFamily: "var(--font-mono)",
        fontVariantNumeric: "tabular-nums",
        fontSize: 12,
        color,
      }}
    >
      {value > 0 ? "+" : ""}
      {formatKrwCompact(value)}
    </span>
  );
}

export function ReconRangeStrip() {
  const { rows, running, progress, error, windowSize, maxWindow, canRun, run, widen } =
    useReconRange();
  const [view, setView] = useState<StripView>("table");

  return (
    <div className="flex flex-col gap-1.5 border-t border-border-subtle pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-label font-bold uppercase text-fg-muted">
          {view === "table"
            ? `${RESIDUAL_LABEL} 시계열 (일별 Assumed vs Realized)`
            : "M2 Δbp 시계열 (일별 테너별 금리 변동)"}
        </span>
        <div className="flex items-center gap-2">
          <div role="group" aria-label="범위 보기" className="flex border border-border-subtle">
            {STRIP_VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={cn(
                  "px-2 py-0.5 text-micro",
                  view === v
                    ? "bg-sem-info-ghost text-sem-info shadow-[inset_0_0_0_1px_var(--sem-info)]"
                    : "text-fg-muted",
                )}
              >
                {STRIP_VIEW_LABELS[v]}
              </button>
            ))}
          </div>
          {running && progress && (
            <span className="flex items-center gap-1.5 text-label text-fg-muted">
              <Spinner size={12} /> {progress.done}/{progress.total}일
            </span>
          )}
          {rows && !running && windowSize < maxWindow && (
            <button
              type="button"
              onClick={widen}
              className="border border-border-dim px-2 py-0.5 text-micro text-fg-muted transition-colors hover:bg-bg-tertiary"
            >
              +20일 확장
            </button>
          )}
          <button
            type="button"
            onClick={run}
            disabled={!canRun || running}
            className="border border-sem-info bg-sem-info-ghost px-2 py-0.5 text-micro text-sem-info transition-colors hover:bg-sem-info-soft disabled:opacity-50"
          >
            {rows ? "재계산" : "계산"}
          </button>
        </div>
      </div>

      {error && <span className="text-label text-sem-danger">계산 실패: {error}</span>}

      {!rows && !running && (
        <span className="text-label text-fg-dim">
          지연 계산 — 계산을 누르면 최근 {windowSize}영업일의 일별 {RESIDUAL_LABEL}를
          산출합니다. 일자마다 전체 재평가가 돌므로 수 분이 걸릴 수 있습니다 (캐시 없음).
        </span>
      )}

      {rows && view === "chart" && <ReconDeltaBpChart rows={rows} />}

      {rows && view === "table" && (
        <div className="overflow-x-auto">
          <table
            className="w-full border-collapse text-body"
            style={{ tableLayout: "fixed", fontSize: 12, minWidth: 560 }}
          >
            <colgroup>
              <col style={{ width: 100 }} />
              <col style={{ minWidth: 92 }} />
              <col style={{ minWidth: 92 }} />
              <col style={{ minWidth: 92 }} />
              <col style={{ minWidth: 64 }} />
              <col />
            </colgroup>
            <thead>
              <tr className="border-b border-border-subtle">
                <th className="py-1.5 text-left text-label text-fg-muted font-bold uppercase">
                  평가일 (D)
                </th>
                <th className="py-1.5 text-right text-label text-fg-muted font-bold uppercase">
                  Assumed
                </th>
                <th className="py-1.5 text-right text-label text-fg-muted font-bold uppercase">
                  Realized
                </th>
                <th className="py-1.5 text-right text-label text-fg-primary font-bold uppercase">
                  {RESIDUAL_LABEL}
                </th>
                <th className="py-1.5 text-right text-label text-fg-muted font-bold uppercase">
                  %
                </th>
                <th className="py-1.5 text-left text-label text-fg-muted font-bold uppercase">
                  비고
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.asOf} className="border-t border-border-subtle">
                  <td className="py-1 text-label text-fg-muted font-mono tabular-nums">{r.asOf}</td>
                  <td className="py-1 text-right">
                    <SignedCell value={r.assumed} />
                  </td>
                  <td className="py-1 text-right">
                    <SignedCell value={r.realized} />
                  </td>
                  <td className="py-1 text-right">
                    <SignedCell value={r.residual} />
                  </td>
                  <td className="py-1 text-right">
                    <span
                      style={{
                        display: "block",
                        textAlign: "right",
                        fontFamily: "var(--font-mono)",
                        fontVariantNumeric: "tabular-nums",
                        fontSize: 12,
                        color: "var(--fg-dim)",
                      }}
                    >
                      {r.residualPct === null
                        ? "—"
                        : `${r.residualPct > 0 ? "+" : ""}${r.residualPct.toFixed(1)}%`}
                    </span>
                  </td>
                  <td className="py-1 text-label text-fg-dim truncate" title={r.note}>
                    {r.note ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
