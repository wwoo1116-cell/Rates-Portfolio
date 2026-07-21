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
 * 시계열형 (SIM2-1 revival; RECON-SCEN F2 multi-series): the designed path
 * over the horizon as day-series per (tenor × 곡선군). Owner ruling: the
 * preview offers the tenor axis (every pillar the path machinery produces)
 * AND the curve families (국고 · IRS · 회사채 · 여전채), individually or as a
 * composite overlay. Every series is a VIEW of the SAME day × tenor matrix
 * the Results 대사 M2 shows — lib/recon/path-matrix, fed the request
 * buildSimulateRequest would ship — one source of truth, no re-derived math;
 * family variants come from the request's own 커브 스프레드/credit-spread
 * curves. Rendered on the kept slice host LwLineChart via dayToTime (real
 * calendar slots, s15 rule), waypoint markers + drag on the anchor (국고 3Y)
 * series, a dashed cumulative policy-rate series when 금통위 events exist,
 * and a +X.Xbp axis. ZERO network, zero engine: the base-quote hooks are
 * disabled while this branch shows (they're 커브형-only inputs).
 *
 * View state: store key `previewMode` (UI-only — survives stage navigation,
 * never enters the payload; buildSimulateRequest is previewMode-blind).
 * Tenor/family chip selection is panel-local (defaults on remount: anchor
 * 국고 3Y).
 *
 * Blank-quote policy (커브형): a missing pillar is a line gap + a "—" notice
 * below, never a silent +0; a missing snapshot renders the whole curve as
 * absent with an explicit notice.
 */
import { useCallback, useMemo, useState } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";

import { sectorColor } from "@/lib/chart-colors";
import { cn } from "@/lib/utils";

import { Slider } from "@/components/ui/slider";

import { getSimulationChartTheme } from "../../lib/chart-theme";
import { buildScenarioOverlay, isShapedScenario } from "../../lib/input-curve-preview";
import { buildSimulateRequest } from "../../lib/scenario-curves";
import { buildWaypointPatch } from "../../lib/waypoints";
import {
  PATH_PILLARS,
  createPathEvaluator,
  samplePathDays,
  type CurveFamilyKey,
} from "../../lib/recon/path-matrix";
import { useSectorInputQuotes, useSwapInputQuotes } from "../../hooks/use-input-curves";
import { useSimulationPort } from "../../hooks/use-simulation";
import { useSimulationDataStore } from "../../store/simulation-data-store";
import { SegmentedButtons } from "../segmented-buttons";
import { TermStructureChart, type TermCurveDef } from "../charts/term-structure-chart";
import { LwLineChart, dayToTime, type LwMarker, type LwSeriesDef } from "../charts/lw-line-chart";
import { WaypointDragOverlay } from "../charts/waypoint-drag-overlay";

const PREVIEW_MODES = ["curve", "path"] as const;
const PREVIEW_MODE_LABELS: Record<(typeof PREVIEW_MODES)[number], string> = {
  curve: "커브형",
  path: "시계열형",
};

/** FB4 T2 — 커브형 families (sector vocabulary; the base-quote source per
 * chip). IRS = the market snapshot's swap quotes; the four bond families =
 * per-sector credit-curve series. Colors: the app-wide fixed sector tokens
 * for bond families; IRS keeps the slice's established Tangerine — existing
 * tokens only, no new hues (contrast gate covers all of them). */
const CURVE_FAMILIES = [
  { key: "국고채", label: "국고" },
  { key: "통안채", label: "통안" },
  { key: "IRS", label: "IRS" },
  { key: "회사채", label: "회사채" },
  { key: "여전채", label: "여전채" },
] as const;

function curveFamilyColor(key: string): string {
  if (key === "IRS") return getSimulationChartTheme().previewPalette[2]; // Tangerine
  return sectorColor(key);
}

/** F2 curve families — display key → the request's shock-curve family.
 * 여전채 rides the 카드채 curve (backend get_sector_curve_key: 여전→카드채). */
const PATH_FAMILIES = [
  { key: "국고", curve: "국채" },
  { key: "IRS", curve: "swap" },
  { key: "회사채", curve: "회사채" },
  { key: "여전채", curve: "카드채" },
] as const satisfies readonly { key: string; curve: CurveFamilyKey }[];
type PathFamilyKey = (typeof PATH_FAMILIES)[number]["key"];

const ANCHOR_FAMILY: PathFamilyKey = "국고";
// N1: the anchor TENOR is no longer a constant — it follows
// params.anchorTenor (default 3Y). The family stays 국고 (owner choice set is
// 국고 pillars only).

/** "+12.5bp" axis/badge format for the path view (rate-fan formatBpAxis
 * pattern; applied to every series — z-order formatter rule). */
const formatBpAxis = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}bp`;

/** Display rounding for series points — the same 0.1bp-legible 2dp the
 * original buildTimePath view used. */
const round2 = (v: number) => parseFloat(v.toFixed(2));

/** Established family colors: 국고=Ocean, IRS=Tangerine (this panel's 커브형
 * legend pair), 회사채/여전채 = the app-wide fixed sector hues. */
function pathFamilyColor(key: PathFamilyKey): string {
  const t = getSimulationChartTheme();
  if (key === "국고") return t.previewPalette[0];
  if (key === "IRS") return t.previewPalette[2];
  return sectorColor(key);
}

/** Multi-select toggle chip — the SegmentedButtons pressed recipe, minus the
 * mutual exclusion. */
function ToggleChip({
  label,
  pressed,
  onToggle,
}: {
  label: string;
  pressed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onToggle}
      data-num
      className={cn(
        "border border-border-subtle px-1.5 py-0.5 text-micro label-nowrap",
        pressed
          ? "bg-sem-info-ghost text-sem-info shadow-[inset_0_0_0_1px_var(--sem-info)]"
          : "text-fg-muted",
      )}
    >
      {label}
    </button>
  );
}

export function CurveViewPanel() {
  const { params, inputs, patchParams } = useSimulationPort();
  const baseDate = inputs.baseDate;
  const previewMode = useSimulationDataStore((s) => s.previewMode);
  const setPreviewMode = useSimulationDataStore((s) => s.setPreviewMode);
  const isPath = previewMode === "path";

  // N1 — the designed anchor pillar (params-driven; absent ≡ 3Y).
  const anchorTenor = params.anchorTenor ?? "3Y";

  // F2 — panel-local series selection; the anchor (국고 × anchorTenor) is the
  // default.
  const [selTenors, setSelTenors] = useState<string[]>([anchorTenor]);
  const [selFamilies, setSelFamilies] = useState<PathFamilyKey[]>([ANCHOR_FAMILY]);
  const toggleIn = <T,>(list: T[], v: T): T[] =>
    list.includes(v) ? (list.length > 1 ? list.filter((x) => x !== v) : list) : [...list, v];
  // N1 — switching the anchor auto-selects its tenor chip: the waypoint dots
  // and drag must always have their honest host series available one click
  // after an anchor change (existing selections are kept, nothing deselects).
  // Render-phase reconcile (the React adjust-state-during-render pattern),
  // not an effect — a synchronous setState in an effect cascades renders.
  const [reconciledAnchor, setReconciledAnchor] = useState(anchorTenor);
  if (reconciledAnchor !== anchorTenor) {
    setReconciledAnchor(anchorTenor);
    if (!selTenors.includes(anchorTenor)) setSelTenors([...selTenors, anchorTenor]);
  }

  // SIM2-3 — live chart/series refs for the drag overlay, via the
  // onSeriesRebuilt seam. Stable callback: the series effect lists it as a dep.
  const [pathHost, setPathHost] = useState<{
    chart: IChartApi;
    series: ISeriesApi<"Line"> | null;
  } | null>(null);
  const handleSeriesRebuilt = useCallback(
    (chart: IChartApi, firstSeries: ISeriesApi<"Line"> | null) =>
      setPathHost({ chart, series: firstSeries }),
    [],
  );
  // Drag commits through the SAME lib patch the steppers use (payload
  // identity is structural; the day is flagged touched for SIM2-2 regen).
  const commitWaypoint = useCallback(
    (day: number, bp: number) => {
      const p = useSimulationDataStore.getState().params;
      patchParams(buildWaypointPatch(p, day, bp));
    },
    [patchParams],
  );

  // FB4 T2 — 커브형 family selection (sector vocabulary; default 국고+IRS =
  // the pre-FB4 two lines). Chips render only for families the snapshot
  // carries; the last selected family stays.
  const [selCurveFamilies, setSelCurveFamilies] = useState<string[]>(["국고채", "IRS"]);
  // Scrubber position for SHAPED scenarios (null = horizon end).
  const [scrubDay, setScrubDay] = useState<number | null>(null);

  // ONE request → ONE evaluator for both preview modes — the same structural
  // identity the payload-parity pin protects, and the T2 no-forked-math rule:
  // every overlay value flows through createPathEvaluator.
  const req = useMemo(() => buildSimulateRequest(inputs, params), [inputs, params]);
  const evaluator = useMemo(() => createPathEvaluator(req), [req]);
  const shaped = useMemo(() => isShapedScenario(req), [req]);
  const effDay = shaped ? Math.min(scrubDay ?? params.simDays, params.simDays) : params.simDays;

  // 커브형-only inputs — every quote hook is disabled on the path branch so
  // 시계열형 stays provably network-free (SIM2-1 no-fetch pin), and an
  // UNSELECTED family costs no request either. Cached per (sector, baseDate).
  const gov = useSectorInputQuotes("국고채", baseDate, !isPath && selCurveFamilies.includes("국고채"));
  const msb = useSectorInputQuotes("통안채", baseDate, !isPath && selCurveFamilies.includes("통안채"));
  const corp = useSectorInputQuotes("회사채", baseDate, !isPath && selCurveFamilies.includes("회사채"));
  const card = useSectorInputQuotes("여전채", baseDate, !isPath && selCurveFamilies.includes("여전채"));
  const swap = useSwapInputQuotes(baseDate, !isPath && selCurveFamilies.includes("IRS"));

  const sectorQueries: Record<string, ReturnType<typeof useSectorInputQuotes>> = useMemo(
    () => ({ 국고채: gov, 통안채: msb, 회사채: corp, 여전채: card }),
    [gov, msb, corp, card],
  );

  // Chip roster: IRS always (market snapshot source); bond families only when
  // the credit taxonomy carries them ("every family the snapshot carries").
  const familyRoster = CURVE_FAMILIES.filter(
    (f) => f.key === "IRS" || (sectorQueries[f.key]?.carried ?? false) || selCurveFamilies.includes(f.key),
  );

  const overlay = useMemo(() => {
    const families = CURVE_FAMILIES.filter((f) => selCurveFamilies.includes(f.key)).map((f) => ({
      key: f.key,
      quotes:
        f.key === "IRS"
          ? swap.isError
            ? []
            : swap.data ?? []
          : sectorQueries[f.key].isError
            ? []
            : sectorQueries[f.key].data ?? [],
    }));
    return buildScenarioOverlay(req, effDay, families);
  }, [req, effDay, selCurveFamilies, swap.data, swap.isError, sectorQueries]);

  // ── 시계열형 series: the M2 path matrix, pure client math, no DOM/network ──
  const pathModel = useMemo(() => {
    if (!isPath) return null;
    return { evaluator, days: samplePathDays(req) };
  }, [isPath, evaluator, req]);

  const anchorVisible = selFamilies.includes(ANCHOR_FAMILY) && selTenors.includes(anchorTenor);

  const pathSeries = useMemo<LwSeriesDef[]>(() => {
    if (!isPath || !pathModel) return [];
    const { evaluator, days } = pathModel;
    const t = getSimulationChartTheme();

    const combos = PATH_FAMILIES.filter((f) => selFamilies.includes(f.key)).flatMap((f) =>
      PATH_PILLARS.filter((p) => selTenors.includes(p.label)).map((p) => ({
        family: f,
        pillar: p,
        isAnchor: f.key === ANCHOR_FAMILY && p.label === anchorTenor,
      })),
    );
    // Anchor first: markers, the zero line, and the drag overlay ride series[0].
    combos.sort((a, b) => Number(b.isAnchor) - Number(a.isAnchor));

    const defs: LwSeriesDef[] = combos.map(({ family, pillar, isAnchor }) => ({
      color: pathFamilyColor(family.key),
      lineWidth: isAnchor ? 2 : 1,
      data: days.map((d) => ({
        time: dayToTime(baseDate, d),
        value: round2(evaluator.cumBpAt(family.curve, pillar.t, d)),
      })),
    }));

    if (evaluator.hasBokEvents) {
      defs.push({
        color: t.axis,
        lineWidth: 2,
        dashed: true,
        data: days.map((d) => ({ time: dayToTime(baseDate, d), value: evaluator.bokCumBpAt(d) })),
      });
    }
    return defs;
    // N1: anchorTenor is a real input — it decides isAnchor (sort + width).
  }, [isPath, pathModel, selFamilies, selTenors, baseDate, anchorTenor]);

  // Waypoint dots on the anchor line — one marker per store waypoint. Without
  // the anchor on screen the dots (and drag) have no honest host series.
  const pathMarkers = useMemo<LwMarker[]>(() => {
    if (!isPath || !anchorVisible) return [];
    const t = getSimulationChartTheme();
    return params.waypoints.map((w) => ({
      time: dayToTime(baseDate, w.day),
      text: formatBpAxis(w.bp),
      color: t.previewPalette[0],
    }));
  }, [isPath, anchorVisible, params.waypoints, baseDate]);

  // FB4 T2 — solid base + same-color DASHED scenario ghost per selected
  // family (RH rendering grammar: sector tokens; IRS keeps the established
  // Tangerine — no new hues).
  const curves: TermCurveDef[] = overlay.series.flatMap((s) => {
    const color = curveFamilyColor(s.key);
    const label = CURVE_FAMILIES.find((f) => f.key === s.key)?.label ?? s.key;
    return [
      { label, color, points: s.basePct },
      { label: `${label} 시나리오`, color, points: s.shockedPct, dashed: true },
    ];
  });

  // Per selected family: tenors the source carries with no value on the date
  // (a gap + "—", blank policy — never a silent +0).
  const missingByFamily = CURVE_FAMILIES.filter((f) => selCurveFamilies.includes(f.key))
    .map((f) => {
      const quotes = f.key === "IRS" ? swap.data ?? [] : sectorQueries[f.key].data ?? [];
      return { label: f.label, missing: quotes.filter((q) => q.rate === null).map((q) => q.label) };
    })
    .filter((m) => m.missing.length > 0);

  const loading =
    !isPath &&
    (swap.isLoading || CURVE_FAMILIES.some((f) => f.key !== "IRS" && sectorQueries[f.key].isLoading));
  const hasPolicy = isPath && (pathModel?.evaluator.hasBokEvents ?? false);

  // Scrubber readout: the ANCHOR pillar's designed cum bp at the slice.
  const anchorYears = { "1Y": 1, "3Y": 3, "5Y": 5, "10Y": 10 }[anchorTenor] ?? 3;
  const scrubBp = evaluator.cumBpAt("국채", anchorYears, effDay);

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

      {/* FB4 T2 — 커브형 family chips (RH grammar): every family the
          snapshot carries; default 국고+IRS. */}
      {!isPath && (
        <div className="mb-2 flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="mr-0.5 text-label font-bold uppercase text-fg-muted">곡선군</span>
          {familyRoster.map((f) => (
            <ToggleChip
              key={f.key}
              label={f.label}
              pressed={selCurveFamilies.includes(f.key)}
              onToggle={() => setSelCurveFamilies((cur) => toggleIn(cur, f.key))}
            />
          ))}
          {shaped && (
            <span className="ml-auto inline-flex min-w-0 items-center gap-2">
              <span data-num className="text-micro text-sem-info label-nowrap">
                D+{effDay} {formatBpAxis(scrubBp)}
              </span>
              <Slider
                aria-label="시나리오 시점 (D+n)"
                min={0}
                max={params.simDays}
                step={1}
                value={effDay}
                onChange={(e) => setScrubDay(Number(e.target.value))}
                className="w-40"
              />
            </span>
          )}
        </div>
      )}

      {/* F2 — series selection chips (path mode only): every pillar the path
          machinery produces + the four curve families. */}
      {isPath && (
        <div className="mb-2 flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="mr-0.5 text-label font-bold uppercase text-fg-muted">테너</span>
          {PATH_PILLARS.map((p) => (
            <ToggleChip
              key={p.label}
              label={p.label}
              pressed={selTenors.includes(p.label)}
              onToggle={() => setSelTenors((cur) => toggleIn(cur, p.label))}
            />
          ))}
          <span className="ml-2 mr-0.5 text-label font-bold uppercase text-fg-muted">곡선군</span>
          {PATH_FAMILIES.map((f) => (
            <ToggleChip
              key={f.key}
              label={f.key}
              pressed={selFamilies.includes(f.key)}
              onToggle={() => setSelFamilies((cur) => toggleIn(cur, f.key))}
            />
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {isPath ? (
          <div className="relative h-full w-full">
            <LwLineChart
              series={pathSeries}
              zeroLine
              markers={pathMarkers}
              formatValue={formatBpAxis}
              onSeriesRebuilt={handleSeriesRebuilt}
            />
            <WaypointDragOverlay
              chart={pathHost?.chart ?? null}
              series={anchorVisible ? pathHost?.series ?? null : null}
              baseDate={baseDate}
              waypoints={params.waypoints.slice(1, -1)}
              baseShockBp={params.baseShockBp}
              onCommit={commitWaypoint}
            />
          </div>
        ) : loading ? (
          <div className="flex h-full items-center justify-center text-micro text-fg-dim">호가 로딩 중…</div>
        ) : (
          <TermStructureChart pillarLabels={overlay.pillars.map((p) => p.label)} curves={curves} />
        )}
      </div>

      {isPath ? (
        <>
          {/* Legend: established family colors for the selected 곡선군. */}
          <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-micro">
            {PATH_FAMILIES.filter((f) => selFamilies.includes(f.key)).map((f) => (
              <span key={f.key} className="inline-flex items-center gap-1.5 text-fg-muted">
                <span
                  className="inline-block h-0.5 w-4"
                  style={{ backgroundColor: pathFamilyColor(f.key) }}
                />
                {f.key}
              </span>
            ))}
          </div>
          <p data-num className="mt-0.5 text-center text-micro text-fg-dim">
            테너 {selTenors.join("/")} 경로
            {anchorVisible
              ? ` · 점 = 웨이포인트 (국고 ${anchorTenor} 드래그 가능)`
              : ` · 웨이포인트 드래그는 국고 ${anchorTenor} 표시 중에만`}
            {hasPolicy ? " · 점선 = 기준금리 누적 변동" : ""}
          </p>
        </>
      ) : (
        <>
          {/* Legend + blank-policy notices (커브형, FB4): solid = base curve,
              dashed ghost = the scenario at the readout's D+n slice. */}
          <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-micro">
            {CURVE_FAMILIES.filter((f) => selCurveFamilies.includes(f.key)).map((f) => {
              const err = f.key === "IRS" ? swap.isError : sectorQueries[f.key].isError;
              return (
                <span key={f.key} className="inline-flex items-center gap-1.5 text-fg-muted">
                  <span
                    className="inline-block h-0.5 w-4"
                    style={{ backgroundColor: curveFamilyColor(f.key) }}
                  />
                  {f.label}
                  {err && <span className="text-fg-dim">호가 없음 —</span>}
                </span>
              );
            })}
            <span className="text-fg-dim label-nowrap">점선 = 시나리오 (D+{effDay})</span>
            {evaluator.hasBokEvents && (
              <span data-num className="text-fg-dim label-nowrap">
                단기 {formatBpAxis(evaluator.bokCumBpAt(effDay))} (금통위)
              </span>
            )}
          </div>
          {missingByFamily.length > 0 && (
            <p data-num className="mt-0.5 text-center text-micro text-fg-dim">
              결측 호가:
              {missingByFamily.map((m) => ` ${m.label} ${m.missing.join("/")} —`).join("")}
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
