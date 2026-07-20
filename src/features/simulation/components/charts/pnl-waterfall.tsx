"use client";

/**
 * PnL waterfall (demo sprint, trader feedback) — the horizon Total Return
 * decomposition as six ordered floating bars: five components stepping the
 * cumulative level left→right, then the Total bar from zero. DISPLAY ONLY:
 * values arrive from the server's totalReturnDecomposition (identity pinned
 * server-side ±₩1); nothing is recomputed here.
 *
 * Sign semantics: Jade/Berry universal signed pair — 40-step fills for bar
 * bodies, 80-step for the value labels (S7/iv3). A null component (excluded
 * swap) renders an empty slot with "—" and the cumulative level carries
 * through unchanged — blank, never +0.
 */
import { useEffect, useRef, useState } from "react";

import { formatKrwAxisSigned } from "@/lib/format";

import { getSimulationChartTheme } from "../../lib/chart-theme";

export interface WaterfallItem {
  label: string;
  /** Signed KRW contribution; null = unknown (excluded), rendered —. */
  value: number | null;
}

export interface PnlWaterfallProps {
  items: WaterfallItem[];
  /** Server total — the last bar, drawn from zero. Never recomputed. */
  total: number;
  totalLabel: string;
}

const PAD = { top: 20, right: 12, bottom: 24, left: 12 };
const MIN_BAR_PX = 2;

export function PnlWaterfall({ items, total, totalLabel }: PnlWaterfallProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = containerRef.current;
    // jsdom (vitest) has no ResizeObserver; the chart then stays empty (the
    // flow tests assert the card DOM, not the SVG).
    if (!el || typeof ResizeObserver === "undefined") return;
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
  const n = items.length + 1; // + Total slot

  // Cumulative levels: slot i spans [cum_i, cum_i + value_i].
  let cum = 0;
  const slots = items.map((it) => {
    const from = cum;
    if (it.value !== null) cum += it.value;
    return { ...it, from, to: cum };
  });

  const levels = [0, total, ...slots.flatMap((s) => [s.from, s.to])];
  const rawMin = Math.min(...levels);
  const rawMax = Math.max(...levels);
  const span = Math.max(rawMax - rawMin, 1);
  const yMin = rawMin - span * 0.12;
  const yMax = rawMax + span * 0.12;
  const y = (v: number) => PAD.top + ((yMax - v) / (yMax - yMin)) * plotH;

  // HARDEN-1 layout fix (owner: bars too far apart to read as a waterfall).
  // Tight category axis: slot width is CAPPED so a wide panel doesn't stretch
  // the gaps, the whole group centers in the pane, and bar:gap is 0.72:0.28
  // ≈ 2.6:1 (≥2:1 spec; Home stacked-bar 1:1 is the floor). Numbers untouched.
  const slotW = n > 0 ? Math.min(plotW / n, 120) : 0;
  const groupW = slotW * n;
  const xStart = PAD.left + (plotW - groupW) / 2;
  const barW = Math.max(slotW * 0.72, 8);
  const xCenter = (i: number) => xStart + slotW * i + slotW / 2;

  if (plotW <= 0 || plotH <= 0) return <div ref={containerRef} className="h-full w-full" />;

  const bar = (i: number, from: number, to: number, label: string, value: number | null, strong: boolean) => {
    const sign = value === null ? 0 : value >= 0 ? 1 : -1;
    const fill = sign >= 0 ? t.pnl.posFill : t.pnl.negFill;
    const edge = sign >= 0 ? t.pnl.pos : t.pnl.neg;
    const top = Math.min(y(from), y(to));
    const height = Math.max(Math.abs(y(from) - y(to)), value === null ? 0 : MIN_BAR_PX);
    const cx = xCenter(i);
    return (
      <g key={label}>
        {value !== null ? (
          <>
            <rect x={cx - barW / 2} y={top} width={barW} height={height} fill={fill} />
            <rect x={cx - barW / 2} y={sign >= 0 ? top : top + height - 1.5} width={barW} height={1.5} fill={edge} />
            <text
              x={cx}
              y={top - 5}
              textAnchor="middle"
              fontSize={10}
              fontWeight={strong ? 600 : 400}
              fill={edge}
              fontFamily="inherit"
            >
              {formatKrwAxisSigned(value)}
            </text>
          </>
        ) : (
          <text x={cx} y={y(from) - 5} textAnchor="middle" fontSize={10} fill={t.axis} fontFamily="inherit">
            —
          </text>
        )}
        <text
          x={cx}
          y={h - PAD.bottom + 14}
          textAnchor="middle"
          fontSize={10}
          fontWeight={strong ? 600 : 400}
          fill={strong ? t.tooltipText : t.axis}
          fontFamily="inherit"
        >
          {label}
        </text>
      </g>
    );
  };

  return (
    <div ref={containerRef} data-num className="h-full w-full">
      <svg width={w} height={h} role="img" aria-label="손익 워터폴">
        {/* zero baseline — spans the (tight, centered) category group */}
        <line x1={xStart} x2={xStart + groupW} y1={y(0)} y2={y(0)} stroke={t.zeroLine} strokeWidth={1} />
        {/* dashed connectors carrying the running level to the next slot */}
        {slots.map((s, i) => (
          <line
            key={`c${i}`}
            x1={xCenter(i) + barW / 2}
            x2={xCenter(i + 1) - barW / 2}
            y1={y(s.to)}
            y2={y(s.to)}
            stroke={t.grid}
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        ))}
        {slots.map((s, i) => bar(i, s.from, s.to, s.label, s.value, false))}
        {bar(items.length, 0, total, totalLabel, total, true)}
      </svg>
    </div>
  );
}
