"use client";

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import type { HeatmapItem } from "@/mocks/home";
import { resolveCssVar } from "@/lib/canvas-color";

export interface PortfolioHeatmapProps {
  data: HeatmapItem[];
}

const PADDING = 2;

// #F58220 alpha-only heatmap scale (no red/green — those are directional-only).
// Alpha range: 0.08 (smallest) → 0.90 (largest notional)
function heatColor(notional: number, maxNotional: number): string {
  const t = Math.min(notional / Math.max(maxNotional, 1), 1);
  const alpha = (0.08 + t * 0.82).toFixed(2);
  return `rgba(59, 130, 246,${alpha})`;
}

// PnL sign indicator: directional data rendered as text color only, not fill.
// Canvas can't resolve CSS custom properties, so callers pass the already-
// resolved --sem-positive/--sem-negative computed values (see drawHeatmap).
function pnlColor(pnl: number, colorPositive: string, colorNegative: string): string {
  if (pnl > 0) return colorPositive;
  if (pnl < 0) return colorNegative;
  return "#a0aab8";
}

const FONT_LABEL = "11px Inter, system-ui, sans-serif";
const COLOR_BORDER = "rgba(255,255,255,0.07)";
const COLOR_SECTOR_LABEL = "#6b7888";
const COLOR_LEAF_LABEL   = "#e8ecf0";

interface HierarchyDatum {
  name: string;
  children?: HierarchyDatum[];
  item?: HeatmapItem;
  value?: number;
}

function buildHierarchy(data: HeatmapItem[]): HierarchyDatum {
  const bySector = d3.group(data, (d) => d.sector);
  return {
    name: "root",
    children: Array.from(bySector, ([sector, items]) => ({
      name: sector,
      children: items.map((item) => ({
        name: item.ticker,
        item,
        value: item.notionalKrwEok,
      })),
    })),
  };
}

function drawHeatmap(
  canvas: HTMLCanvasElement,
  data: HeatmapItem[],
) {
  const dpr = window.devicePixelRatio || 1;
  const { clientWidth: cssW, clientHeight: cssH } = canvas;
  canvas.width  = cssW * dpr;
  canvas.height = cssH * dpr;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);

  const colorPositive = resolveCssVar("--sem-positive");
  const colorNegative = resolveCssVar("--sem-negative");

  const W = cssW;
  const H = cssH;
  ctx.clearRect(0, 0, W, H);

  const maxNotional = Math.max(...data.map((d) => d.notionalKrwEok), 1);

  const hierarchy = d3
    .hierarchy(buildHierarchy(data))
    .sum((d) => d.value ?? 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  const treemap = d3
    .treemap<HierarchyDatum>()
    .size([W, H])
    .paddingOuter(4)
    .paddingTop(20)
    .paddingInner(2)(hierarchy);

  // Sector borders + labels
  (treemap.children ?? []).forEach((sector) => {
    const sx0 = sector.x0, sy0 = sector.y0;
    const sw   = sector.x1 - sector.x0;
    const sh   = sector.y1 - sector.y0;

    ctx.strokeStyle = COLOR_BORDER;
    ctx.lineWidth   = 1;
    ctx.strokeRect(sx0, sy0, sw, sh);

    ctx.fillStyle = COLOR_SECTOR_LABEL;
    ctx.font      = FONT_LABEL;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(sector.data.name, sx0 + 4, sy0 + 4);
  });

  // Leaf tiles
  treemap.leaves().forEach((leaf) => {
    const lx0 = leaf.x0 + PADDING;
    const ly0  = leaf.y0 + PADDING;
    const lw   = Math.max(leaf.x1 - leaf.x0 - PADDING * 2, 0);
    const lh   = Math.max(leaf.y1 - leaf.y0 - PADDING * 2, 0);

    if (lw <= 0 || lh <= 0) return;

    const item = leaf.data.item;
    const notional = item?.notionalKrwEok ?? 0;

    // Fill: accent alpha by notional intensity
    ctx.fillStyle = heatColor(notional, maxNotional);
    ctx.fillRect(lx0, ly0, lw, lh);

    // 1px border
    ctx.strokeStyle = COLOR_BORDER;
    ctx.lineWidth   = 1;
    ctx.strokeRect(lx0, ly0, lw, lh);

    if (!item || lw < 40) return;

    // Ticker label
    ctx.fillStyle    = COLOR_LEAF_LABEL;
    ctx.font         = FONT_LABEL;
    ctx.textAlign    = "left";
    ctx.textBaseline = "top";
    ctx.fillText(item.ticker, lx0 + 4, ly0 + 4);

    // PnL label (directional color, text only — not fill)
    if (lh > 28) {
      const pnl     = item.dailyPnlPercent;
      const pnlText = `${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}%`;
      ctx.fillStyle = pnlColor(pnl, colorPositive, colorNegative);
      ctx.font      = "10px Inter, system-ui, sans-serif";
      ctx.fillText(pnlText, lx0 + 4, ly0 + 18);
    }
  });
}

export function PortfolioHeatmap({ data }: PortfolioHeatmapProps) {
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
    drawHeatmap(canvas, data);
  }, [data, size]);

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%" }}>
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: "100%" }}
      />
    </div>
  );
}
