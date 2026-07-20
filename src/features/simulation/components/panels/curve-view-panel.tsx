"use client";

/**
 * Curve View panel — SIM2-1: two previews behind a 커브형/시계열형 toggle.
 *
 * 커브형 (default, demo-sprint two-pane view, byte-untouched logic): the LIVE
 * shocked INPUT-curve view. Draws the 국고채 par-yield curve and the IRS par
 * curve (base quotes for inputs.baseDate + the scenario's horizon-end shock)
 * as two lines on one tenor axis, redrawn synchronously on every left-pane
 * change — pure display math (lib/input-curve-preview), never an engine run.
 * Base quotes are fetched once per baseDate (hooks/use-input-curves) and
 * cached, so control moves cost no network.
 *
 * 시계열형 (SIM2-1 revival of the pre-demo time-path view): the designed 국채
 * 3Y bp path over the horizon from lib/scenario-preview.buildTimePath — the
 * SAME lerp the backend's _factor applies — rendered on the kept slice host
 * LwLineChart via dayToTime (real calendar slots, s15 rule), waypoint markers
 * on params.waypoints days, a dashed cumulative policy-rate series when 금통위
 * events exist, and a +X.Xbp axis. ZERO network, zero engine: the base-quote
 * hooks are disabled while this branch shows (they're 커브형-only inputs).
 *
 * View state: store key `previewMode` (UI-only — survives stage navigation,
 * never enters the payload; buildSimulateRequest is previewMode-blind).
 *
 * Blank-quote policy (커브형): a missing pillar is a line gap + a "—" notice
 * below, never a silent +0; a missing snapshot renders the whole curve as
 * absent with an explicit notice.
 */
import { useMemo } from "react";

import { getSimulationChartTheme } from "../../lib/chart-theme";
import { buildInputCurvePreview } from "../../lib/input-curve-preview";
import { buildTimePath } from "../../lib/scenario-preview";
import { useBondInputQuotes, useSwapInputQuotes } from "../../hooks/use-input-curves";
import { useSimulationPort } from "../../hooks/use-simulation";
import { useSimulationDataStore } from "../../store/simulation-data-store";
import { SegmentedButtons } from "../segmented-buttons";
import { TermStructureChart, type TermCurveDef } from "../charts/term-structure-chart";
import { LwLineChart, dayToTime, type LwMarker, type LwSeriesDef } from "../charts/lw-line-chart";

const PREVIEW_MODES = ["curve", "path"] as const;
const PREVIEW_MODE_LABELS: Record<(typeof PREVIEW_MODES)[number], string> = {
  curve: "커브형",
  path: "시계열형",
};

/** "+12.5bp" axis/badge format for the path view (rate-fan formatBpAxis
 * pattern; applied to every series — z-order formatter rule). */
const formatBpAxis = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}bp`;

export function CurveViewPanel() {
  const { params, inputs } = useSimulationPort();
  const baseDate = inputs.baseDate;
  const previewMode = useSimulationDataStore((s) => s.previewMode);
  const setPreviewMode = useSimulationDataStore((s) => s.setPreviewMode);
  const isPath = previewMode === "path";

  // 커브형-only inputs — disabled on the path branch so 시계열형 is provably
  // network-free (SIM2-1 no-fetch pin). Cached per baseDate either way.
  const bond = useBondInputQuotes(baseDate, !isPath);
  const swap = useSwapInputQuotes(baseDate, !isPath);

  const bondBase = useMemo(() => (bond.isError ? [] : bond.data ?? []), [bond.data, bond.isError]);
  const swapBase = useMemo(() => (swap.isError ? [] : swap.data ?? []), [swap.data, swap.isError]);

  const preview = useMemo(
    () => buildInputCurvePreview(params, baseDate, bondBase, swapBase),
    [params, baseDate, bondBase, swapBase],
  );

  // ── 시계열형 series: pure client math (scenario-preview), no DOM/network ──
  const pathSeries = useMemo<LwSeriesDef[]>(() => {
    if (!isPath) return [];
    const t = getSimulationChartTheme();
    const points = buildTimePath(params, baseDate);
    const gov: LwSeriesDef = {
      // Ocean — a rates path must not wear a P&L hue (S7); same pin the
      // pre-demo view carried.
      color: t.previewPalette[0],
      lineWidth: 2,
      data: points.map((p) => ({ time: dayToTime(baseDate, p.day), value: p.gov3y })),
    };
    const defs: LwSeriesDef[] = [gov];
    if (points.some((p) => p.policyRate !== null)) {
      defs.push({
        color: t.axis,
        lineWidth: 2,
        dashed: true,
        data: points.map((p) => ({ time: dayToTime(baseDate, p.day), value: p.policyRate ?? 0 })),
      });
    }
    return defs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPath, params.waypoints, params.simDays, params.baseShockBp, params.shortEndEvents, baseDate]);

  // Waypoint dots on the gov3y line — one marker per store waypoint.
  const pathMarkers = useMemo<LwMarker[]>(() => {
    if (!isPath) return [];
    const t = getSimulationChartTheme();
    return params.waypoints.map((w) => ({
      time: dayToTime(baseDate, w.day),
      text: formatBpAxis(w.bp),
      color: t.previewPalette[0],
    }));
  }, [isPath, params.waypoints, baseDate]);

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

  const loading = !isPath && (bond.isLoading || swap.isLoading);
  const hasPolicy = pathSeries.length > 1;

  return (
    <div className="flex h-full w-full flex-col p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="shrink-0 text-body-strong text-fg-primary">
          {isPath ? "시나리오 경로 미리보기" : "인풋 커브 미리보기"}
        </h3>
        <div className="flex min-w-0 items-center gap-3">
          <div className="w-40 shrink-0">
            <SegmentedButtons
              choices={PREVIEW_MODES}
              value={previewMode}
              onChange={setPreviewMode}
              format={(m) => PREVIEW_MODE_LABELS[m]}
              label="미리보기 유형"
            />
          </div>
          <span data-num className="whitespace-nowrap text-micro text-fg-muted">
            {baseDate || "기준일 —"} · D+{params.simDays} {toSigned(params.baseShockBp)}bp
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {isPath ? (
          <LwLineChart series={pathSeries} zeroLine markers={pathMarkers} formatValue={formatBpAxis} />
        ) : loading ? (
          <div className="flex h-full items-center justify-center text-micro text-fg-dim">호가 로딩 중…</div>
        ) : (
          <TermStructureChart pillarLabels={preview.pillars.map((p) => p.label)} curves={curves} />
        )}
      </div>

      {isPath ? (
        <p className="mt-1.5 text-center text-micro text-fg-dim">
          국채 3Y 경로 · 점 = 웨이포인트{hasPolicy ? " · 점선 = 기준금리 누적 변동" : ""}
        </p>
      ) : (
        <>
          {/* Legend + blank-policy notices (커브형) */}
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
        </>
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
