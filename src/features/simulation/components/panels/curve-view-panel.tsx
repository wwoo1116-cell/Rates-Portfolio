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
  sectorToFamily,
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

const IRS_KEY = "IRS";

/** FB5 B1 — the ONE preview family roster, shared by 커브형 and 시계열형. Names
 * are the PVBP sector taxonomy (ruling ①: same vocabulary the M1/M2 grids and
 * sectorColor use), ordered benchmarks-first then blotter order (ruling ②: the
 * Rate History selector convention). Only the credit-matrix-backed sectors that
 * carry a DISTINCT curve are offered; 통안채·특은채 are honestly ABSENT — the
 * snapshot has no distinct curve for them (both fold to 국고채·공사채 in the
 * credit matrix AND in the shock model), exactly as the Rate History selector
 * omits them (ruling ③: absent, never a clickable chip that draws nothing).
 * Each bond sector's curves derive through the engine's own sectorToFamily (no
 * forked mapping): base quote = useSectorInputQuotes(sector) at its
 * representative rating; shock/ghost family = sectorToFamily(sector). IRS rides
 * the swap snapshot. Reuse-guard: every string is pinned ∈ chart-colors
 * SECTOR_ORDER ∪ {IRS} by curve-view-panel.test. */
const PREVIEW_FAMILIES = ["국고채", IRS_KEY, "공사채", "시은채", "여전채", "회사채"] as const;
type FamilyKey = (typeof PREVIEW_FAMILIES)[number];

/** Established family color: the app-wide fixed sector token per bond sector;
 * IRS keeps the slice's Tangerine (existing tokens only — the contrast gate
 * covers all of them). */
function familyColor(key: string): string {
  if (key === IRS_KEY) return getSimulationChartTheme().previewPalette[2]; // Tangerine
  return sectorColor(key);
}

const ANCHOR_FAMILY: FamilyKey = "국고채";
// N1: the anchor TENOR follows params.anchorTenor (default 3Y). The family
// stays 국고채 (owner choice set is 국고채 pillars only).

/** "+12.5bp" axis/badge format for the path view (rate-fan formatBpAxis
 * pattern; applied to every series — z-order formatter rule). */
