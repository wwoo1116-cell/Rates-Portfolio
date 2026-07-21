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
 * over the horizon as day-series per (tenor × 곡선군). Every series is a VIEW
 * of the SAME day × tenor matrix the Results 대사 M2 shows — lib/recon/path-
 * matrix, fed the request buildSimulateRequest would ship — one source of
 * truth, no re-derived math; family variants come from the request's own 커브
 * 스프레드/credit-spread curves. Rendered on the kept slice host LwLineChart via
 * dayToTime (real calendar slots, s15 rule), waypoint markers + drag on the
 * anchor (국고 3Y) series, a dashed cumulative policy-rate series when 금통위
 * events exist, and a +X.Xbp axis. ZERO network, zero engine: the base-quote
 * hooks are disabled while this branch shows (they're 커브형-only inputs).
 *
 * Selection UI (FB5R R2, owner ruling): BOTH previews select through the SHARED
 * Rates History control row (InstrumentSelector) — [자산군][등급][테너][Add] with
 * removable chips beneath — the imported RH component configured per mode, NOT a
 * mirror. 시계열형 enables 자산군+테너 (등급 N/A: the path is family-based via
 * sectorToFamily, rating-independent); each Add appends a (family × tenor)
 * series chip. 커브형 enables 자산군+등급 (테너 N/A: a family = the whole curve);
 * the 등급 dropdown is LIVE for rated sectors (default = 기준 등급 ratings[0],
 * changing it refetches that family's base curve at the chosen tier — R2
 * amendment), each Add appends/updates a family chip. The old 1D~10Y tenor
 * button row and 곡선군 chip rows are gone (pinned absent). Payload is
 * selection-blind (buildSimulateRequest reads only inputs/params), so parity
 * is structural.
 *
 * View state: store key `previewMode` (UI-only — survives stage navigation,
 * never enters the payload). Series/family selection is panel-local (defaults on
 * remount: anchor 국고 3Y for 시계열형, 국고채+IRS for 커브형).
 *
 * Blank-quote policy (커브형): a missing pillar is a line gap + a "—" notice
 * below, never a silent +0; a missing snapshot renders the whole curve as
 * absent with an explicit notice.
 */
import { useCallback, useMemo, useState } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";

import { sectorColor } from "@/lib/chart-colors";
import type { InstrumentTaxonomyOut } from "@/lib/api-client";
import type { SelectedInstrument } from "@/lib/rv-instruments";
import { InstrumentSelector } from "@/components/ui/instrument-selector";

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
import {
  useCreditTaxonomy,
  useSectorInputQuotes,
  useSwapInputQuotes,
} from "../../hooks/use-input-curves";
import { useSimulationPort } from "../../hooks/use-simulation";
import { useSimulationDataStore } from "../../store/simulation-data-store";
import { SegmentedButtons } from "../segmented-buttons";
import { TermStructureChart, type TermCurveDef } from "../charts/term-structure-chart";
import {
  LwLineChart,
  dayToTime,
  type LwCrosshairReadout,
  type LwMarker,
  type LwSeriesDef,
} from "../charts/lw-line-chart";
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

/** FB5 B2 — the crosshair date label (UTC seconds → YYYY-MM-DD), matching the
 * dayToTime UTC-slot convention the series use. */
function formatCrosshairDate(tsSeconds: number): string {
  const d = new Date(tsSeconds * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/** Chip identity keys for the shared selector's `selected`/`onRemove`. */
const pathChipId = (family: string, tenor: string) => `P:${family}|${tenor}`;
const curveChipId = (family: string) => `C:${family}`;

export function CurveViewPanel() {
  const { params, inputs, patchParams } = useSimulationPort();
  const baseDate = inputs.baseDate;
  const previewMode = useSimulationDataStore((s) => s.previewMode);
  const setPreviewMode = useSimulationDataStore((s) => s.setPreviewMode);
  const isPath = previewMode === "path";

  // N1 — the designed anchor pillar (params-driven; absent ≡ 3Y).
  const anchorTenor = params.anchorTenor ?? "3Y";

  // FB5R R2 — 시계열형 selection: an explicit list of (family × tenor) series,
  // each a removable chip in the shared RH selector. The anchor (국고채 ×
  // anchorTenor) is the default (markers/drag host).
  const [pathSel, setPathSel] = useState<{ family: FamilyKey; tenor: string }[]>([
    { family: ANCHOR_FAMILY, tenor: anchorTenor },
  ]);
  // FB5R R2 — 커브형 selection: an explicit list of families, each carrying the
  // rating tier its curve reflects (null = unrated / 국고채·IRS). Family-unique:
  // re-adding a family updates its rating (redraws that family's curve for the
  // chosen tier — R2 amendment). Default 국고채+IRS = the pre-FB4 two lines.
  const [curveSel, setCurveSel] = useState<{ family: FamilyKey; rating: string | null }[]>([
    { family: "국고채", rating: null },
    { family: IRS_KEY, rating: null },
  ]);

  // N1 — switching the anchor auto-selects its (국고채 × anchorTenor) series: the
  // waypoint dots and drag must always have their honest host series available
  // one click after an anchor change (existing selections kept, nothing drops).
  // Render-phase reconcile (the React adjust-state-during-render pattern), not
  // an effect — a synchronous setState in an effect cascades renders.
  const [reconciledAnchor, setReconciledAnchor] = useState(anchorTenor);
  if (reconciledAnchor !== anchorTenor) {
    setReconciledAnchor(anchorTenor);
    if (!pathSel.some((s) => s.family === ANCHOR_FAMILY && s.tenor === anchorTenor)) {
      setPathSel([...pathSel, { family: ANCHOR_FAMILY, tenor: anchorTenor }]);
    }
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

  // Scrubber position for SHAPED scenarios (null = horizon end).
  const [scrubDay, setScrubDay] = useState<number | null>(null);

  // FB5 B2 — the 시계열형 per-series Δbp readout under the crosshair date. The
  // values are the chart's own plotted points (LwLineChart sources them from
  // param.seriesData), so this never recomputes and never disagrees with the
  // lines. null = crosshair off the data.
  const [readout, setReadout] = useState<LwCrosshairReadout | null>(null);

  // ONE request → ONE evaluator for both preview modes — the same structural
  // identity the payload-parity pin protects, and the T2 no-forked-math rule:
  // every overlay value flows through createPathEvaluator.
  const req = useMemo(() => buildSimulateRequest(inputs, params), [inputs, params]);
  const evaluator = useMemo(() => createPathEvaluator(req), [req]);
  const shaped = useMemo(() => isShapedScenario(req), [req]);
  const effDay = shaped ? Math.min(scrubDay ?? params.simDays, params.simDays) : params.simDays;

  // FB5R R2 — the credit taxonomy backs the 커브형 selector's 자산군 roster (only
  // sectors the snapshot carries) and its live 등급 options. Curve-mode only, so
  // the 시계열형 no-fetch pin holds (shares the cache key with the sector hooks).
  const creditTaxonomy = useCreditTaxonomy(!isPath);
  const ratingsOf = useCallback(
    (family: string): string[] =>
      creditTaxonomy.data?.sectors.find((s) => s.sector === family)?.ratings ?? [],
    [creditTaxonomy.data],
  );
  const carried = useCallback(
    (family: string): boolean => creditTaxonomy.data?.sectors.some((s) => s.sector === family) ?? false,
    [creditTaxonomy.data],
  );

  // The rating tier a selected family's 커브형 curve reflects (drives the base-
  // quote refetch). undefined for an unselected family → the hook keeps its B1
  // default; a selected family carries an explicit tier (null for 국고채).
  const curveRatingOf = useCallback(
    (family: string): string | null | undefined => {
      const sel = curveSel.find((c) => c.family === family);
      return sel ? sel.rating : undefined;
    },
    [curveSel],
  );
  const curveHas = useCallback((family: string) => curveSel.some((c) => c.family === family), [curveSel]);

  // 커브형-only inputs — every quote hook is disabled on the path branch so
  // 시계열형 stays provably network-free (SIM2-1 no-fetch pin), and an
  // UNSELECTED family costs no request either. Each RATED family fetches at the
  // tier its chip carries (FB5R R2: the live 등급 dropdown), defaulting to the
  // B1 representative rating; 국고채 stays rating:null.
  const gov = useSectorInputQuotes("국고채", baseDate, !isPath && curveHas("국고채"), curveRatingOf("국고채"));
  const agency = useSectorInputQuotes("공사채", baseDate, !isPath && curveHas("공사채"), curveRatingOf("공사채"));
  const comm = useSectorInputQuotes("시은채", baseDate, !isPath && curveHas("시은채"), curveRatingOf("시은채"));
  const card = useSectorInputQuotes("여전채", baseDate, !isPath && curveHas("여전채"), curveRatingOf("여전채"));
  const corp = useSectorInputQuotes("회사채", baseDate, !isPath && curveHas("회사채"), curveRatingOf("회사채"));
  const swap = useSwapInputQuotes(baseDate, !isPath && curveHas(IRS_KEY));

  const sectorQueries: Record<string, ReturnType<typeof useSectorInputQuotes>> = useMemo(
    () => ({ 국고채: gov, 공사채: agency, 시은채: comm, 여전채: card, 회사채: corp }),
    [gov, agency, comm, card, corp],
  );

  // ── FB5R R2 — shared RH selector wiring ────────────────────────────────────

  // 시계열형: outright over the full family roster × path pillars, 등급 locked
  // N/A (family-based path). Synthesized taxonomy = the preview vocabulary.
  const pathTaxonomy: InstrumentTaxonomyOut = useMemo(
    () => ({
      sectors: PREVIEW_FAMILIES.map((key) => ({
        sector: key,
        ratings: [],
        tenors: PATH_PILLARS.map((p) => p.label),
      })),
    }),
    [],
  );
  // 커브형: outright over the carried families, 테너 locked N/A (whole curve),
  // 등급 live from the real taxonomy (rated sectors only). Keep an already-
  // selected family in the roster even if the taxonomy hiccups.
  const curveFamilies = useMemo(
    () => PREVIEW_FAMILIES.filter((key) => key === IRS_KEY || carried(key) || curveHas(key)),
    [carried, curveHas],
  );
  const curveTaxonomy: InstrumentTaxonomyOut = useMemo(
    () => ({
      sectors: curveFamilies.map((key) => ({
        sector: key,
        ratings: key === IRS_KEY ? [] : ratingsOf(key),
        tenors: [],
      })),
    }),
    [curveFamilies, ratingsOf],
  );

  const pathSelected: SelectedInstrument[] = useMemo(
    () =>
      pathSel.map((s) => ({
        kind: "outright" as const,
        id: pathChipId(s.family, s.tenor),
        leg: { sector: s.family, rating: null, tenor: s.tenor },
      })),
    [pathSel],
  );
  const curveSelected: SelectedInstrument[] = useMemo(
    () =>
      curveSel.map((c) => ({
        kind: "outright" as const,
        id: curveChipId(c.family),
        leg: { sector: c.family, rating: c.rating, tenor: "" },
      })),
    [curveSel],
  );

  const addPath = useCallback((inst: SelectedInstrument) => {
    if (inst.kind !== "outright") return;
    const family = inst.leg.sector as FamilyKey;
    const tenor = inst.leg.tenor;
    if (!tenor) return;
    setPathSel((prev) =>
      prev.some((s) => s.family === family && s.tenor === tenor) ? prev : [...prev, { family, tenor }],
    );
  }, []);
  const removePath = useCallback(
    (id: string) => setPathSel((prev) => prev.filter((s) => pathChipId(s.family, s.tenor) !== id)),
    [],
  );
  const addCurve = useCallback((inst: SelectedInstrument) => {
    if (inst.kind !== "outright") return;
    const family = inst.leg.sector as FamilyKey;
    const rating = inst.leg.rating;
    // Family-unique: re-Add updates the tier in place (redraws that family's
    // curve at the chosen rating), preserving chip/curve order.
    setCurveSel((prev) =>
      prev.some((c) => c.family === family)
        ? prev.map((c) => (c.family === family ? { family, rating } : c))
        : [...prev, { family, rating }],
    );
  }, []);
  const removeCurve = useCallback(
    (id: string) => setCurveSel((prev) => prev.filter((c) => curveChipId(c.family) !== id)),
    [],
  );

  const previewColorOf = useCallback(
    (inst: SelectedInstrument) =>
      familyColor(inst.kind === "outright" ? inst.leg.sector : IRS_KEY),
    [],
  );

  // ── derived series/overlays ────────────────────────────────────────────────

  const overlay = useMemo(() => {
    const families = PREVIEW_FAMILIES.filter((key) => curveHas(key)).map((key) => ({
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
  }, [req, effDay, curveHas, swap.data, swap.isError, sectorQueries]);

  // ── 시계열형 series: the M2 path matrix, pure client math, no DOM/network ──
  const pathModel = useMemo(() => {
    if (!isPath) return null;
    return { evaluator, days: samplePathDays(req) };
  }, [isPath, evaluator, req]);

  const anchorVisible = pathSel.some((s) => s.family === ANCHOR_FAMILY && s.tenor === anchorTenor);

  const pathSeries = useMemo<LwSeriesDef[]>(() => {
    if (!isPath || !pathModel) return [];
    const { evaluator, days } = pathModel;

    const combos = pathSel
      .map(({ family, tenor }) => {
        const pillar = PATH_PILLARS.find((p) => p.label === tenor);
        if (!pillar) return null;
        return {
          key: family,
          // Shock/base family via the engine's own sectorToFamily (no forked
          // mapping): 국고채→국채, 공사채→특은채, 시은채→은행채, 여전채→카드채,
          // 회사채→회사채, IRS→swap.
          curve: sectorToFamily(family),
          pillar,
          isAnchor: family === ANCHOR_FAMILY && tenor === anchorTenor,
        };
      })
      .filter((c): c is NonNullable<typeof c> => c != null);
    // Anchor first: markers, the zero line, and the drag overlay ride series[0].
    combos.sort((a, b) => Number(b.isAnchor) - Number(a.isAnchor));

    const defs: LwSeriesDef[] = combos.map(({ key, curve, pillar, isAnchor }) => ({
      color: familyColor(key),
      lineWidth: isAnchor ? 2 : 1,
      // FB5 B2 — the crosshair-readout name (family + tenor).
      label: `${key} ${pillar.label}`,
      data: days.map((d) => ({
        time: dayToTime(baseDate, d),
        value: round2(evaluator.cumBpAt(curve, pillar.t, d)),
      })),
    }));

    if (evaluator.hasBokEvents) {
      defs.push({
        color: getSimulationChartTheme().axis,
        lineWidth: 2,
        dashed: true,
        label: "기준금리",
        data: days.map((d) => ({ time: dayToTime(baseDate, d), value: evaluator.bokCumBpAt(d) })),
      });
    }
    return defs;
    // N1: anchorTenor is a real input — it decides isAnchor (sort + width).
  }, [isPath, pathModel, pathSel, baseDate, anchorTenor]);

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
  const missingByFamily = PREVIEW_FAMILIES.filter((key) => curveHas(key))
    .map((key) => {
      const quotes = key === IRS_KEY ? swap.data ?? [] : sectorQueries[key].data ?? [];
      return { label: key, missing: quotes.filter((q) => q.rate === null).map((q) => q.label) };
    })
    .filter((m) => m.missing.length > 0);

  // FB5 B1 / FB5R R2 honesty — disclose the tier each RATED family's preview
  // curve reflects (the chip's chosen rating; never pass one tier off as the
  // whole sector).
  const ratingBySector = curveSel
    .filter((c): c is { family: FamilyKey; rating: string } => c.family !== IRS_KEY && !!c.rating)
    .map((c) => ({ label: c.family as string, rating: c.rating }));

  const loading =
    !isPath &&
    (swap.isLoading ||
      PREVIEW_FAMILIES.some((key) => key !== IRS_KEY && sectorQueries[key].isLoading));
  const hasPolicy = isPath && (pathModel?.evaluator.hasBokEvents ?? false);

  // Legends: unique families/tenors from the selection.
  const pathLegendFamilies = [...new Set(pathSel.map((s) => s.family))];
  const pathLegendTenors = [...new Set(pathSel.map((s) => s.tenor))];

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

      {/* FB5R R2 — the shared Rate History control row ([자산군][등급][테너][Add]
          + removable chips), the imported InstrumentSelector configured per mode.
          커브형: 테너 N/A, 등급 live for rated sectors. 시계열형: 등급 N/A, 테너
          from the path pillars. Colored by PVBP sector token so chips match the
          lines. */}
      <div className="mb-2">
        {isPath ? (
          <InstrumentSelector
            taxonomy={pathTaxonomy}
            selected={pathSelected}
            onAdd={addPath}
            onRemove={removePath}
            modes={["outright"]}
            showFilter={false}
            ratingDisabled
            colorOf={previewColorOf}
          />
        ) : (
          <InstrumentSelector
            taxonomy={curveTaxonomy}
            selected={curveSelected}
            onAdd={addCurve}
            onRemove={removeCurve}
            modes={["outright"]}
            showFilter={false}
            tenorDisabled
            colorOf={previewColorOf}
          />
        )}
      </div>

      {/* Shaped-scenario scrubber (커브형 only) — its own row so the selector
          above stays a clean RH control row. */}
      {!isPath && shaped && (
        <div className="mb-2 flex items-center justify-end gap-2">
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
              onCrosshairMove={setReadout}
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
          {/* FB5R R3 (owner ruling ④) — the per-series Δbp readout is an
              ALWAYS-PRESENT, reserved strip at the chart (its own bordered bar,
              not a footer merged with the legend): hovering fills it with the
              crosshair date + each series' plotted Δbp (never recomputed; a
              whitespace day reads —), and an idle hint keeps it discoverable so
              it can never read as "nothing there". The flow-level pin asserts
              this strip is present under default conditions. */}
          <div
            data-testid="path-crosshair-readout"
            className="mt-2 flex min-h-[1.5rem] flex-wrap items-center gap-x-3 gap-y-1 border-t border-border-subtle pt-1.5 text-micro"
          >
            {readout && readout.time != null ? (
              <>
                <span data-num className="font-bold text-fg-primary label-nowrap">
                  {formatCrosshairDate(readout.time)}
                </span>
                {readout.points.map((p, i) => (
                  <span
                    key={p.label ?? i}
                    data-num
                    className="inline-flex items-center gap-1.5 label-nowrap"
                  >
                    <span className="inline-block h-0.5 w-3" style={{ backgroundColor: p.color }} />
                    <span className="text-fg-muted">{p.label ?? "—"}</span>
                    <span className="text-fg-primary">
                      {p.value == null ? "—" : formatBpAxis(p.value)}
                    </span>
                  </span>
                ))}
              </>
            ) : (
              <span className="text-fg-dim">
                차트에 커서를 올리면 크로스헤어 날짜의 각 계열 Δbp가 여기에 표시됩니다
              </span>
            )}
          </div>
          {/* Legend: established family colors for the selected 곡선군. */}
          <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-micro">
            {pathLegendFamilies.map((key) => (
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
            테너 {pathLegendTenors.join("/")} 경로
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
            {PREVIEW_FAMILIES.filter((key) => curveHas(key)).map((key) => {
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
          {/* FB5 B1 / FB5R R2 honesty — the tier each rated family's preview
              curve reflects (the live 등급 choice; a single tier is never passed
              off as the whole sector). */}
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
