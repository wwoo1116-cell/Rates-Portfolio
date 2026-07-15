"use client";

/**
 * Rates History RV chart: GET /api/rate-history (CD91D/IRS-tenor/BOK-base
 * daily series) plus GET/POST /api/credit-curve (국고채 + rated credit
 * sectors). A dynamic instrument selector (InstrumentSelector) lets the user
 * overlay any number of outright yields (% on the right axis) and spreads
 * (bp on the left axis) -- curve spreads within one instrument or
 * inter-market spreads across instruments -- replacing the old fixed toggle
 * row.
 *
 * The chart container is ALWAYS mounted regardless of loading/error state so
 * the lightweight-charts instance is never destroyed and re-created mid-session
 * (which would lose the subscribeClick registration). Clicking a date still
 * opens the PnL Trace dockview panel with that date's raw market point.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DockviewApi } from "dockview-react";
import type { IChartApi, ISeriesApi, MouseEventParams } from "lightweight-charts";
import { LineSeries } from "lightweight-charts";
import { LwChartBase, rateFormatter } from "@/components/charts/lw-chart-base";
import { CrosshairReticle, type CrosshairReticlePoint } from "@/components/charts/crosshair-reticle";
import { paneOffsetX, seriesDistanceY, snapReticleToNearestSeries } from "@/components/charts/snap-reticle";
import { InstrumentSelector } from "@/components/rate-history/instrument-selector";
import { useCreditCurveSeries, useCreditCurveTaxonomy, useMarketDataRange, useRateHistory } from "@/hooks/use-api";
import {
  buildInstrumentSeries,
  creditLegsOf,
  outrightId,
  type Leg,
  type SelectedInstrument,
} from "@/lib/rv-instruments";

const PNL_TRACE_PANEL_ID = "home-pnltrace-panel";
const SPREAD_POSITION_PANEL_ID = "home-spread-position-panel";
const RATES_PANEL_ID = "home-rates-panel";

/** A click only counts as "on a series" within this vertical distance of the
 * line. Beyond it, the click is a plain date-click and keeps the original PnL
 * Trace behavior -- without a cap, a chart showing only spreads would route
 * EVERY click to the Position panel and make PnL Trace unreachable. */
const SERIES_CLICK_RADIUS_PX = 24;

/**
 * Which plotted series did the click land nearest, and how far away?
 *
 * lightweight-charts' click reports a time and a pixel point but not a series,
 * and this chart overlays several. seriesDistanceY resolves each candidate
 * through ITS OWN price scale (bp/left for spreads, %/right for outrights) --
 * the same shared rule snap-reticle's crosshair snapping uses.
 */
function nearestSeriesAtClick(
  param: MouseEventParams,
  seriesMap: Map<string, ISeriesApi<"Line">>,
): { id: string; dist: number } | null {
  let best: { id: string; dist: number } | null = null;
  for (const [id, series] of seriesMap) {
    const hit = seriesDistanceY(param, series);
    if (hit && (best == null || hit.dist < best.dist)) best = { id, dist: hit.dist };
  }
  return best;
}

// A couple of IRS outrights by default (resolve from rate-history immediately,
// no credit fetch needed) so the chart isn't blank on first load.
function defaultOutright(tenor: string): SelectedInstrument {
  const leg: Leg = { sector: "IRS", rating: null, tenor };
  return { kind: "outright", id: outrightId(leg), leg };
}
const DEFAULT_INSTRUMENTS: SelectedInstrument[] = [defaultOutright("3Y"), defaultOutright("10Y")];

const spreadFormatter = (v: number) => v.toFixed(2);

interface RateHistoryChartProps {
  api?: DockviewApi | null;
}

