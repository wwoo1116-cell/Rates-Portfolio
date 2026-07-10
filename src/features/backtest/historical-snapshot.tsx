"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { IChartApi, ISeriesApi, MouseEventParams } from "lightweight-charts";
import { LineSeries } from "lightweight-charts";
import { LwChartBase } from "@/components/charts/lw-chart-base";
import { PriceDisplay } from "@/components/data/price-display";
import {
  HISTORICAL_RATE_SERIES,
  HISTORICAL_SCENARIOS,
  ORDER_BOOK_DEPTH,
  PROB_CONE,
  type OrderBookLevel,
  type ConeConfig,
} from "@/mocks/backtest-snapshot";

// ── Constants ───────────────────────────────────────────────────────────────
const DEPTH_BAR_MAX_W = 36;  // px — max histogram bar width on left Y axis
const DEPTH_BAR_H     = 6;   // px per price level bar
const CONE_ALPHA_1    = 0.18;
const CONE_ALPHA_2    = 0.09;

// ── Crosshair tooltip ────────────────────────────────────────────────────────
interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  date: string;
  values: { label: string; value: number; color: string }[];
}

// ── Order-book depth histogram (Canvas overlay, left Y axis) ─────────────────
function drawDepthHistogram(
  canvas: HTMLCanvasElement,
  depth: OrderBookLevel[],
  series: ISeriesApi<"Line"> | null,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.width / dpr;
  const H   = canvas.height / dpr;
  ctx.clearRect(0, 0, W * dpr, H * dpr);

  const maxSize = Math.max(...depth.map((d) => d.size), 1);

  depth.forEach(({ price, size, side }) => {
    // Convert price to chart-pixel Y
    const yCoord = series?.priceToCoordinate
      ? series.priceToCoordinate(price)
      : null;
    if (yCoord == null) return;

    const barW = (size / maxSize) * DEPTH_BAR_MAX_W;
    const barColor =
      side === "bid"
        ? `rgba(15, 153, 96,0.35)`   // green = bid
        : `rgba(219, 55, 55,0.35)`;  // red   = ask

    ctx.fillStyle = barColor;
    ctx.fillRect(0, yCoord * dpr - (DEPTH_BAR_H * dpr) / 2, barW * dpr, DEPTH_BAR_H * dpr);
  });
}

// ── Probability cone (Canvas overlay, over the chart) ────────────────────────
function drawProbCone(
  canvas: HTMLCanvasElement,
  cone: ConeConfig,
  chart: IChartApi,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.width / dpr;
  const H   = canvas.height / dpr;
  ctx.clearRect(0, 0, W * dpr, H * dpr);

  // Find pivot X coordinate by time
  const ts = chart.timeScale();
  const pivotX = ts.timeToCoordinate(cone.pivotDate as unknown as Parameters<typeof ts.timeToCoordinate>[0]);
  if (pivotX == null) return;

  const endX = W;
  const pivotY = H / 2;  // approximate center

  // σ bands: radiating trapezoids from pivot to right edge
  [[cone.sigma2, CONE_ALPHA_2], [cone.sigma1, CONE_ALPHA_1]].forEach(
    ([sigma, alpha]) => {
      const halfH = (sigma / 1.0) * (H * 0.35);  // scale band to chart height
      const grad  = ctx.createLinearGradient(pivotX, 0, endX, 0);
      grad.addColorStop(0, `rgba(19, 124, 189,0)`);
      grad.addColorStop(1, `rgba(19, 124, 189,${alpha})`);

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(pivotX * dpr, pivotY * dpr);
      ctx.lineTo(endX * dpr, (pivotY - halfH) * dpr);
      ctx.lineTo(endX * dpr, (pivotY + halfH) * dpr);
      ctx.closePath();
      ctx.fill();
    },
  );
}

