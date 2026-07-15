"use client";

import type { CSSProperties } from "react";

/**
 * Custom "target-style reticle" that replaces the native lightweight-charts
 * crosshair (disabled via BASE_CHART_OPTIONS.crosshair.{vertLine,horzLine}
 * = { visible: false, labelVisible: false } in lw-chart-base.tsx). Renders
 * as a DOM/SVG overlay -- a sibling of <LwChartBase />, inside the SAME
 * `position: relative` wrapper each consumer already renders its tooltip
 * in -- driven purely by params.point.x/y from subscribeCrosshairMove (the
 * same pixel space the existing tooltips already position themselves in).
 *
 * Geometry is fixed-length ("localized"), not chart-spanning: a plus sign
 * enclosed by 4 camera-autofocus-style corner brackets, with short axis
 * lines extending outward from the bracket box and terminating in
 * perpendicular T-shaped end caps.
 *
 * Each consumer's existing detailed floating tooltip stays as-is; this
 * component only renders the compact single-value badge next to the marker.
 */

const GEOM = 68;
const CENTER = GEOM / 2; // 34

const PLUS_ARM = 5;
const BRACKET_HALF = 14;
const BRACKET_ARM = 6;
const AXIS_LEN = 16; // ends at radius 30 from center
const CAP_HALF = 6;

const STROKE_WIDTH = 1.5;
const STROKE_COLOR = "var(--fg-primary)";
const STROKE_OPACITY = 0.85;

const LABEL_OFFSET = 34;
const LABEL_H_ESTIMATE = 20;
const LABEL_CHAR_W_ESTIMATE = 6.3;
const LABEL_H_PADDING = 12;
const DATE_LINE_H = 15; // extra height reserved when a date line is shown above the value line

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "YYYY-MM-DD" -> "DD - MMM - YYYY" (e.g. "2026-06-14" -> "14 - Jun - 2026").
 * Parses the ISO string directly (no `Date` object) so there's no timezone
 * shift risk -- chart data is already date-only, business-day-keyed. */
export function formatCrosshairDate(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) return isoDate;
  const [, y, mo, d] = m;
  const month = MONTH_ABBR[Number(mo) - 1];
  if (!month) return isoDate;
  return `${d} - ${month} - ${y}`;
}

export interface CrosshairReticlePoint {
  x: number;
  y: number;
}

export interface CrosshairReticleProps {
  /** Pixel-space point in the OVERLAY's coordinate space (i.e. the consumer's
   *  `position: relative` wrapper), NOT raw pane space -- use
   *  snapReticleToNearestSeries(), which adds paneOffsetX() for you. Passing
   *  params.point straight through is what made the reticle sit left of the
   *  cursor on charts with a visible left price scale. Pass `null` to hide. */
  point: CrosshairReticlePoint | null;
  /** Raw ISO ("YYYY-MM-DD") date for the hovered point. Rendered as the
   *  prominent top line of the badge, formatted "DD - MMM - YYYY" -- this is
   *  the primary thing the badge communicates, per the app's convention that
   *  hovering a chart should orient the viewer by date first. */
  date?: string;
  /** Compact single-value string, e.g. "IRS 3Y 3.2500%". Rendered as a
   *  secondary line under the date. Omit to show only the date (or nothing,
   *  if `date` is also omitted). */
  label?: string;
  /** Reserved for the app's sanctioned semantic tokens only. Default
   *  "neutral" uses var(--fg-primary). Applies to the value line only --
   *  the date line always uses --fg-primary. */
  tone?: "positive" | "negative" | "neutral";
  /** X of the pane's RIGHT edge, in the same overlay space as `point` --
   *  i.e. paneOffsetX(chart) + chart.timeScale().width(). Used only to decide
   *  whether the label flips left of the point to avoid clipping, so it must be
   *  measured from the same origin as `point.x` or the flip threshold drifts by
   *  the left-axis width. */
  paneWidth?: number;
}

