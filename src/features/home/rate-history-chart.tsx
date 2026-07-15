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
import { ChartFrame } from "@/components/chart/ChartFrame";
import { rateFormatter } from "@/components/charts/lw-chart-base";
import {
  SeriesChart,
  type SeriesChartClickContext,
  type SeriesChartSeriesDef,
} from "@/components/charts/series-chart";
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

  const chartSeries = useMemo<SeriesChartSeriesDef[]>(
    () =>
      builtSeries.map((b) => ({
        id: b.id,
        // Same string the pre-extraction series passed as its lw `title`, so
        // the price-scale badge text is pixel-identical.
        label: b.kind === "spread" ? `${b.label} (bp)` : b.label,
        color: b.color,
        data: b.lineData as SeriesChartSeriesDef["data"],
        lineWidth: (b.kind === "spread" ? 1 : 2) as 1 | 2,
        priceScaleId: b.priceScaleId as "left" | "right",
        formatter: b.kind === "spread" ? spreadFormatter : rateFormatter,
      })),
    [builtSeries],
  );

  // SeriesChart keeps the latest onClick in a ref, so this callback can read
  // fresh state directly — no instrumentsRef/pointsRef/apiRef dance.
  const handleClick = useCallback(
    ({ date, nearest }: SeriesChartClickContext) => {
      if (!date || !api) return;
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
        params: { point },
        position,
      });
    },
    [api, instruments, points],
  );

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

      {/* Chart container is ALWAYS in the DOM — error/loading shown as overlay.
          ChartFrame is that relative container (S10): maximize/detach controls
          on hover; the detached window re-mounts this same panel and refetches
          from the shared query cache (no snapshot needed). */}
      <ChartFrame chartId="rates-history" title="Rate History" className="min-h-0 flex-1">
        <SeriesChart series={chartSeries} onClick={handleClick} />

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
      </ChartFrame>
    </div>
  );
}
