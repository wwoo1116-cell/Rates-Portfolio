"use client";

/**
 * Term-structure (tenor-axis) chart — the small SVG render the S5 Curve View
 * deferral note anticipated: lightweight-charts' time axis can't host a tenor
 * axis, so this draws the input curves directly. Pillars are evenly spaced
 * (trader curve-view convention), each curve is a polyline over its available
 * pillars, and a missing quote BREAKS the line into segments (gap, no bridge,
 * no silent +0). Colors arrive resolved from chart-theme via the caller —
 * no raw hex here.
 */
import { useEffect, useRef, useState } from "react";

import { getSimulationChartTheme } from "../../lib/chart-theme";

export interface TermCurveDef {
  label: string;
  color: string;
  /** % values aligned to `pillarLabels`; null = missing quote (gap). */
  points: (number | null)[];
  dashed?: boolean;
}

export interface TermStructureChartProps {
  pillarLabels: string[];
  curves: TermCurveDef[];
}

const PAD = { top: 12, right: 12, bottom: 24, left: 44 };

export function TermStructureChart({ pillarLabels, curves }: TermStructureChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const t = getSimulationChartTheme();
  const { w, h } = size;
  const plotW = Math.max(w - PAD.left - PAD.right, 0);
  const plotH = Math.max(h - PAD.top - PAD.bottom, 0);
  const n = pillarLabels.length;

  const values = curves.flatMap((c) => c.points).filter((v): v is number => v !== null);
  const hasData = n > 0 && values.length > 0 && plotW > 0 && plotH > 0;

  let content: React.ReactNode = null;
  if (hasData) {
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const span = Math.max(rawMax - rawMin, 0.1);
    const yMin = rawMin - span * 0.1;
    const yMax = rawMax + span * 0.1;
    const x = (i: number) => PAD.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const y = (v: number) => PAD.top + ((yMax - v) / (yMax - yMin)) * plotH;

    const tickCount = 4;
    const ticks = Array.from({ length: tickCount + 1 }, (_, i) => yMin + ((yMax - yMin) * i) / tickCount);

    // Consecutive non-null runs → separate polyline segments (gap on missing).
    const segmentsOf = (points: (number | null)[]): { i: number; v: number }[][] => {
      const segs: { i: number; v: number }[][] = [];
      let cur: { i: number; v: number }[] = [];
      points.forEach((v, i) => {
        if (v === null) {
          if (cur.length) segs.push(cur);
          cur = [];
        } else {
          cur.push({ i, v });
        }
      });
      if (cur.length) segs.push(cur);
      return segs;
    };

    content = (
      <svg width={w} height={h} role="img" aria-label="인풋 커브 미리보기">
        {ticks.map((tv) => (
          <g key={tv}>
            <line x1={PAD.left} x2={w - PAD.right} y1={y(tv)} y2={y(tv)} stroke={t.grid} strokeWidth={1} />
            <text
              x={PAD.left - 6}
              y={y(tv) + 3}
              textAnchor="end"
              fontSize={10}
              fill={t.axis}
              fontFamily="inherit"
            >
              {tv.toFixed(2)}
            </text>
          </g>
        ))}
        {pillarLabels.map((label, i) => (
          <text
            key={label}
            x={x(i)}
            y={h - PAD.bottom + 14}
            textAnchor="middle"
            fontSize={10}
            fill={t.axis}
            fontFamily="inherit"
          >
            {label}
          </text>
        ))}
        {curves.map((c) => (
          <g key={c.label}>
            {segmentsOf(c.points).map((seg, si) =>
              seg.length === 1 ? null : (
                <polyline
                  key={si}
                  points={seg.map((p) => `${x(p.i)},${y(p.v)}`).join(" ")}
                  fill="none"
                  stroke={c.color}
                  strokeWidth={2}
                  strokeDasharray={c.dashed ? "5 4" : undefined}
                />
              ),
            )}
            {c.points.map((v, i) =>
              v === null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={2.5} fill={c.color} stroke={t.dotStroke} strokeWidth={1} />,
            )}
          </g>
        ))}
      </svg>
    );
  }

  return (
    <div ref={containerRef} data-num className="h-full w-full">
      {hasData ? (
        content
      ) : (
        <div className="flex h-full w-full items-center justify-center text-micro text-fg-dim">
          표시할 호가 없음 —
        </div>
      )}
    </div>
  );
}