const formatBpAxis = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}bp`;

/** Display rounding for series points — the same 0.1bp-legible 2dp the
 * original buildTimePath view used. */
const round2 = (v: number) => parseFloat(v.toFixed(2));

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

  // F2 — panel-local series selection; the anchor (국고채 × anchorTenor) is the
  // default.
  const [selTenors, setSelTenors] = useState<string[]>([anchorTenor]);
  const [selFamilies, setSelFamilies] = useState<FamilyKey[]>([ANCHOR_FAMILY]);
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

  // FB4 T2 — 커브형 family selection (PVBP sector vocabulary; default 국고채+IRS
  // = the pre-FB4 two lines). Chips render only for families the snapshot
  // carries; the last selected family stays.
  const [selCurveFamilies, setSelCurveFamilies] = useState<string[]>(["국고채", IRS_KEY]);
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
  // UNSELECTED family costs no request either. Cached per (sector, rating,
  // baseDate). FB5 B1: the four rated sectors now fetch at their representative
  // rating (useSectorInputQuotes) instead of the silent-blank rating:null.
  const gov = useSectorInputQuotes("국고채", baseDate, !isPath && selCurveFamilies.includes("국고채"));
  const agency = useSectorInputQuotes("공사채", baseDate, !isPath && selCurveFamilies.includes("공사채"));
  const comm = useSectorInputQuotes("시은채", baseDate, !isPath && selCurveFamilies.includes("시은채"));
  const card = useSectorInputQuotes("여전채", baseDate, !isPath && selCurveFamilies.includes("여전채"));
  const corp = useSectorInputQuotes("회사채", baseDate, !isPath && selCurveFamilies.includes("회사채"));
  const swap = useSwapInputQuotes(baseDate, !isPath && selCurveFamilies.includes(IRS_KEY));

  const sectorQueries: Record<string, ReturnType<typeof useSectorInputQuotes>> = useMemo(
    () => ({ 국고채: gov, 공사채: agency, 시은채: comm, 여전채: card, 회사채: corp }),
    [gov, agency, comm, card, corp],
  );

  // Chip roster: IRS always (market snapshot source); bond families only when
  // the credit taxonomy carries them ("every family the snapshot carries" —
  // 통안채·특은채 are absent because it doesn't). Every offered chip therefore
  // draws a real curve (the FB5 honesty pin), never a clickable silent blank.
  const familyRoster = PREVIEW_FAMILIES.filter(
    (key) => key === IRS_KEY || (sectorQueries[key]?.carried ?? false) || selCurveFamilies.includes(key),
  );

  const overlay = useMemo(() => {
    const families = PREVIEW_FAMILIES.filter((key) => selCurveFamilies.includes(key)).map((key) => ({
      key,
      quotes:
        key === IRS_KEY
          ? swap.isError
            ? []
            : swap.data ?? []
          : sectorQueries[key].isError
            ? []
            : sectorQueries[key].data ?? [],
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

    const combos = PREVIEW_FAMILIES.filter((key) => selFamilies.includes(key)).flatMap((key) =>
      PATH_PILLARS.filter((p) => selTenors.includes(p.label)).map((p) => ({
        key,
        // Shock/base family via the engine's own sectorToFamily (no forked
        // mapping): 국고채→국채, 공사채→특은채, 시은채→은행채, 여전채→카드채,
        // 회사채→회사채, IRS→swap.
        curve: sectorToFamily(key),
        pillar: p,
        isAnchor: key === ANCHOR_FAMILY && p.label === anchorTenor,
      })),
    );
    // Anchor first: markers, the zero line, and the drag overlay ride series[0].
    combos.sort((a, b) => Number(b.isAnchor) - Number(a.isAnchor));

    const defs: LwSeriesDef[] = combos.map(({ key, curve, pillar, isAnchor }) => ({
      color: familyColor(key),
      lineWidth: isAnchor ? 2 : 1,
      data: days.map((d) => ({
        time: dayToTime(baseDate, d),
        value: round2(evaluator.cumBpAt(curve, pillar.t, d)),
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
    return params.waypoints.map((w) => ({
      time: dayToTime(baseDate, w.day),
      text: formatBpAxis(w.bp),
      color: familyColor(ANCHOR_FAMILY),
    }));
  }, [isPath, anchorVisible, params.waypoints, baseDate]);

  // FB4 T2 — solid base + same-color DASHED scenario ghost per selected
  // family (RH rendering grammar: PVBP sector tokens; IRS keeps the established
  // Tangerine — no new hues). The label IS the PVBP sector name (ruling ①).
  const curves: TermCurveDef[] = overlay.series.flatMap((s) => {
    const color = familyColor(s.key);
    return [
      { label: s.key, color, points: s.basePct },
      { label: `${s.key} 시나리오`, color, points: s.shockedPct, dashed: true },
    ];
  });

  // Per selected family: tenors the source carries with no value on the date
  // (a gap + "—", blank policy — never a silent +0).
  const missingByFamily = PREVIEW_FAMILIES.filter((key) => selCurveFamilies.includes(key))
    .map((key) => {
      const quotes = key === IRS_KEY ? swap.data ?? [] : sectorQueries[key].data ?? [];
      return { label: key, missing: quotes.filter((q) => q.rate === null).map((q) => q.label) };
    })
    .filter((m) => m.missing.length > 0);

  // FB5 B1 honesty — disclose the representative rating each RATED family's
  // preview curve reflects (never pass a single tier off as the whole sector).
  const ratingBySector = PREVIEW_FAMILIES.filter(
    (key) => key !== IRS_KEY && selCurveFamilies.includes(key) && sectorQueries[key]?.rated,
  )
    .map((key) => ({ label: key as string, rating: sectorQueries[key]?.representativeRating }))
    .filter((r): r is { label: string; rating: string } => !!r.rating);

  const loading =
    !isPath &&
    (swap.isLoading ||
      PREVIEW_FAMILIES.some((key) => key !== IRS_KEY && sectorQueries[key].isLoading));
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

      {/* FB4 T2 / FB5 B1 — 커브형 family chips (PVBP sector taxonomy, RH
          grammar): every sector the snapshot carries a real curve for; default
          국고채+IRS. */}
      {!isPath && (
        <div className="mb-2 flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="mr-0.5 text-label font-bold uppercase text-fg-muted">곡선군</span>
          {familyRoster.map((key) => (
            <ToggleChip
              key={key}
              label={key}
              pressed={selCurveFamilies.includes(key)}
              onToggle={() => setSelCurveFamilies((cur) => toggleIn(cur, key))}
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

      {/* F2 / FB5 B1 — series selection chips (path mode only): every pillar the
          path machinery produces + the PVBP curve families (same roster as
          커브형; each rides its shock-curve family). */}
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
          {PREVIEW_FAMILIES.map((key) => (
            <ToggleChip
              key={key}
              label={key}
              pressed={selFamilies.includes(key)}
              onToggle={() => setSelFamilies((cur) => toggleIn(cur, key))}
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
            {PREVIEW_FAMILIES.filter((key) => selFamilies.includes(key)).map((key) => (
              <span key={key} className="inline-flex items-center gap-1.5 text-fg-muted">
                <span
                  className="inline-block h-0.5 w-4"
                  style={{ backgroundColor: familyColor(key) }}
                />
                {key}
              </span>
            ))}
          </div>
          <p data-num className="mt-0.5 text-center text-micro text-fg-dim">
            테너 {selTenors.join("/")} 경로
            {anchorVisible
              ? ` · 점 = 웨이포인트 (${ANCHOR_FAMILY} ${anchorTenor} 드래그 가능)`
              : ` · 웨이포인트 드래그는 ${ANCHOR_FAMILY} ${anchorTenor} 표시 중에만`}
            {hasPolicy ? " · 점선 = 기준금리 누적 변동" : ""}
          </p>
        </>
      ) : (
        <>
          {/* Legend + blank-policy notices (커브형, FB4): solid = base curve,
              dashed ghost = the scenario at the readout's D+n slice. */}
          <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-micro">
            {PREVIEW_FAMILIES.filter((key) => selCurveFamilies.includes(key)).map((key) => {
              const err = key === IRS_KEY ? swap.isError : sectorQueries[key].isError;
              return (
                <span key={key} className="inline-flex items-center gap-1.5 text-fg-muted">
                  <span
                    className="inline-block h-0.5 w-4"
                    style={{ backgroundColor: familyColor(key) }}
                  />
                  {key}
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
          {/* FB5 B1 honesty — the representative rating each rated family's
              preview curve reflects (a single tier is never passed off as the
              whole sector). */}
          {ratingBySector.length > 0 && (
            <p data-num className="mt-0.5 text-center text-micro text-fg-dim">
              기준 등급:{ratingBySector.map((r) => ` ${r.label} ${r.rating}`).join(" ·")}
            </p>
          )}
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
