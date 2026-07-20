"use client";

import { useCallback, useRef, useState } from "react";
import type { IChartApi, MouseEventParams } from "lightweight-charts";
import { LineSeries } from "lightweight-charts";
import { LwChartBase } from "@/components/charts/lw-chart-base";
import { CrosshairReticle, formatCrosshairDate } from "@/components/charts/crosshair-reticle";
import { CHART_CHROME_COLORS, PNL_COLORS, withAlpha } from "@/lib/chart-colors";
import { getSimulationChartTheme } from "./lib/chart-theme";
import { NumericCell } from "@/components/ui/numeric-cell";
import { PriceDisplay } from "@/components/data/price-display";
import {
  PRICER_RATE_SERIES,
  PRICER_INPUTS,
  computePricerResults,
  type PricerInput,
} from "@/lib/placeholder-data/pricer";

// Reticle tooltip state
interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  date: string;
  mid: number;
  bid: number;
  ask: number;
  paneWidth: number;
}

export function PricerPage() {
  const chartApiRef = useRef<IChartApi | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false, x: 0, y: 0, date: "", mid: 0, bid: 0, ask: 0, paneWidth: 0,
  });
  const [inputs, setInputs] = useState<PricerInput[]>(PRICER_INPUTS);

  // Latest market rate from series end
  const latestRate = PRICER_RATE_SERIES[PRICER_RATE_SERIES.length - 1].value;
  const [marketRate, setMarketRate] = useState(latestRate);
  const results = computePricerResults(inputs, marketRate);

  // Build a lookup map for bid/ask
  const rateMap = Object.fromEntries(
    PRICER_RATE_SERIES.map((d) => [d.time, d]),
  );

  const onChartReady = useCallback((chart: IChartApi) => {
    chartApiRef.current = chart;

    // Mid line (accent). iv3: lightweight-charts renders to canvas, which
    // CANNOT resolve var(--...) — the old "var(--accent)" literals fell back
    // to the library default color (same defect class as s10's MtM chart).
    // Canvas-bound options take resolved values only (chart-colors mirrors /
    // resolveCssVar); guarded by scripts/check_canvas_var_colors.test.ts.
    const midSeries = chart.addSeries(LineSeries, {
      color: CHART_CHROME_COLORS.accentLine,
      lineWidth: 2,
      lineStyle: 0,
      priceLineVisible: true,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      crosshairMarkerBorderColor: CHART_CHROME_COLORS.accentLine,
      crosshairMarkerBackgroundColor: getSimulationChartTheme().background, // --bg-surface
      title: "IRS 5Y Mid",
    });
    midSeries.setData(
      PRICER_RATE_SERIES.map((d) => ({
        time: d.time as unknown as Parameters<typeof midSeries.setData>[0][number]["time"],
        value: d.value,
      })),
    );

    // Bid line (dimmer) — chart P&L pair (Jade/Berry replace green/red on
    // chart surfaces, S7), alpha-dimmed against the mid line.
    const bidSeries = chart.addSeries(LineSeries, {
      color: withAlpha(PNL_COLORS.pos, 0.55),
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      title: "Bid",
    });
    bidSeries.setData(
      PRICER_RATE_SERIES.map((d) => ({
        time: d.time as unknown as Parameters<typeof bidSeries.setData>[0][number]["time"],
        value: d.bid,
      })),
    );

    // Ask line (dimmer)
    const askSeries = chart.addSeries(LineSeries, {
      color: withAlpha(PNL_COLORS.neg, 0.55),
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      title: "Ask",
    });
    askSeries.setData(
      PRICER_RATE_SERIES.map((d) => ({
        time: d.time as unknown as Parameters<typeof askSeries.setData>[0][number]["time"],
        value: d.ask,
      })),
    );

    // Fixed rate reference line
    const fixedRate = inputs.find((i) => i.key === "fixedRate")?.value ?? 2.650;
    chart.addSeries(LineSeries, {
      color: "rgba(255,255,255,0.25)",
      lineWidth: 1,
      lineStyle: 3,           // dotted
      priceLineVisible: false,
      lastValueVisible: false,
      title: `Strike ${fixedRate.toFixed(3)}%`,
    }).setData(
      PRICER_RATE_SERIES.map((d) => ({
        time: d.time as unknown as Parameters<typeof midSeries.setData>[0][number]["time"],
        value: fixedRate,
      })),
    );

    // Crosshair tooltip
    chart.subscribeCrosshairMove((params: MouseEventParams) => {
      if (!params.point || !params.time) {
        setTooltip((t) => ({ ...t, visible: false }));
        return;
      }
      const dateStr = String(params.time);
      const row     = rateMap[dateStr];
      if (!row) return;

      setMarketRate(row.value);
      const chartWidth = chart.timeScale().width();
      const tooltipW = 130;
      const safeX = params.point.x + 12 + tooltipW > chartWidth
        ? params.point.x - tooltipW - 12
        : params.point.x + 12;

      // Reticle follows the raw cursor position exactly -- not snapped to
      // the Mid series line (see rate-history-chart.tsx's identical choice).
      setTooltip({
        visible: true,
        x: safeX,
        y: params.point.y,
        date: dateStr,
        mid: row.value,
        bid: row.bid,
        ask: row.ask,
        paneWidth: chartWidth,
      });
    });

    chart.timeScale().fitContent();
  }, [inputs, rateMap]);

  const updateInput = (key: string, value: number) => {
    setInputs((prev) => prev.map((inp) => (inp.key === key ? { ...inp, value } : inp)));
  };

  return (
    <div style={{ display: "flex", height: "100%", background: "var(--bg-surface)" }}>
      {/* ── Left: Chart ───────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Toolbar */}
        <div
          style={{
            height: 36,
            display: "flex",
            alignItems: "center",
            padding: "0 12px",
            borderBottom: "1px solid var(--border-dim)",
            background: "var(--bg-header)",
            flexShrink: 0,
            gap: 12,
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--fg-muted)" }}>
            IRS 5Y KRW — Pricer
          </span>
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 12, color: "var(--fg-secondary)" }}>Mid:</span>
            <PriceDisplay value={latestRate} unit="%" />
          </div>
        </div>

        {/* Chart with crosshair tooltip overlay */}
        <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
          <LwChartBase
            onChartReady={onChartReady}
            style={{ position: "absolute", inset: 0 }}
          />
          <CrosshairReticle
            point={tooltip.visible ? { x: tooltip.x, y: tooltip.y } : null}
            date={tooltip.visible ? tooltip.date : undefined}
            paneWidth={tooltip.paneWidth}
          />
          {tooltip.visible && (
            <div
              style={{
                position: "absolute",
                left: tooltip.x,
                top: Math.max(tooltip.y - 20, 4),
                background: "rgba(32, 43, 51, 0.88)",
                border: "1px solid var(--border-subtle)",
                padding: "6px 10px",
                pointerEvents: "none",
                zIndex: 10,
                minWidth: 130,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--fg-primary)", marginBottom: 4, fontFamily: "var(--font-ui)", letterSpacing: "0.02em" }}>
                {formatCrosshairDate(tooltip.date)}
              </div>
              {[
                { label: "Mid", value: tooltip.mid, color: "var(--accent)" },
                // iv3: Jade/Berry universal pair (bid was green, ask red) —
                // retired sem-* aliases deleted at integration.
                { label: "Bid", value: tooltip.bid, color: "var(--chart-pnl-pos)" },
                { label: "Ask", value: tooltip.ask, color: "var(--chart-pnl-neg)" },
              ].map(({ label, value, color }) => (
                <div
                  key={label}
                  style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
                >
                  <span style={{ color, fontSize: 12, fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>{label}</span>
                  <PriceDisplay value={value} unit="%" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Right: Pricer inputs + results ─────────────────────────── */}
      <div
        style={{
          width: 220,
          flexShrink: 0,
          borderLeft: "1px solid var(--border-dim)",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-raised)",
        }}
      >
        {/* Inputs */}
        <div
          style={{
            padding: "8px 10px",
            borderBottom: "1px solid var(--border-dim)",
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--fg-muted)", marginBottom: 8 }}>
            Inputs
          </div>
          {inputs.map((inp) => (
            <div key={inp.key} style={{ marginBottom: 8 }}>
              <label
                style={{ display: "block", fontSize: 10, color: "var(--fg-muted)", marginBottom: 2, fontFamily: "var(--font-ui)" }}
              >
                {inp.label}
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <input
                  type="number"
                  value={inp.value}
                  step={inp.step}
                  onChange={(e) => updateInput(inp.key, Number(e.target.value))}
                  style={{
                    flex: 1,
                    background: "var(--bg-overlay)",
                    border: "1px solid var(--border-subtle)",
                    color: "var(--fg-primary)",
                    fontFamily: "var(--font-mono)",
                    fontVariantNumeric: "tabular-nums",
                    fontSize: 12,
                    padding: "2px 6px",
                    height: 24,
                    width: "100%",
                    outline: "none",
                  }}
                />
                <span style={{ fontSize: 10, color: "var(--fg-muted)", minWidth: 20 }}>{inp.unit}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Results */}
        <div style={{ padding: "8px 10px", flex: 1 }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--fg-muted)", marginBottom: 8 }}>
            Results
          </div>
          {results.map((r) => (
            <div key={r.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, borderBottom: "1px solid var(--border-dim)", paddingBottom: 4 }}>
              <span style={{ fontSize: 11, color: "var(--fg-muted)", fontFamily: "var(--font-ui)" }}>
                {r.label}
              </span>
              <NumericCell
                value={r.value}
                suffix={r.unit}
                signed={r.signed}
                precision={r.label.includes("Rate") ? 3 : r.label.includes("DV01") ? 2 : 2}
                neutral={!r.signed}
              />
            </div>
          ))}
        </div>

        <div
          style={{
            padding: "6px 10px",
            borderTop: "1px solid var(--border-dim)",
            fontSize: 10,
            color: "var(--fg-dim)",
            fontFamily: "var(--font-ui)",
          }}
        >
          Simplified mock — no model backend
        </div>
      </div>
    </div>
  );
}
