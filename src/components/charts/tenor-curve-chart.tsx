"use client";

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import type { CurvePoint } from "@/mocks/home";
import type { Tenor } from "@/lib/constants";
import { resolveCssVar } from "@/lib/canvas-color";
import { CHART_CHROME_COLORS, PNL_COLORS } from "@/lib/chart-colors";

export interface TenorCurveChartProps {
  data: CurvePoint[];
  tenors: readonly Tenor[];
  unit?: string;
}

// Layout constants
const ML = 46;   // margin left (y-axis labels)
const MR = 12;   // margin right
const MT = 10;   // margin top
const SHIFT_GAP    = 8;
const SHIFT_HEIGHT = 14;
const LABEL_GAP    = 6;
const LABEL_HEIGHT = 14;
const MB = SHIFT_GAP + SHIFT_HEIGHT + LABEL_GAP + LABEL_HEIGHT;

// Canvas can't resolve CSS custom properties -- COLOR_TODAY/POSITIVE/NEGATIVE
// are read from the actual computed token values at draw time (see drawChart).
const COLOR_YESTERDAY = "rgba(160,170,184,0.50)";    // fg-secondary dimmed
const COLOR_GRID      = "rgba(255,255,255,0.07)";    // border-dim
const COLOR_AXIS_TEXT = CHART_CHROME_COLORS.axisTextStale;
const FONT_LABEL      = "11px Inter, system-ui, sans-serif";

function drawChart(
  canvas: HTMLCanvasElement,
  data: CurvePoint[],
  tenors: readonly Tenor[],
  unit: string,
) {
  const dpr = window.devicePixelRatio || 1;
  const { clientWidth: cssW, clientHeight: cssH } = canvas;
  canvas.width  = cssW * dpr;
  canvas.height = cssH * dpr;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);

  const colorToday = resolveCssVar("--accent");
  // S12: Jade/Berry signed pair as canvas literals (component is currently
  // unmounted; migrated so no green/red survives a resurrection).
  const colorPositive = PNL_COLORS.pos;
  const colorNegative = PNL_COLORS.neg;

  const W = cssW;
  const H = cssH;
  ctx.clearRect(0, 0, W, H);

  const innerW = Math.max(W - ML - MR, 0);
  const chartH = Math.max(H - MT - MB, 0);

  // Scales
  const x = d3
    .scalePoint<Tenor>()
    .domain(tenors)
    .range([ML, ML + innerW])
    .padding(0.5);

  const values = data.flatMap((d) => [d.today, d.yesterday]);
  const yMin = Math.min(...values);
  const yMax = Math.max(...values);
  const yPad = (yMax - yMin) * 0.25 || 0.1;
  const y = d3
    .scaleLinear()
    .domain([yMin - yPad, yMax + yPad])
    .range([MT + chartH, MT])
    .nice();

  const yTicks = y.ticks(4);

  // ── 1. Horizontal grid lines ──────────────────────────────
  ctx.strokeStyle = COLOR_GRID;
  ctx.lineWidth = 1;
  yTicks.forEach((tick) => {
    const yy = y(tick);
    ctx.beginPath();
    ctx.moveTo(ML, yy);
    ctx.lineTo(ML + innerW, yy);
    ctx.stroke();
  });

  // ── 2. Y-axis labels ──────────────────────────────────────
  ctx.fillStyle = COLOR_AXIS_TEXT;
  ctx.font = FONT_LABEL;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  yTicks.forEach((tick) => {
    ctx.fillText(`${tick.toFixed(1)}${unit}`, ML - 6, y(tick));
  });

  // ── 3. Yesterday line (dashed, dim) ───────────────────────
  ctx.strokeStyle = COLOR_YESTERDAY;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  data.forEach((d, i) => {
    const px = x(d.tenor) ?? 0;
    const py = y(d.yesterday);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();
  ctx.setLineDash([]);

  // ── 4. Today line (solid, accent) ─────────────────────────
  ctx.strokeStyle = colorToday;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  data.forEach((d, i) => {
    const px = x(d.tenor) ?? 0;
    const py = y(d.today);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();

  // ── 5. Today data points ──────────────────────────────────
  ctx.fillStyle = colorToday;
  data.forEach((d) => {
    const px = x(d.tenor) ?? 0;
    const py = y(d.today);
    ctx.beginPath();
    ctx.arc(px, py, 2.5, 0, Math.PI * 2);
    ctx.fill();
  });

  // ── 6. Shift bars (below chart) ───────────────────────────
  const maxShift =
    Math.max(...data.map((d) => Math.abs(d.today - d.yesterday))) || 1;
  const shiftStripTop  = MT + chartH + SHIFT_GAP;
  const shiftCenter    = shiftStripTop + SHIFT_HEIGHT / 2;
  const shiftScale = d3.scaleLinear().domain([0, maxShift]).range([0, SHIFT_HEIGHT / 2]);

  // center baseline
  ctx.strokeStyle = COLOR_GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ML, shiftCenter);
  ctx.lineTo(ML + innerW, shiftCenter);
  ctx.stroke();

  ctx.globalAlpha = 0.75;
  data.forEach((d) => {
    const shift = d.today - d.yesterday;
    const barH  = Math.max(shiftScale(Math.abs(shift)), 1);
    const px    = (x(d.tenor) ?? 0) - 6;
    const py    = shift >= 0 ? shiftCenter - barH : shiftCenter;
    ctx.fillStyle = shift >= 0 ? colorPositive : colorNegative;
    ctx.fillRect(px, py, 12, barH);
  });
  ctx.globalAlpha = 1;

  // ── 7. Tenor X-axis labels ────────────────────────────────
  const tenorLabelY = shiftStripTop + SHIFT_HEIGHT + LABEL_GAP + LABEL_HEIGHT * 0.7;
  ctx.fillStyle = COLOR_AXIS_TEXT;
  ctx.font = FONT_LABEL;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  data.forEach((d) => {
    ctx.fillText(d.tenor, x(d.tenor) ?? 0, tenorLabelY);
  });
}

export function TenorCurveChart({ data, tenors, unit = "%" }: TenorCurveChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const measure = () => {
      const el = containerRef.current;
      if (!el) return;
      setSize({ width: el.clientWidth, height: el.clientHeight });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width === 0 || size.height === 0) return;
    drawChart(canvas, data, tenors, unit);
  }, [data, tenors, unit, size]);

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", position: "relative" }}>
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: "100%" }}
      />
    </div>
  );
}