export function RateHistoryChart({ api }: RateHistoryChartProps) {
  const rangeQuery = useMarketDataRange();
  const minDate = rangeQuery.data?.min_date ?? "";
  const maxDate = rangeQuery.data?.max_date ?? "";

  const historyQuery = useRateHistory(minDate, maxDate);
  const points = useMemo(() => historyQuery.data?.points ?? [], [historyQuery.data]);

  const taxonomyQuery = useCreditCurveTaxonomy();

  const [instruments, setInstruments] = useState<SelectedInstrument[]>(DEFAULT_INSTRUMENTS);

  // Only the credit (non-IRS) legs need a backend fetch; IRS legs come from
  // the rate-history data already loaded above.
  const creditLegs = useMemo(() => creditLegsOf(instruments), [instruments]);
  const creditSeriesQuery = useCreditCurveSeries(creditLegs, minDate, maxDate);
  const creditResults = useMemo(
    () => creditSeriesQuery.data?.results ?? [],
    [creditSeriesQuery.data],
  );

  const builtSeries = useMemo(
    () => buildInstrumentSeries(instruments, points, creditResults),
    [instruments, points, creditResults],
  );

  const chartRef = useRef<IChartApi | null>(null);
  const seriesMapRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  const prevIdsRef = useRef<string>("");
  const [reticle, setReticle] = useState<
    (CrosshairReticlePoint & { date?: string; paneWidth: number }) | null
  >(null);

  // onChartReady is mounted once with empty deps (re-registering subscribeClick
  // would leak handlers), so anything the click needs is read through a ref.
  const instrumentsRef = useRef(instruments);
  useLayoutEffect(() => { instrumentsRef.current = instruments; }, [instruments]);

  const pointsRef = useRef(points);
  useLayoutEffect(() => { pointsRef.current = points; }, [points]);

  const apiRef = useRef(api);
  useLayoutEffect(() => { apiRef.current = api; }, [api]);

  const onChartReady = useCallback((chart: IChartApi) => {
    chartRef.current = chart;
    seriesMapRef.current = new Map();
    chart.subscribeClick((param) => {
      if (!param.time || !apiRef.current) return;
      const date = String(param.time);
      const api = apiRef.current;
      const reference = api.getPanel(RATES_PANEL_ID);
      const position = reference
        ? ({ referencePanel: RATES_PANEL_ID, direction: "right" } as const)
        : undefined;

      // Clicking ON a SPREAD line (within the hit radius) opens the position
      // sizer for that spread at that date (B4); everything else -- outright
      // lines and empty chart area -- keeps the original raw-market PnL Trace.
      const nearest = nearestSeriesAtClick(param, seriesMapRef.current);
      const clicked =
        nearest && nearest.dist <= SERIES_CLICK_RADIUS_PX
          ? instrumentsRef.current.find((i) => i.id === nearest.id)
          : undefined;
      if (clicked?.kind === "spread") {
        api.getPanel(SPREAD_POSITION_PANEL_ID)?.api.close();
        api.addPanel({
          id: SPREAD_POSITION_PANEL_ID,
          component: "spreadposition",
          title: "Position",
          params: { instrument: clicked, entryDate: date },
          position,
        });
        return;
      }

      const point = pointsRef.current.find((p) => p.valuation_date === date);
      if (!point) return;
      api.getPanel(PNL_TRACE_PANEL_ID)?.api.close();
      api.addPanel({
        id: PNL_TRACE_PANEL_ID,
        component: "pnltrace",
        title: "PnL Trace",
        params: { point },
        position,
      });
    });

    // Crosshair marker snapped to the nearest series' data point, each via its
    // own price scale (see snap-reticle.ts) so bp/left and %/right series stay
    // pixel-aligned on this dual-axis chart.
    chart.subscribeCrosshairMove((params: MouseEventParams) => {
      if (!params.point) {
        setReticle(null);
        return;
      }
      const date = params.time ? String(params.time) : undefined;
      const snapped = snapReticleToNearestSeries(chart, params, seriesMapRef.current.values());
      const p = snapped ?? { x: params.point.x, y: params.point.y };
      setReticle({ x: p.x, y: p.y, date, paneWidth: paneOffsetX(chart) + chart.timeScale().width() });
    });
  }, []);

  // One effect drives the whole multi-series overlay: diff the live
  // lightweight-charts series against the built list (add new, drop removed,
  // update data), set per-series axis + color + format, and toggle the left
  // (bp) axis based on whether any spread is present.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const seriesMap = seriesMapRef.current;
    const wantIds = new Set(builtSeries.map((b) => b.id));

    // Remove series no longer selected.
    for (const [id, series] of seriesMap) {
      if (!wantIds.has(id)) {
        chart.removeSeries(series);
        seriesMap.delete(id);
      }
    }

    // Add / update each selected series.
    for (const b of builtSeries) {
      let series = seriesMap.get(b.id);
      if (!series) {
        series = chart.addSeries(LineSeries, {
          color: b.color,
          lineWidth: b.kind === "spread" ? 1 : 2,
          title: b.kind === "spread" ? `${b.label} (bp)` : b.label,
          priceScaleId: b.priceScaleId,
          priceFormat: {
            type: "custom",
            formatter: b.kind === "spread" ? spreadFormatter : rateFormatter,
          },
        });
        seriesMap.set(b.id, series);
      }
      series.setData(b.lineData as never);
    }

    // Left (bp) axis visible only while at least one spread is plotted.
    const hasSpread = builtSeries.some((b) => b.priceScaleId === "left");
    chart.priceScale("left").applyOptions({ visible: hasSpread });

    // Refit only when the SET of instruments changes (not on every data
    // refresh), so a user's manual zoom isn't reset when credit data arrives.
    const idsKey = builtSeries.map((b) => b.id).sort().join("|");
    if (idsKey !== prevIdsRef.current) {
      prevIdsRef.current = idsKey;
      chart.timeScale().fitContent();
    }
  }, [builtSeries]);

  const addInstrument = useCallback((inst: SelectedInstrument) => {
    setInstruments((prev) => (prev.some((p) => p.id === inst.id) ? prev : [...prev, inst]));
  }, []);
  const removeInstrument = useCallback((id: string) => {
    setInstruments((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const isLoading = rangeQuery.isLoading || historyQuery.isLoading;
  const isError = rangeQuery.isError || historyQuery.isError;

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <span className="text-h2 text-fg-primary">Rate History</span>
        <span className="text-micro text-fg-muted">
          {minDate && maxDate
            ? `${minDate} – ${maxDate} · ${points.length.toLocaleString()} sessions · click a date to trace PnL`
            : "Click a date to trace a hypothetical trade’s PnL to today"}
        </span>
      </div>

      <InstrumentSelector
        taxonomy={taxonomyQuery.data}
        selected={instruments}
        onAdd={addInstrument}
        onRemove={removeInstrument}
      />

      {/* Chart container is ALWAYS in the DOM — error/loading shown as overlay */}
      <div className="relative min-h-0 flex-1">
        <LwChartBase onChartReady={onChartReady} />
        <CrosshairReticle point={reticle} date={reticle?.date} paneWidth={reticle?.paneWidth} />

        {isLoading && !isError && (
          <div
            style={{
              position: "absolute", inset: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(22,28,38,0.75)",
              fontSize: 12, color: "var(--fg-muted)", fontFamily: "var(--font-ui)",
              letterSpacing: "0.05em",
            }}
          >
            Loading rate history…
          </div>
        )}

        {isError && (
          <div
            style={{
              position: "absolute", inset: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(22,28,38,0.85)",
              fontSize: 12, color: "var(--fg-muted)", fontFamily: "var(--font-ui)",
            }}
          >
            Could not load rate history — confirm the pricing server is reachable.
          </div>
        )}
      </div>
    </div>
  );
}
