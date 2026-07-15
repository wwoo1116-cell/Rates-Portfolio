"use client";

/**
 * Dockview panel opened by Rate History's date-click (rate-history-chart.tsx),
 * receiving the clicked date's own market-rate point via dockview's addPanel
 * `params`. Traces a hypothetical IRS's cumulative PnL from that date to
 * today via POST /api/mtm/npv-trace (services/npv_trace_service.py).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { differenceInCalendarDays, parseISO } from "date-fns";
import type { IChartApi, ISeriesApi, MouseEventParams, SeriesMarker, ISeriesMarkersPluginApi } from "lightweight-charts";
import { LineSeries, createSeriesMarkers } from "lightweight-charts";
import type { IDockviewPanelProps } from "dockview-react";
import { LwChartBase } from "@/components/charts/lw-chart-base";
import { CrosshairReticle, formatCrosshairDate } from "@/components/charts/crosshair-reticle";
import { paneOffsetX, snapReticleToNearestSeries } from "@/components/charts/snap-reticle";
import { PNL_COLORS } from "@/lib/chart-colors";
import { formatPnlKrw } from "./pnl-format";
import { useMarketDataRange, useNpvTrace } from "@/hooks/use-api";
import { RATE_SERIES_OPTIONS, rateValue } from "@/lib/rate-history-helpers";
import type { RateHistoryPointOut, NpvTracePointOut } from "@/lib/api-client";

export interface PnlTracePanelParams {
  point: RateHistoryPointOut;
}

export function PnlTracePanel(props: IDockviewPanelProps<PnlTracePanelParams>) {
  const { point } = props.params;
  const rangeQuery = useMarketDataRange();
  const endDate = rangeQuery.data?.max_date ?? point.valuation_date;

  const [startDate, setStartDate] = useState(point.valuation_date);
  const [maturityDate, setMaturityDate] = useState("");
  const [irsRatePct, setIrsRatePct] = useState("");
  const [notional100M, setNotional100M] = useState("100"); // 100억 (10B KRW) default
  const [payFixed, setPayFixed] = useState(true);

  const npvTrace = useNpvTrace();
  const [traceChart, setTraceChart] = useState<IChartApi | null>(null);
  const traceSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const traceMarkersRef = useRef<ISeriesMarkersPluginApi<any> | null>(null);
  const [hoverData, setHoverData] = useState<
    { point: NpvTracePointOut; x: number; y: number; paneWidth: number } | null
  >(null);

  const tenorYears = useMemo(() => {
    if (!startDate || !maturityDate) return null;
    const days = differenceInCalendarDays(parseISO(maturityDate), parseISO(startDate));
    return days > 0 ? days / 365 : null;
  }, [startDate, maturityDate]);

  const fixedRate = irsRatePct === "" ? null : Number(irsRatePct);
  const notional = notional100M === "" ? null : Number(notional100M);
  const canTrace = tenorYears != null && fixedRate != null && Number.isFinite(fixedRate) && notional != null && Number.isFinite(notional);

  // Auto-trace once Start Date/Maturity Date/IRS Rate are all filled in --
  // no separate submit action per the work order ("once the user inputs the
  // IRS Rate, render the PnL Trace line graph").
  useEffect(() => {
    if (!canTrace) return;
    npvTrace.mutate({
      swap: {
        trade_date: startDate,
        tenor_years: tenorYears!,
        maturity_date: maturityDate,
        notional: notional! * 100_000_000,
        fixed_rate: fixedRate! / 100,
        pay_fixed: payFixed,
      },
      start_date: startDate,
      end_date: endDate,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canTrace, startDate, maturityDate, irsRatePct, notional100M, payFixed, endDate]);

  useEffect(() => {
    if (!npvTrace.data || !traceChart) return;
    if (!traceSeriesRef.current) {
      traceSeriesRef.current = traceChart.addSeries(LineSeries, {
        color: "#3B82F6", // --sem-info (canvas can't resolve CSS custom properties)
        lineWidth: 2,
        title: "Cumulative PnL",
        priceFormat: { type: "custom", formatter: formatPnlKrw },
      });
      traceMarkersRef.current = createSeriesMarkers(traceSeriesRef.current, []);
    }
    traceSeriesRef.current.setData(
      npvTrace.data.points.map((p) => ({ time: p.valuation_date, value: p.cumulative_pnl })) as never,
    );
    traceChart.timeScale().fitContent();

    if (npvTrace.data.points.length > 0) {
      let maxPoint = npvTrace.data.points[0];
      let minPoint = npvTrace.data.points[0];
      for (const p of npvTrace.data.points) {
        if (p.cumulative_pnl > maxPoint.cumulative_pnl) maxPoint = p;
        if (p.cumulative_pnl < minPoint.cumulative_pnl) minPoint = p;
      }
      const markers: SeriesMarker<any>[] = [];
      if (maxPoint) {
        markers.push({
          time: maxPoint.valuation_date as any,
          position: "aboveBar",
          color: PNL_COLORS.pos, // --chart-pnl-pos (chart P&L pair, S7)
          shape: "arrowDown",
          text: `Max: ${formatPnlKrw(maxPoint.cumulative_pnl)}`,
        });
      }
      if (minPoint && minPoint.valuation_date !== maxPoint.valuation_date) {
        markers.push({
          time: minPoint.valuation_date as any,
          position: "belowBar",
          color: PNL_COLORS.neg, // --chart-pnl-neg (chart P&L pair, S7)
          shape: "arrowUp",
          text: `Min: ${formatPnlKrw(minPoint.cumulative_pnl)}`,
        });
      }
      markers.sort((a, b) => (a.time as string).localeCompare(b.time as string));
      traceMarkersRef.current?.setMarkers(markers);
    }

    const handleCrosshair = (param: MouseEventParams) => {
      if (!param.time || param.point === undefined || !npvTrace.data) {
        setHoverData(null);
        return;
      }
      const timeStr = String(param.time);
      const point = npvTrace.data.points.find((p) => p.valuation_date === timeStr);
      if (point) {
        // Reticle snaps to the PnL line's data-point marker (see snap-reticle.ts,
        // same choice as rate-history-chart.tsx).
        const snapped = snapReticleToNearestSeries(traceChart, param, [traceSeriesRef.current]);
        const p = snapped ?? { x: param.point.x, y: param.point.y };
        setHoverData({
          point,
          x: p.x,
          y: p.y,
          paneWidth: paneOffsetX(traceChart) + traceChart.timeScale().width(),
        });
      } else {
        setHoverData(null);
      }
    };
    
    traceChart.subscribeCrosshairMove(handleCrosshair);

    return () => traceChart.unsubscribeCrosshairMove(handleCrosshair);
  }, [npvTrace.data, traceChart]);

  const lastPoint = npvTrace.data?.points.at(-1);

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-4">
      <div>
        <span className="text-h2 text-fg-primary">PnL Trace</span>
      </div>

      {/* Top: market rates for the clicked date */}
      <div className="flex flex-col gap-1.5 border-b border-border-subtle pb-3">
        <span className="text-label font-bold text-fg-muted uppercase">Market Rates -- {point.valuation_date}</span>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {RATE_SERIES_OPTIONS.map((opt) => {
            const value = rateValue(point, opt.key);
            return (
              <div key={opt.key} className="flex items-center justify-between gap-2">
                <span className="text-micro text-fg-muted">{opt.label}</span>
                <span className="text-body font-normal text-fg-primary">
                  {value != null ? `${(value * 100).toFixed(4)}%` : "—"}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Inputs */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-micro font-bold text-fg-muted">
          Start Date
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="h-7 w-36 border border-border-subtle bg-bg-elevated px-2 text-body font-normal text-fg-primary"
          />
        </label>
        <label className="flex flex-col gap-1 text-micro font-bold text-fg-muted">
          Maturity Date
          <input
            type="date"
            value={maturityDate}
            min={startDate}
            onChange={(e) => setMaturityDate(e.target.value)}
            className="h-7 w-36 border border-border-subtle bg-bg-elevated px-2 text-body font-normal text-fg-primary"
          />
        </label>
        <label className="flex flex-col gap-1 text-micro font-bold text-fg-muted">
          IRS Rate (%)
          <input
            type="number"
            step="0.001"
            value={irsRatePct}
            onChange={(e) => setIrsRatePct(e.target.value)}
            className="h-7 w-24 border border-border-subtle bg-bg-elevated px-2 text-body font-normal text-fg-primary"
          />
        </label>
        <label className="flex flex-col gap-1 text-micro font-bold text-fg-muted">
          Notional (억)
          <input
            type="number"
            step="10"
            value={notional100M}
            onChange={(e) => setNotional100M(e.target.value)}
            className="h-7 w-24 border border-border-subtle bg-bg-elevated px-2 text-body font-normal text-fg-primary"
          />
        </label>
        <div className="flex flex-col gap-1 text-micro font-bold text-fg-muted">
          Direction
          <div className="flex h-7 w-24 overflow-hidden rounded border border-border-subtle">
            <button
              onClick={() => setPayFixed(true)}
              className={`flex-1 transition-colors ${payFixed ? "bg-sem-negative text-bg-primary" : "bg-bg-elevated text-fg-muted hover:bg-bg-secondary"}`}
            >
              PAY
            </button>
            <button
              onClick={() => setPayFixed(false)}
              className={`flex-1 transition-colors ${!payFixed ? "bg-sem-positive text-bg-primary" : "bg-bg-elevated text-fg-muted hover:bg-bg-secondary"}`}
            >
              REC
            </button>
          </div>
        </div>
      </div>

      {npvTrace.isError && (
        <p className="text-micro text-sem-negative">
          {npvTrace.error instanceof Error ? npvTrace.error.message : "Could not trace this trade -- confirm the pricing server is reachable."}
        </p>
      )}

      {/* Bottom: PnL trace */}
      {npvTrace.data && (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex items-center gap-2 text-micro text-fg-muted border-b border-border-subtle pb-2">
            <span className="font-bold uppercase">Cumulative PnL as of {lastPoint?.valuation_date ?? endDate}</span>
            {/* Final-value badge for the trace chart — sign carries the chart
                P&L pair (Jade/Berry), not the app-wide sem tokens (S7). */}
            <span
              className={`font-normal ${
                lastPoint ? (lastPoint.cumulative_pnl >= 0 ? "text-chart-pnl-pos" : "text-chart-pnl-neg") : "text-fg-primary"
              }`}
            >
              {lastPoint ? `${formatPnlKrw(lastPoint.cumulative_pnl)} KRW` : "—"}
            </span>
          </div>
          <div className="relative min-h-0 flex-1">
            <LwChartBase onChartReady={(chart) => { setTraceChart(chart); traceSeriesRef.current = null; }} />
            <CrosshairReticle
              point={hoverData ? { x: hoverData.x, y: hoverData.y } : null}
              date={hoverData?.point.valuation_date}
              paneWidth={hoverData?.paneWidth}
            />

            {/* Floating Tooltip */}
            {hoverData && (
              <div
                className="pointer-events-none absolute z-50 flex flex-col gap-1.5 rounded border border-border-subtle bg-bg-secondary p-3 shadow-lg"
                style={{
                  left: hoverData.x,
                  top: hoverData.y,
                  transform: hoverData.x > 250 
                    ? "translate(calc(-100% - 15px), 15px)" 
                    : "translate(15px, 15px)",
                }}
              >
                <div className="flex items-center justify-between gap-6">
                  <span className="text-micro font-bold text-fg-muted uppercase">Date</span>
                  <span className="text-body font-bold text-fg-primary">
                    {formatCrosshairDate(hoverData.point.valuation_date)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-6">
                  <span className="text-micro font-bold text-fg-muted uppercase">Delta (DV01)</span>
                  <span className="text-micro font-normal text-fg-primary">
                    {hoverData.point.delta != null ? formatPnlKrw(hoverData.point.delta) : "—"} KRW
                  </span>
                </div>
                <div className="flex items-center justify-between gap-6">
                  <span className="text-micro font-bold text-fg-muted uppercase">Daily PnL</span>
                  {/* Chart-surface tooltip: chart P&L pair, not the app-wide sem tokens (S7) */}
                  <span className={`text-micro font-normal ${hoverData.point.daily_pnl >= 0 ? "text-chart-pnl-pos" : "text-chart-pnl-neg"}`}>
                    {formatPnlKrw(hoverData.point.daily_pnl)} KRW
                  </span>
                </div>
                <div className="flex items-center justify-between gap-6">
                  <span className="text-micro font-bold text-fg-muted uppercase">Cumulative</span>
                  <span className={`text-micro font-normal ${hoverData.point.cumulative_pnl >= 0 ? "text-chart-pnl-pos" : "text-chart-pnl-neg"}`}>
                    {formatPnlKrw(hoverData.point.cumulative_pnl)} KRW
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
