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
 */
import { useState } from "react";

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

export function StackedBar100({
  columns,
  seriesKeys,
  colorFor,
  emptyLabel = "No data",
  formatValue = defaultFormat,
}: StackedBar100Props) {
  const [hover, setHover] = useState<{ col: string; series: string } | null>(null);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {seriesKeys.map((s) => (
          <div key={s} className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 shrink-0 rounded-sm"
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
          return (
            <div key={col.key} className="relative flex min-w-0 flex-1 flex-col gap-1">
              {col.empty ? (
                <div className="flex flex-1 items-center justify-center rounded-sm border border-dashed border-border-subtle">
                  <span className="text-micro text-fg-dim">{emptyLabel}</span>
                </div>
              ) : (
                // col-reverse so seriesKeys[0] (the largest series) sits at the
                // bottom, which is the conventional reading order for a stack.
                <div
                  className="flex flex-1 flex-col-reverse overflow-hidden rounded-sm"
                  onMouseLeave={() => setHover(null)}
                >
                  {seriesKeys.map((s) => {
                    const pct = col.values[s] ?? 0;
                    if (pct <= 0) return null;
                    const dimmed = hover !== null && !(isHoveredCol && hover.series === s);
                    return (
                      <div
                        key={s}
                        onMouseEnter={() => setHover({ col: col.key, series: s })}
                        style={{
                          height: `${pct}%`,
                          backgroundColor: colorFor(s),
                          opacity: dimmed ? 0.45 : 1,
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

              {isHoveredCol && (
                <div
                  className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-full
                             whitespace-nowrap rounded border border-border-subtle bg-bg-overlay px-1.5 py-0.5
                             text-micro text-fg-primary"
                >
                  <span className="text-fg-muted">{hover.series}</span>
                  {" · "}
                  <span className="tabular-nums">
                    {formatValue(col.values[hover.series] ?? 0)}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
