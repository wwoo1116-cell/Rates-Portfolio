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
 * Chart mechanics (series diffing, crosshair reticle, dual-axis snapping,
 * click resolution) live in the canonical SeriesChart (S7 extraction); this
 * host keeps only the data plumbing and the click ROUTING policy: clicking a
 * spread line opens the Position sizer, anything else opens PnL Trace with
 * that date's raw market point. Pills stay off — the InstrumentSelector's
 * removable chips already fill that role on this panel.
 */
import { useCallback, useMemo, useState } from "react";
import type { DockviewApi } from "dockview-react";
import { ChartFrame } from "@/components/charts/chart-frame";
import { CHART_CHROME_COLORS } from "@/lib/chart-colors";
import {
  SeriesChart,
  type SeriesChartClickContext,
  type SeriesChartReadout,
  type SeriesChartSeriesDef,
} from "@/components/charts/series-chart";
import { rateFormatter } from "@/components/charts/series-defaults";
import { InstrumentSelector } from "@/components/ui/instrument-selector";
import { useCreditCurveSeries, useCreditCurveTaxonomy, useMarketDataRange, useRateHistory } from "@/hooks/use-api";
import {
  buildInstrumentSeries,
  creditLegsOf,
  outrightId,
  traceSeriesContextAt,
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

// A couple of IRS outrights by default (resolve from rate-history immediately,
// no credit fetch needed) so the chart isn't blank on first load.
function defaultOutright(tenor: string): SelectedInstrument {
  const leg: Leg = { sector: "IRS", rating: null, tenor };
  return { kind: "outright", id: outrightId(leg), leg };
}
const DEFAULT_INSTRUMENTS: SelectedInstrument[] = [defaultOutright("3Y"), defaultOutright("10Y")];

// FB5R R1 — the IRS 3Y/10Y benchmark pair the crosshair readout ALWAYS surfaces
// (owner ruling ②): the tenor + the outright id it would carry if charted, so a
// benchmark whose series is already on the chart is shown once (as the colored
// series) rather than duplicated. Values come from the already-loaded
// rate-history points (no new endpoint) — honest — when a tenor has no quote.
const BENCHMARK_TENORS = ["3Y", "10Y"] as const;
const benchmarkId = (tenor: string) => outrightId({ sector: "IRS", rating: null, tenor });

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

  // FB5R R1 — the crosshair-bound rate readout (owner ruling ②). `hover` tracks
  // the live crosshair; `pinned` holds the last clicked/traced date so the row
  // persists after the cursor leaves. Both carry the chart's OWN plotted values
  // (SeriesChart sources them from param.seriesData); the benchmark pair is
  // layered on from `points` at render. hover wins while it exists.
  const [hoverReadout, setHoverReadout] = useState<SeriesChartReadout | null>(null);
  const [pinnedReadout, setPinnedReadout] = useState<SeriesChartReadout | null>(null);

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

  const chartSeries = useMemo<SeriesChartSeriesDef[]>(
    () =>
      builtSeries.map((b, i) => ({
        id: b.id,
        // Same string the pre-extraction series passed as its lw `title`, so
        // the price-scale badge text is pixel-identical.
        label: b.kind === "spread" ? `${b.label} (bp)` : b.label,
        color: b.color,
        data: b.lineData as SeriesChartSeriesDef["data"],
        lineWidth: (b.kind === "spread" ? 1 : 2) as 1 | 2,
        priceScaleId: b.priceScaleId as "left" | "right",
        valueKind: (b.kind === "spread" ? "bp" : "rate") as SeriesChartSeriesDef["valueKind"],
        // Badge collision policy (s14): with 3+ instruments overlaid, only the
        // first selected one keeps its last-value badge.
        primary: i === 0,
      })),
    [builtSeries],
  );

  // SeriesChart keeps the latest onClick in a ref, so this callback can read
  // fresh state directly — no instrumentsRef/pointsRef/apiRef dance.
  const handleClick = useCallback(
    ({ date, nearest, readout }: SeriesChartClickContext) => {
      if (!date) return;
      // Pin the readout to the clicked date so the row survives the cursor
      // leaving the chart (same-source values from the click's param.seriesData).
      setPinnedReadout(readout);
      if (!api) return;
      const reference = api.getPanel(RATES_PANEL_ID);
      const position = reference
        ? ({ referencePanel: RATES_PANEL_ID, direction: "right" } as const)
        : undefined;

      // Clicking ON a SPREAD line (within the hit radius) opens the position
      // sizer for that spread at that date (B4); everything else -- outright
      // lines and empty chart area -- keeps the original raw-market PnL Trace.
      const clicked =
        nearest && nearest.dist <= SERIES_CLICK_RADIUS_PX
          ? instruments.find((i) => i.id === nearest.id)
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

      const point = points.find((p) => p.valuation_date === date);
      if (!point) return;
      api.getPanel(PNL_TRACE_PANEL_ID)?.api.close();
      api.addPanel({
        id: PNL_TRACE_PANEL_ID,
        component: "pnltrace",
        title: "PnL Trace",
        // A1: carry every currently-charted series' value AT this date (drawn
        // from the same builtSeries the chart plots) so the panel's traced-date
        // context is same-source, not a re-fetch.
        params: { point, seriesContext: traceSeriesContextAt(builtSeries, date) },
        position,
      });
    },
    [api, instruments, points, builtSeries],
  );

  const addInstrument = useCallback((inst: SelectedInstrument) => {
    setInstruments((prev) => (prev.some((p) => p.id === inst.id) ? prev : [...prev, inst]));
  }, []);
  const removeInstrument = useCallback((id: string) => {
    setInstruments((prev) => prev.filter((p) => p.id !== id));
  }, []);

  // FB5R R1 — compose the crosshair readout row: the IRS 3Y/10Y BENCHMARK pair
  // (from the already-loaded points, always shown — deduped against any charted
  // series of the same tenor so a benchmark that IS charted appears once, as its
  // colored series) plus EVERY charted series' own value (drawn from the chart's
  // param.seriesData via SeriesChart, so it is same-source with the lines). hover
  // wins over the pinned (traced-date) row while the cursor is on the chart.
  const active = hoverReadout ?? pinnedReadout;
  const readoutRow = useMemo(() => {
    if (!active?.date) return null;
    const chartedIds = new Set(active.points.map((p) => p.id));
    const point = points.find((p) => p.valuation_date === active.date);
    const benchmarks = BENCHMARK_TENORS.filter((t) => !chartedIds.has(benchmarkId(t))).map((t) => {
      const v = point?.tenor_rates?.[t];
      const val = v != null && Number.isFinite(v) ? v : null;
      return { id: benchmarkId(t), label: `IRS ${t}`, text: val == null ? null : rateFormatter(val) };
    });
    return { date: active.date, benchmarks, series: active.points };
  }, [active, points]);

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

      {/* Chart container is ALWAYS in the DOM — error/loading shown as overlay.
          ChartFrame is that relative container (S10): maximize/detach controls
          on hover; the detached window re-mounts this same panel and refetches
          from the shared query cache (no snapshot needed). */}
      <ChartFrame chartId="rates-history" title="Rate History" className="min-h-0 flex-1">
        <SeriesChart series={chartSeries} onClick={handleClick} onCrosshairMove={setHoverReadout} />

        {isLoading && !isError && (
          <div
            style={{
              position: "absolute", inset: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: CHART_CHROME_COLORS.scrimLightStale,
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
              background: CHART_CHROME_COLORS.scrimHeavyStale,
              fontSize: 12, color: "var(--fg-muted)", fontFamily: "var(--font-ui)",
            }}
          >
            Could not load rate history — confirm the pricing server is reachable.
          </div>
        )}
      </ChartFrame>

      {/* FB5R R1 (owner ruling ②) — crosshair-bound rate readout AT the chart:
          hovering shows the crosshair date's IRS 3Y/10Y benchmark pair + every
          charted series' own rate (label + color); clicking a date pins it. The
          strip is always present (reserved, discoverable) with an idle hint, so
          it never reads as "nothing there". */}
      <div
        data-testid="rh-rate-readout"
        className="flex min-h-[1.75rem] flex-wrap items-center gap-x-3 gap-y-1 border-t border-border-subtle px-1 pt-2 text-micro"
      >
        {readoutRow ? (
          <>
            <span className="font-bold tabular-nums text-fg-primary">{readoutRow.date}</span>
            {readoutRow.benchmarks.length > 0 && (
              <span className="inline-flex items-center gap-2 label-nowrap">
                <span className="text-label uppercase text-fg-dim">기준</span>
                {readoutRow.benchmarks.map((b) => (
                  <span key={b.id} className="inline-flex items-center gap-1 label-nowrap">
                    <span className="text-fg-muted">{b.label}</span>
                    <span className="tabular-nums text-fg-secondary">{b.text ?? "—"}</span>
                  </span>
                ))}
              </span>
            )}
            {readoutRow.series.length > 0 && (
              <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
                {readoutRow.series.map((s) => (
                  <span key={s.id} className="inline-flex items-center gap-1.5 label-nowrap">
                    <span
                      className="inline-block h-2 w-2 shrink-0 border border-border-subtle"
                      style={{ backgroundColor: s.color }}
                    />
                    <span className="text-fg-muted">{s.label}</span>
                    <span className="tabular-nums text-fg-primary">{s.text ?? "—"}</span>
                  </span>
                ))}
              </span>
            )}
          </>
        ) : (
          <span className="text-fg-dim">
            차트에 커서를 올리거나 날짜를 클릭하면 그 날짜의 IRS 3Y·10Y 기준금리와 각 계열 금리가 표시됩니다
          </span>
        )}
      </div>
    </div>
  );
}
