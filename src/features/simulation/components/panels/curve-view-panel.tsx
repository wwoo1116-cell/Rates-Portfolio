"use client";

/**
 * Curve View panel — demo-sprint two-pane preview (trader feedback): the LIVE
 * shocked INPUT-curve view. Draws the 국고채 par-yield curve and the IRS par
 * curve (base quotes for inputs.baseDate + the scenario's horizon-end shock)
 * as two lines on one tenor axis, redrawn synchronously on every left-pane
 * change — pure display math (lib/input-curve-preview), never an engine run.
 * Base quotes are fetched once per baseDate (hooks/use-input-curves) and
 * cached, so slider moves cost no network.
 *
 * Blank-quote policy: a missing pillar is a line gap + a "—" notice below,
 * never a silent +0; a missing snapshot renders the whole curve as absent
 * with an explicit notice.
 *
 * The previous time-path view (국채 3Y bp 경로) is no longer rendered here;
 * lib/scenario-preview.ts stays intact for revival (see DEMO_DEBT.md).
 */
import { useMemo } from "react";

import { getSimulationChartTheme } from "../../lib/chart-theme";
import { buildInputCurvePreview } from "../../lib/input-curve-preview";
import { useBondInputQuotes, useSwapInputQuotes } from "../../hooks/use-input-curves";
import { useSimulationPort } from "../../hooks/use-simulation";
import { TermStructureChart, type TermCurveDef } from "../charts/term-structure-chart";

export function CurveViewPanel() {
  const { params, inputs } = useSimulationPort();
  const baseDate = inputs.baseDate;

  const bond = useBondInputQuotes(baseDate);
  const swap = useSwapInputQuotes(baseDate);

  const bondBase = useMemo(() => (bond.isError ? [] : bond.data ?? []), [bond.data, bond.isError]);
  const swapBase = useMemo(() => (swap.isError ? [] : swap.data ?? []), [swap.data, swap.isError]);

  const preview = useMemo(
    () => buildInputCurvePreview(params, baseDate, bondBase, swapBase),
    [params, baseDate, bondBase, swapBase],
  );

  const t = getSimulationChartTheme();
  const bondColor = t.previewPalette[0]; // Ocean — rates curves never wear P&L hues (S7).
  const swapColor = t.previewPalette[2]; // Tangerine — distinct from Ocean at a glance.

  const curves: TermCurveDef[] = [
    { label: "국고채", color: bondColor, points: preview.bondPct },
    { label: "IRS", color: swapColor, points: preview.swapPct },
  ];

  // A pillar the other curve contributed (e.g. IRS has no 20Y) is a normal
  // gap, not a hole — the notice lists only tenors the source itself carries
  // with no value on this date.
  const bondMissing = bondBase.filter((q) => q.rate === null).map((q) => q.label);
  const swapMissing = swapBase.filter((q) => q.rate === null).map((q) => q.label);

  const loading = bond.isLoading || swap.isLoading;

  return (
    <div className="flex h-full w-full flex-col p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-body-strong text-fg-primary">인풋 커브 미리보기</h3>
        <span data-num className="text-micro text-fg-muted">
          {baseDate || "기준일 —"} · D+{params.simDays} {toSigned(params.baseShockBp)}bp
        </span>
      </div>

      <div className="min-h-0 flex-1">
        {loading ? (
          <div className="flex h-full items-center justify-center text-micro text-fg-dim">호가 로딩 중…</div>
        ) : (
          <TermStructureChart pillarLabels={preview.pillars.map((p) => p.label)} curves={curves} />
        )}
      </div>

      {/* Legend + blank-policy notices */}
      <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-micro">
        <span className="inline-flex items-center gap-1.5 text-fg-muted">
          <span className="inline-block h-0.5 w-4" style={{ backgroundColor: bondColor }} />
          국고채
          {bond.isError && <span className="text-fg-dim">호가 없음 —</span>}
        </span>
        <span className="inline-flex items-center gap-1.5 text-fg-muted">
          <span className="inline-block h-0.5 w-4" style={{ backgroundColor: swapColor }} />
          IRS
          {swap.isError && <span className="text-fg-dim">호가 없음 —</span>}
        </span>
        {preview.shortEndBp !== 0 && (
          <span data-num className="text-fg-dim">
            단기 {toSigned(String(preview.shortEndBp))}bp (금통위)
          </span>
        )}
      </div>
      {(bondMissing.length > 0 || swapMissing.length > 0) && (
        <p data-num className="mt-0.5 text-center text-micro text-fg-dim">
          결측 호가:
          {bondMissing.length > 0 && ` 국고채 ${bondMissing.join("/")} —`}
          {swapMissing.length > 0 && ` IRS ${swapMissing.join("/")} —`}
        </p>
      )}
    </div>
  );
}

/** "+30" / "-25" / "0" from the free-text bp param. */
function toSigned(raw: string): string {
  const v = parseFloat(raw);
  if (isNaN(v)) return "0";
  return v > 0 ? `+${raw.trim()}` : raw.trim();
}
