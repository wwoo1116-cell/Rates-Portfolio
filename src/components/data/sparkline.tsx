"use client";

import { useEffect, useRef } from "react";
import { PNL_COLORS, ZERO_LINE_COLOR } from "@/lib/chart-colors";

export interface SparklineProps {
  data: number[];
  variant?: "positive" | "negative" | "neutral" | "auto";
  width?: number;
  height?: number;
}

// S12: canvas strokeStyle can't resolve var(--...) — the old
// "var(--sem-positive)" strings were silently invalid and this sparkline has
// been stroking the canvas default (black) all along. Literal mirrors from
// chart-colors fix that AND land the Jade/Berry signed pair in one move.
const COLORS = {
  positive: PNL_COLORS.pos,
  negative: PNL_COLORS.neg,
  neutral: ZERO_LINE_COLOR,
} as const;

/**
 * Canvas 2D sparkline — no SVG, no Recharts, no D3.
 * Positive → Jade, Negative → Berry (chart P&L pair, S12 lockdown).
 */
export function Sparkline({
  data,
  variant = "auto",
  width = 80,
  height = 24,
}: SparklineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length < 2) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Device pixel ratio for crisp rendering
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    const resolvedVariant: "positive" | "negative" | "neutral" =
      variant === "auto"
        ? data[data.length - 1] >= data[0]
          ? "positive"
          : "negative"
        : variant;

    const PAD = 2;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const xStep = (width - PAD * 2) / (data.length - 1);

    const toX = (i: number) => PAD + i * xStep;
    const toY = (v: number) => height - PAD - ((v - min) / range) * (height - PAD * 2);

    ctx.beginPath();
    data.forEach((v, i) => {
      const x = toX(i);
      const y = toY(v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    ctx.strokeStyle = COLORS[resolvedVariant];
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.stroke();
  }, [data, variant, width, height]);

  return (
    <canvas
      ref={canvasRef}
      style={{ display: "block" }}
      aria-hidden
    />
  );
}
