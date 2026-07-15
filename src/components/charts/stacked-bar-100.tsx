"use client";

/**
 * 100% stacked bar chart — one column per x-axis category, segments summing to
 * full height.
 *
 * Plain DOM, no SVG/canvas/charting lib. A 100% stack needs no scale (the
 * percentages ARE the scale), so each column is a flex column and each segment
 * is a div whose height is its share. That makes it responsive for free, keeps
 * label text from distorting the way a preserveAspectRatio="none" viewBox does
 * (see sparkline.tsx), and extends the hand-rolled precedent already here.
 *
 * Series colour is the datum, not decoration — the same exception DESIGN.md
 * grants the KRD heatmap ramp. Hues come from the caller via `colorFor` so this
 * component owns no palette; pass something stable, since a colour that
 * reshuffles between columns makes the stack unreadable.
 *
 * S7 geometry/legibility rules:
 *  - bar : gap ≈ 1 : 1 — each bar takes half its category cell, so the gap
 *    between adjacent bars equals the bar width; snapshot labels stay centered
 *    under their (narrower) bars because both center in the same cell.
 *  - 1px separator strokes between slices (the Navy-80 large-fill caveat's
 *    mitigation (a): neighboring slices, not the surface, are a dark slice's
 *    effective background — the seam keeps same-luminance neighbors apart).
 *  - legend swatches carry a subtle border (mitigation (b)) so a dark chip
 *    stays visible against the panel.
 *  - the hover tooltip anchors to the CURSOR inside the chart area (flipping
 *    left past the midpoint), never over the legend and never clipped by the
 *    panel boundary — it used to render translate-y-full above the column,
 *    which put it on top of the legend and outside the panel.
 */
import { useRef, useState } from "react";

export interface StackedBar100Column {
  /** Stable identity for React keys. */
  key: string;
  label: string;
  /** Secondary line under the label — e.g. the resolved valuation date. */
  sublabel?: string | null;
  /** series key -> percentage (0–100). Missing keys are treated as 0. */
  values: Record<string, number>;
  /** Render a placeholder instead of a stack (no data for this column). */
  empty?: boolean;
}

interface StackedBar100Props {
  columns: StackedBar100Column[];
  /** Stack order, bottom-up. Also the legend order. */
  seriesKeys: string[];
  colorFor: (seriesKey: string) => string;
  /** Shown inside a column with `empty: true`. */
  emptyLabel?: string;
  formatValue?: (pct: number) => string;
}

const defaultFormat = (pct: number) => `${pct.toFixed(1)}%`;

interface HoverState {
  col: string;
  series: string;
  /** Cursor position in the root container's coordinate space. */
  x: number;
  y: number;
  /** Root container width at event time (refs may not be read during render). */
  width: number;
}

export function StackedBar100({
  columns,
  seriesKeys,
  colorFor,
  emptyLabel = "No data",
  formatValue = defaultFormat,
}: StackedBar100Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  const trackHover = (col: string, series: string) => (e: React.MouseEvent) => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({ col, series, x: e.clientX - rect.left, y: e.clientY - rect.top, width: rect.width });
  };

  const hoveredCol = hover ? columns.find((c) => c.key === hover.col) : undefined;
  // Below-right of the cursor by default so the tooltip can never climb into
  // the legend row; flip to below-left past the midpoint to avoid clipping.
  const tooltipFlip = hover != null && hover.width > 0 && hover.x > hover.width * 0.55;

  return (
    <div ref={rootRef} className="relative flex h-full min-h-0 flex-col gap-2">
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {seriesKeys.map((s) => (
          <div key={s} className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 shrink-0 rounded-sm border border-border-subtle"
              style={{ backgroundColor: colorFor(s) }}
            />
            <span className="text-micro text-fg-muted">{s}</span>
          </div>
        ))}
      </div>

      {/* Columns */}
      <div className="flex min-h-0 flex-1 items-stretch gap-2">
        {columns.map((col) => {
          const isHoveredCol = hover?.col === col.key;
          const rendered = seriesKeys.filter((s) => (col.values[s] ?? 0) > 0);
          return (
            <div key={col.key} className="flex min-w-0 flex-1 flex-col gap-1">
              {col.empty ? (
                <div className="flex w-1/2 flex-1 items-center justify-center self-center rounded-sm border border-dashed border-border-subtle">
                  <span className="text-micro text-fg-dim">{emptyLabel}</span>
                </div>
              ) : (
                // col-reverse so seriesKeys[0] sits at the bottom (baseline-
                // anchored), the conventional reading order for a stack.
                // w-1/2 + self-center is the 1:1 bar:gap rule.
                <div
                  className="flex w-1/2 flex-1 flex-col-reverse self-center overflow-hidden rounded-sm"
                  onMouseLeave={() => setHover(null)}
                >
                  {rendered.map((s, i) => {
                    const pct = col.values[s] ?? 0;
                    const dimmed = hover !== null && !(isHoveredCol && hover.series === s);
                    // DOM order is bottom-up; every slice's top edge is a
                    // slice boundary except the visual-top (DOM-last) one.
                    const isTop = i === rendered.length - 1;
                    return (
                      <div
                        key={s}
                        onMouseEnter={trackHover(col.key, s)}
                        onMouseMove={trackHover(col.key, s)}
                        style={{
                          height: `${pct}%`,
                          backgroundColor: colorFor(s),
                          opacity: dimmed ? 0.45 : 1,
                          borderTop: isTop ? undefined : "1px solid var(--border-subtle)",
                        }}
                        className="w-full transition-opacity duration-100"
                      />
                    );
                  })}
                </div>
              )}

              <div className="flex flex-col items-center">
                <span className="truncate text-micro text-fg-muted">{col.label}</span>
                {col.sublabel && (
                  <span className="truncate text-micro tabular-nums text-fg-dim">
                    {col.sublabel}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Cursor-anchored tooltip — single instance at the root so it can never
          be clipped by a column's overflow-hidden stack. */}
      {hover && hoveredCol && (
        <div
          className="pointer-events-none absolute z-10 whitespace-nowrap rounded border border-border-subtle
                     bg-bg-overlay px-1.5 py-0.5 text-micro text-fg-primary"
          style={{
            left: hover.x,
            top: hover.y,
            transform: tooltipFlip ? "translate(calc(-100% - 10px), 10px)" : "translate(10px, 10px)",
          }}
        >
          <span className="text-fg-muted">{hover.series}</span>
          {" · "}
          <span className="tabular-nums">{formatValue(hoveredCol.values[hover.series] ?? 0)}</span>
        </div>
      )}
    </div>
  );
}
