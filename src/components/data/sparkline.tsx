"use client";

import { useEffect, useRef } from "react";

export interface SparklineProps {
  data: number[];
  variant?: "positive" | "negative" | "neutral" | "auto";
  width?: number;
  height?: number;
}

const COLORS = {
  positive: "var(--sem-positive)",
  negative: "var(--sem-negative)",
  neutral:  "#4a5568",
} as const;

/**
 * Canvas 2D sparkline — no SVG, no Recharts, no D3.
 * Positive → --sem-positive green, Negative → --sem-negative red.
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