export function CrosshairReticle({ point, date, label, tone = "neutral", paneWidth }: CrosshairReticleProps) {
  if (!point) return null;

  // Chart-surface badge: sign wears the chart P&L pair (Jade/Berry, S7), not
  // the app-wide sem tokens — this overlay only ever renders on charts.
  const toneColor =
    tone === "positive" ? "var(--chart-pnl-pos)" : tone === "negative" ? "var(--chart-pnl-neg)" : "var(--fg-primary)";
  const formattedDate = date ? formatCrosshairDate(date) : undefined;

  let labelStyle: CSSProperties | null = null;
  if (formattedDate || label) {
    const widestLine = Math.max(formattedDate?.length ?? 0, label?.length ?? 0);
    const estWidth = widestLine * LABEL_CHAR_W_ESTIMATE + LABEL_H_PADDING;
    const estHeight = LABEL_H_ESTIMATE + (formattedDate && label ? DATE_LINE_H : 0);
    const overflowsRight = paneWidth != null && paneWidth > 0 && point.x + LABEL_OFFSET + estWidth > paneWidth;
    const left = overflowsRight ? point.x - LABEL_OFFSET - estWidth : point.x + LABEL_OFFSET;
    const top = Math.max(point.y - LABEL_OFFSET - estHeight, 4);
    labelStyle = { position: "absolute", left, top };
  }

  return (
    <>
      <svg
        aria-hidden
        width={GEOM}
        height={GEOM}
        viewBox={`0 0 ${GEOM} ${GEOM}`}
        style={{
          position: "absolute",
          left: point.x,
          top: point.y,
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
          overflow: "visible",
          zIndex: 8,
        }}
      >
        <g stroke={STROKE_COLOR} strokeOpacity={STROKE_OPACITY} strokeWidth={STROKE_WIDTH} fill="none">
          {/* Center plus sign */}
          <line x1={CENTER - PLUS_ARM} y1={CENTER} x2={CENTER + PLUS_ARM} y2={CENTER} />
          <line x1={CENTER} y1={CENTER - PLUS_ARM} x2={CENTER} y2={CENTER + PLUS_ARM} />

          {/* Corner brackets (camera autofocus box) */}
          <polyline points={`${CENTER - BRACKET_HALF + BRACKET_ARM},${CENTER - BRACKET_HALF} ${CENTER - BRACKET_HALF},${CENTER - BRACKET_HALF} ${CENTER - BRACKET_HALF},${CENTER - BRACKET_HALF + BRACKET_ARM}`} />
          <polyline points={`${CENTER + BRACKET_HALF - BRACKET_ARM},${CENTER - BRACKET_HALF} ${CENTER + BRACKET_HALF},${CENTER - BRACKET_HALF} ${CENTER + BRACKET_HALF},${CENTER - BRACKET_HALF + BRACKET_ARM}`} />
          <polyline points={`${CENTER - BRACKET_HALF},${CENTER + BRACKET_HALF - BRACKET_ARM} ${CENTER - BRACKET_HALF},${CENTER + BRACKET_HALF} ${CENTER - BRACKET_HALF + BRACKET_ARM},${CENTER + BRACKET_HALF}`} />
          <polyline points={`${CENTER + BRACKET_HALF},${CENTER + BRACKET_HALF - BRACKET_ARM} ${CENTER + BRACKET_HALF},${CENTER + BRACKET_HALF} ${CENTER + BRACKET_HALF - BRACKET_ARM},${CENTER + BRACKET_HALF}`} />

          {/* Axis lines -- localized: extend outward from the bracket box, NOT edge-to-edge */}
          <line x1={CENTER} y1={CENTER - BRACKET_HALF} x2={CENTER} y2={CENTER - BRACKET_HALF - AXIS_LEN} />
          <line x1={CENTER} y1={CENTER + BRACKET_HALF} x2={CENTER} y2={CENTER + BRACKET_HALF + AXIS_LEN} />
          <line x1={CENTER - BRACKET_HALF} y1={CENTER} x2={CENTER - BRACKET_HALF - AXIS_LEN} y2={CENTER} />
          <line x1={CENTER + BRACKET_HALF} y1={CENTER} x2={CENTER + BRACKET_HALF + AXIS_LEN} y2={CENTER} />

          {/* T-shaped end caps */}
          <line x1={CENTER - CAP_HALF} y1={CENTER - BRACKET_HALF - AXIS_LEN} x2={CENTER + CAP_HALF} y2={CENTER - BRACKET_HALF - AXIS_LEN} />
          <line x1={CENTER - CAP_HALF} y1={CENTER + BRACKET_HALF + AXIS_LEN} x2={CENTER + CAP_HALF} y2={CENTER + BRACKET_HALF + AXIS_LEN} />
          <line x1={CENTER - BRACKET_HALF - AXIS_LEN} y1={CENTER - CAP_HALF} x2={CENTER - BRACKET_HALF - AXIS_LEN} y2={CENTER + CAP_HALF} />
          <line x1={CENTER + BRACKET_HALF + AXIS_LEN} y1={CENTER - CAP_HALF} x2={CENTER + BRACKET_HALF + AXIS_LEN} y2={CENTER + CAP_HALF} />
        </g>
      </svg>

      {(formattedDate || label) && labelStyle && (
        <div
          style={{
            ...labelStyle,
            pointerEvents: "none",
            zIndex: 9,
            background: "rgba(32, 43, 51, 0.88)",
            border: "1px solid var(--border-subtle)",
            padding: "2px 6px",
            fontFamily: "var(--font-mono)",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
          }}
        >
          {formattedDate && (
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--fg-primary)" }}>{formattedDate}</div>
          )}
          {label && (
            <div style={{ fontSize: 11, color: toneColor, marginTop: formattedDate ? 1 : 0 }}>{label}</div>
          )}
        </div>
      )}
    </>
  );
}