// ── Component ────────────────────────────────────────────────────────────────
export function HistoricalSnapshot() {
  const chartApiRef    = useRef<IChartApi | null>(null);
  const coneCanvasRef  = useRef<HTMLCanvasElement>(null);
  const depthCanvasRef = useRef<HTMLCanvasElement>(null);
  const seriesRefs     = useRef<ISeriesApi<"Line">[]>([]);
  const containerRef   = useRef<HTMLDivElement>(null);

  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false, x: 0, y: 0, date: "", values: [],
  });

  const [activeScenarios, setActiveScenarios] = useState<Set<string>>(
    new Set(HISTORICAL_SCENARIOS.map((s) => s.id)),
  );

  const redrawOverlays = useCallback(() => {
    const chart = chartApiRef.current;
    const baseSeries = seriesRefs.current[0] || null;
    const coneCanvas  = coneCanvasRef.current;
    const depthCanvas = depthCanvasRef.current;
    if (!chart || !coneCanvas || !depthCanvas) return;
    drawProbCone(coneCanvas, PROB_CONE, chart);
    drawDepthHistogram(depthCanvas, ORDER_BOOK_DEPTH, baseSeries);
  }, []);

  const onChartReady = useCallback((chart: IChartApi) => {
    chartApiRef.current = chart;

    // Add scenario line series
    const refs: ISeriesApi<"Line">[] = [];
    HISTORICAL_SCENARIOS.forEach((scenario) => {
      const series = chart.addSeries(LineSeries, {
        color: scenario.color,
        lineWidth: scenario.id === "base" ? 2 : 1,
        lineStyle: scenario.id === "base" ? 0 : 1,  // base=solid, others=dashed
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 3,
        crosshairMarkerBorderColor: scenario.color,
        crosshairMarkerBackgroundColor: "#202B33",
      });
      series.setData(
        scenario.data.map((d) => ({ time: d.time as unknown as Parameters<typeof series.setData>[0][number]["time"], value: d.value })),
      );
      refs.push(series);
    });
    seriesRefs.current = refs;

    // Crosshair tooltip binding
    chart.subscribeCrosshairMove((params: MouseEventParams) => {
      if (!params.point || !params.time) {
        setTooltip((t) => ({ ...t, visible: false }));
        return;
      }

      const values = HISTORICAL_SCENARIOS.map((scenario, i) => {
        const seriesData = params.seriesData.get(refs[i]);
        const value = seriesData
          ? ("value" in seriesData ? (seriesData as { value: number }).value : 0)
          : 0;
        return { label: scenario.label, value, color: scenario.color };
      });

      const chartWidth = chart.timeScale().width();
      const tooltipW = 160;
      const safeX = params.point.x + 12 + tooltipW > chartWidth 
        ? params.point.x - tooltipW - 12 
        : params.point.x + 12;

      setTooltip({
        visible: true,
        x: safeX,
        y: params.point.y,
        date: String(params.time),
        values,
      });

      redrawOverlays();
    });

    // Redraw overlays on scale changes
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => redrawOverlays());

    // Initial draw
    chart.timeScale().fitContent();
    setTimeout(redrawOverlays, 50);
  }, [redrawOverlays]);

  // Sync canvas sizes with container
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      const w = container.clientWidth;
      const h = container.clientHeight;
      [coneCanvasRef.current, depthCanvasRef.current].forEach((c) => {
        if (!c) return;
        c.width  = w * dpr;
        c.height = h * dpr;
        c.style.width  = `${w}px`;
        c.style.height = `${h}px`;
      });
      redrawOverlays();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [redrawOverlays]);

  const toggleScenario = (id: string) => {
    setActiveScenarios((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      // Show/hide series
      const idx = HISTORICAL_SCENARIOS.findIndex((s) => s.id === id);
      if (idx !== -1 && seriesRefs.current[idx]) {
        seriesRefs.current[idx].applyOptions({
          visible: !prev.has(id),
        });
      }
      return next;
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-surface)" }}>
      {/* ── Toolbar ──────────────────────────────────────────────────── */}
      <div
        style={{
          height: 36,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "0 12px",
          borderBottom: "1px solid var(--border-dim)",
          background: "var(--bg-header)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.07em",
            textTransform: "uppercase",
            color: "var(--fg-muted)",
          }}
        >
          KTB 10Y — Historical Snapshot
        </span>
        <div style={{ flex: 1 }} />
        {/* Scenario toggles */}
        {HISTORICAL_SCENARIOS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => toggleScenario(s.id)}
            style={{
              background: "transparent",
              border: `1px solid ${activeScenarios.has(s.id) ? s.color : "var(--border-dim)"}`,
              color: activeScenarios.has(s.id) ? s.color : "var(--fg-muted)",
              padding: "2px 8px",
              fontSize: 11,
              fontFamily: "var(--font-ui)",
              cursor: "pointer",
              opacity: activeScenarios.has(s.id) ? 1 : 0.5,
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* ── Chart area ───────────────────────────────────────────────── */}
      <div ref={containerRef} style={{ flex: 1, position: "relative", minHeight: 0 }}>
        {/* lightweight-charts canvas */}
        <LwChartBase
          onChartReady={onChartReady}
          style={{ position: "absolute", inset: 0 }}
        />

        {/* Probability cone overlay (Canvas) */}
        <canvas
          ref={coneCanvasRef}
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
          }}
        />

        {/* Order-book depth histogram overlay (left axis) */}
        <canvas
          ref={depthCanvasRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            bottom: 0,
            width: DEPTH_BAR_MAX_W + 4,
            pointerEvents: "none",
          }}
        />

        {/* In-context crosshair tooltip */}
        {tooltip.visible && (
          <div
            style={{
              position: "absolute",
              left: tooltip.x,
              top: Math.max(tooltip.y - 16, 4),
              background: "rgba(32, 43, 51, 0.88)",
              border: "1px solid var(--border-subtle)",
              padding: "6px 10px",
              pointerEvents: "none",
              zIndex: 10,
              minWidth: 140,
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: "var(--fg-muted)",
                marginBottom: 4,
                fontFamily: "var(--font-ui)",
                letterSpacing: "0.05em",
              }}
            >
              {tooltip.date}
            </div>
            {tooltip.values.map((v) => <div
                key={v.label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 16,
                  alignItems: "baseline",
                }}
              >
                <span style={{ color: v.color, fontSize: 12, fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>{v.label}</span>
                <PriceDisplay value={v.value} unit="%" />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Legend / status bar ──────────────────────────────────────── */}
      <div
        style={{
          height: 24,
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "0 12px",
          borderTop: "1px solid var(--border-dim)",
          background: "var(--bg-header)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 10, color: "var(--fg-muted)", fontFamily: "var(--font-ui)" }}>
          {HISTORICAL_RATE_SERIES.length} trading days · KTB 10Y daily close
        </span>
        <div
          style={{
            width: 8,
            height: 1,
            background: "rgba(19, 124, 189,0.18)",
            border: "none",
            display: "inline-block",
          }}
        />
        <span style={{ fontSize: 10, color: "var(--fg-muted)" }}>±1σ cone</span>
        <div
          style={{
            width: 8,
            height: 1,
            background: "rgba(19, 124, 189,0.09)",
            display: "inline-block",
          }}
        />
        <span style={{ fontSize: 10, color: "var(--fg-muted)" }}>±2σ cone</span>
      </div>
    </div>
  );
}
