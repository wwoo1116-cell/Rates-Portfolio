"use client";

/**
 * Results stage (s15 T3) — scenario summary chips (기간 · 목표 변동 · σ ·
 * Funding · Carry) + a 조건 수정 button returning to Configure with all inputs
 * preserved (the store is never reset on stage transitions); the fan chart as
 * the full-width hero with the funding strip (DistributionChartPanel); and the
 * Total Return summary card below.
 *
 * Blank-MtM policy (s15 T2): when the response carries a swap exclusion, the
 * card renders an explicit notice (the backend's reason verbatim) and the swap
 * lines show — (blank), never +0. KRW figures go through the mainline signed
 * 억/만 formatter (formatKrwAxisSigned) — no local formatting overrides.
 *
 * Re-run semantics (owner decision): a new run REPLACES this result outright —
 * no overlay comparison, no run history.
 */
import { Button } from "@/components/ui/button";
import { formatKrwAxisSigned } from "@/lib/format";

import { useSimulationPort } from "../../hooks/use-simulation";
import { DistributionChartPanel } from "../panels/distribution-chart-panel";

/** Marquee two-tone chip: uppercase label segment on bg-tertiary, mixed-case
 * value segment on bg-secondary — the fill pair IS the boundary (no border). */
function SummaryChip({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  return (
    <span className="inline-flex items-stretch text-micro">
      <span className="bg-bg-tertiary px-2 py-0.5 text-label uppercase text-fg-muted">{label}</span>
      <span
        data-num
        className={`bg-bg-secondary px-2 py-0.5 ${
          tone === "pos" ? "text-chart-pnl-pos" : tone === "neg" ? "text-chart-pnl-neg" : "text-fg-primary"
        }`}
      >
        {value}
      </span>
    </span>
  );
}

export function ResultsStage({ onEdit }: { onEdit: () => void }) {
  const { lastRun, lastRunRequest } = useSimulationPort();
  if (!lastRun) return null;

  const s = lastRun.summary;
  const decomp = lastRun.totalReturnDecomposition ?? null;
  const swapExclusion = (lastRun.exclusions ?? []).find((x) => x.assetClass === "swap") ?? null;
  const lastFunding = lastRun.fundingCurve?.at(-1) ?? null;

  const chips: { label: string; value: string; tone?: "pos" | "neg" }[] = [];
  if (lastRunRequest) {
    chips.push({ label: "기간", value: `D+${lastRunRequest.simDays}` });
    chips.push({
      label: "목표 변동",
      value: `${lastRunRequest.baseShockBp >= 0 ? "+" : ""}${lastRunRequest.baseShockBp}bp`,
    });
    if (lastRunRequest.sigma_bp !== undefined) {
      chips.push({ label: "σ", value: `${lastRunRequest.sigma_bp.toFixed(1)}bp/√일` });
    }
  }
  if (lastFunding) {
    chips.push({ label: "Funding", value: `${(lastFunding.fundingRate * 100).toFixed(2)}%` });
    if (lastFunding.carryBp !== null) {
      chips.push({
        label: "Carry",
        value: `${lastFunding.carryBp >= 0 ? "+" : ""}${lastFunding.carryBp.toFixed(1)}bp`,
        tone: lastFunding.carryBp >= 0 ? "pos" : "neg",
      });
    }
  }

  // Total Return card lines. With the s15 decomposition present the funding
  // cost is split out of bond carry; older cached responses fall back to the
  // 3-line summary. Excluded swaps render blank (—), never +0.
  const money = (v: number) => formatKrwAxisSigned(v);
  const rows: { label: string; text: string; tone: "pos" | "neg" | "dim"; strong?: boolean }[] = [];
  const push = (label: string, v: number | null, strong = false, blankNote?: string) => {
    if (v === null) {
      rows.push({ label: blankNote ? `${label} (${blankNote})` : label, text: "—", tone: "dim", strong });
    } else {
      rows.push({ label, text: money(v), tone: v >= 0 ? "pos" : "neg", strong });
    }
  };
  if (decomp) {
    push("채권 MTM", decomp.bondMtm);
    push("채권 캐리 (조달 차감 전)", decomp.bondCarry);
    push("조달 비용", decomp.fundingCost);
    push("스왑 MTM", decomp.swapMtm, false, swapExclusion ? "제외" : undefined);
    push("스왑 캐리", decomp.swapCarry, false, swapExclusion ? "제외" : undefined);
    push("Total Return", decomp.total, true);
  } else {
    push("채권 MTM", s.finalMTM);
    push("채권 캐리", s.finalCarry);
    push("스왑손익", swapExclusion ? null : s.finalSwap, false, swapExclusion ? "제외" : undefined);
    push("Total Return", s.finalTotal, true);
  }

  return (
    <div className="flex h-full w-full flex-col gap-3 overflow-y-auto p-4">
      {/* ── Header: scenario chips + 조건 수정 ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <SummaryChip key={c.label} label={c.label} value={c.value} tone={c.tone} />
          ))}
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={onEdit}>
          조건 수정
        </Button>
      </div>

      {/* ── Hero: percentile fan + funding strip ── */}
      <div className="min-h-[360px] flex-1 bg-bg-secondary">
        <DistributionChartPanel />
      </div>

      {/* ── Total Return summary card ── */}
      <div className="bg-bg-secondary p-4">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-h2 text-fg-primary">Total Return 요약</h2>
          {swapExclusion && (
            <span className="bg-sem-risk-soft px-2 py-0.5 text-micro text-sem-risk">
              스왑 제외 — {swapExclusion.reason} ({swapExclusion.asOf})
            </span>
          )}
        </div>
        <table data-num className="w-full text-body">
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-border-dim">
                <td className="py-1.5 text-fg-muted">{r.label}</td>
                <td
                  className={`py-1.5 text-right ${r.strong ? "text-body-strong" : ""} ${
                    r.tone === "pos" ? "text-chart-pnl-pos" : r.tone === "neg" ? "text-chart-pnl-neg" : "text-fg-dim"
                  }`}
                >
                  {r.text}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {s.breakEvenDay > 0 && (
          <p className="mt-2 text-micro text-chart-pnl-pos" data-num>손익분기점 도달: D+{s.breakEvenDay}</p>
        )}
      </div>
    </div>
  );
}
