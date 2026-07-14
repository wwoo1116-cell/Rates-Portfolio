"use client";

/**
 * Compact trend line for a stat tile (Home's Status panel): 2px line, ~10%
 * opacity area wash, single end-dot with a surface ring -- dataviz skill's
 * "stat tile: trend (12-point sparkline)" spec. No axes/gridlines (a
 * sparkline is the number's shape, not an analytical chart) but still ships
 * a lightweight hover (crosshair + nearest-point tooltip), same floating-
 * tooltip pattern as pnl-trace-panel.tsx's chart.
 */
import { useMemo, useState } from "react";

export interface SparklinePoint {
  date: string;
  value: number;
}

interface SparklineProps {
  points: SparklinePoint[];
  /** Line/area/end-dot color. Defaults to the de-emphasis (neutral) hue --
   * pass a semantic color only when the series has a real up=good/down=bad polarity. */
  color?: string;
  height?: number;
  formatValue?: (value: number) => string;
  formatDate?: (date: string) => string;
}

const WIDTH = 200;

export function Sparkline({
  points,
  color = "var(--fg-secondary)",
  height = 40,
  formatValue,
  formatDate,
}: SparklineProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const geometry = useMemo(() => {
    if (points.length < 2) return null;
    const values = points.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const padX = 4;
    const padY = 4;
    const xForIndex = (i: number) => padX + (i / (points.length - 1)) * (WIDTH - padX * 2);
    const yForValue = (v: number) => padY + (1 - (v - min) / range) * (height - padY * 2);
    const coords = points.map((p, i) => [xForIndex(i), yForValue(p.value)] as const);
    const linePath = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const areaPath = `${linePath} L${coords[coords.length - 1][0].toFixed(1)},${height} L${coords[0][0].toFixed(1)},${height} Z`;
    return { coords, linePath, areaPath, xForIndex };
  }, [points, height]);

  if (!geometry) {
    return <div style={{ height }} />;
  }

  const { coords, linePath, areaPath, xForIndex } = geometry;
  const [lastX, lastY] = coords[coords.length - 1];

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!geometry) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * WIDTH;
    let nearest = 0;
    let nearestDist = Infinity;
    points.forEach((_, i) => {
      const d = Math.abs(xForIndex(i) - relX);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = i;
      }
    });
    setHoverIndex(nearest);
  }

  const hoverPoint = hoverIndex != null ? points[hoverIndex] : null;
  const hoverCoord = hoverIndex != null ? coords[hoverIndex] : null;

  return (
    <div style={{ position: "relative", width: "100%", height }}>
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: "100%", display: "block" }}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        <path d={areaPath} fill={color} opacity={0.1} stroke="none" />
        <path d={linePath} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {hoverCoord && (
          <line x1={hoverCoord[0]} y1={0} x2={hoverCoord[0]} y2={height} stroke="var(--border-subtle)" strokeWidth={1} />
        )}
        <circle cx={lastX} cy={lastY} r={3} fill={color} stroke="var(--bg-surface)" strokeWidth={2} />
        {hoverCoord && hoverIndex !== points.length - 1 && (
          <circle cx={hoverCoord[0]} cy={hoverCoord[1]} r={3} fill={color} stroke="var(--bg-surface)" strokeWidth={2} />
        )}
      </svg>
      {hoverPoint && hoverCoord && (
        <div
          style={{
            position: "absolute",
            left: `${(hoverCoord[0] / WIDTH) * 100}%`,
            top: 0,
            transform: hoverCoord[0] > WIDTH / 2 ? "translate(-100%, -100%)" : "translate(0, -100%)",
            pointerEvents: "none",
            whiteSpace: "nowrap",
            background: "var(--bg-overlay)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 4,
            padding: "2px 6px",
            fontSize: 10,
            color: "var(--fg-primary)",
            zIndex: 10,
          }}
        >
          {formatDate ? formatDate(hoverPoint.date) : hoverPoint.date}
          {" · "}
          {formatValue ? formatValue(hoverPoint.value) : hoverPoint.value}
        </div>
      )}
    </div>
  );
}
