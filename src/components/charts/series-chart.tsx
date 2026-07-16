"use client";

/**
 * Canonical multi-series line chart (S7) — the Rate History panel's
 * lightweight-charts setup extracted into one reusable component, so every
 * line-chart surface (Rates History, Simulation Total-Return, future hosts)
 * shares the same interaction grammar:
 *
 *  1. Series pills (top-left overlay): click toggles a series' visibility,
 *     × removes it where the host allows (onRemoveSeries). Swatch colors come
 *     from the caller, which gets them from src/lib/chart-colors.ts — this
 *     component owns no palette.
 *  2. Last-value badges on the price scale per series (lightweight-charts
 *     lastValueVisible) under the s14 collision policy: past `badgeLimit`
 *     series (default 2) only `primary`-marked series keep a badge — the
 *     rest read via crosshair. See series-defaults.ts.
 *  3. Crosshair reticle + optional multi-series tooltip. COORDINATE-SPACE
 *     NOTE (the historical "crosshair sits left of the cursor" bug): every
 *     pixel lightweight-charts reports (params.point, timeToCoordinate,
 *     priceToCoordinate) is measured from the PANE's origin, while the DOM
 *     overlay is positioned from the CONTAINER's origin; a visible left price
 *     scale sits between the two. snap-reticle.ts owns the fix (paneOffsetX)
 *     and this component routes ALL overlay positioning through it, so hosts
 *     can no longer regress by passing raw pane-space points.
 *  4. Per-series price formatters (axis ticks + badges + tooltip), resolved
 *     from the declared `valueKind` since s14 — KRW series default to the
 *     signed 억/만 formatter (never raw floats), rate/bp keep their existing
 *     formats. An explicit `formatter` overrides (series-defaults.ts).
 *
 * Series lifecycle is diffed by id (add new / drop removed / update data),
 * and fitContent runs only when the SET of ids changes, so a user's manual
 * zoom survives data refreshes — both behaviors inherited from Rate History.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  IChartApi,
  ISeriesApi,
  ISeriesMarkersPluginApi,
  IPriceLine,
  MouseEventParams,
  SeriesMarker,
  Time,
  DeepPartial,
  ChartOptions,
} from "lightweight-charts";
import { LineSeries, LineStyle, createSeriesMarkers } from "lightweight-charts";
import { X } from "lucide-react";
import { ZERO_LINE_COLOR } from "@/lib/chart-colors";
import { LwChartBase } from "./lw-chart-base";
import { CrosshairReticle, type CrosshairReticlePoint } from "./crosshair-reticle";
import { paneOffsetX, seriesDistanceY, snapReticleToNearestSeries } from "./snap-reticle";
import { badgeVisible, resolveSeriesFormatter, type SeriesValueKind } from "./series-defaults";

export interface SeriesChartSeriesDef {
  /** Stable identity — diffing, pills, and click resolution key off it. */
  id: string;
  label: string;
  color: string;
  data: readonly { time: string | Time; value: number }[];
  lineWidth?: 1 | 2 | 3 | 4;
  dashed?: boolean;
  /** "right" (default) or "left" — the left scale shows only while a series uses it. */
  priceScaleId?: "right" | "left";
  /** What the values ARE. Resolves the default axis/badge/tooltip formatter
   * when `formatter` is absent: "krw" → signed 억/만 (never raw floats or
   * sub-만원 digits — s14 owner directive), "rate" → 4dp %, "bp" → 2dp. */
  valueKind?: SeriesValueKind;
  /** Axis-badge/tick formatter for this series' scale — overrides the
   * valueKind default (see series-defaults.ts). */
  formatter?: (v: number) => string;
  /** Text next to the last-value badge. Defaults to `label`; pass "" to keep
   * the badge value-only (multi-series hosts where pills already name them). */
  axisTitle?: string;
  /** Pill shows × when true AND the host passed onRemoveSeries. */
  removable?: boolean;
  /** Keeps its last-value badge when the pane has more series than
   * `badgeLimit` (badge collision policy, s14). Opt-in. */
  primary?: boolean;
  /** Hard per-series badge override — wins over the collision policy in both
   * directions (e.g. a single-series chart whose header already shows the
   * last value passes false). */
  lastValueBadge?: boolean;
}

export interface SeriesChartMarker {
  time: string | Time;
  text: string;
  color: string;
}

export interface SeriesChartClickContext {
  /** ISO date string of the clicked bar, if the click landed on the time axis. */
  date: string | null;
  /** Nearest series (resolved through ITS OWN price scale — dual-axis safe)
   * and its pixel distance, so hosts can apply their own hit radius. */
  nearest: { id: string; dist: number } | null;
  param: MouseEventParams;
}

interface SeriesChartProps {
  series: SeriesChartSeriesDef[];
  /** Render the pills overlay (top-left). Off by default: hosts with their own
   * series chips (Rate History's InstrumentSelector) stay pixel-identical. */
  pills?: boolean;
  /** Render the built-in crosshair tooltip (date + per-series values). */
  tooltip?: boolean;
  /** Horizontal price line at y=0 on the first series. */
  zeroLine?: boolean;
  /** Point markers on the first series (e.g. break-even day). */
  markers?: SeriesChartMarker[];
  /** lightweight-charts' per-series dotted last-price line. Defaults to the
   * library default (true) for parity with pre-extraction Rate History;
   * multi-series hosts usually pass false. */
  priceLineVisible?: boolean;
  /** Badge collision policy threshold: with more series than this on the
   * pane, only `primary` series keep their last-value badge (the rest read
   * via crosshair). Default DEFAULT_BADGE_LIMIT (2); pass Infinity to opt a
   * chart out of the policy entirely. */
  badgeLimit?: number;
  /** Mount-time chart-option overrides (e.g. canonical --bg-surface canvas). */
  chartOptions?: DeepPartial<ChartOptions>;
  onRemoveSeries?: (id: string) => void;
  onClick?: (ctx: SeriesChartClickContext) => void;
  onChartReady?: (chart: IChartApi) => void;
}

const EMPTY_MARKERS: SeriesChartMarker[] = [];

/** Crosshair/click dates in ISO form regardless of the host's time encoding:
 * date-string hosts (Rate History) pass through untouched, UTCTimestamp hosts
 * (Simulation's D+n horizon axis) convert, BusinessDay formats numerically. */
function timeToIsoDate(t: Time): string {
  if (typeof t === "string") return t;
  if (typeof t === "number") return new Date(t * 1000).toISOString().slice(0, 10);
  return `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
}

export function SeriesChart({
  series,
  pills = false,
  tooltip = false,
  zeroLine = false,
  markers = EMPTY_MARKERS,
  priceLineVisible,
  badgeLimit,
  chartOptions,
  onRemoveSeries,
  onClick,
  onChartReady,
}: SeriesChartProps) {
  const chartRef = useRef<IChartApi | null>(null);
  const seriesMapRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const markersOwnerRef = useRef<ISeriesApi<"Line"> | null>(null);
  const zeroLineRef = useRef<{ owner: ISeriesApi<"Line">; line: IPriceLine } | null>(null);
  const prevIdsRef = useRef<string>("");

  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(new Set());
  const [reticle, setReticle] = useState<
    (CrosshairReticlePoint & { date?: string; paneWidth: number }) | null
  >(null);
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    date?: string;
    paneWidth: number;
    rows: { id: string; label: string; color: string; text: string }[];
  } | null>(null);

  // Subscriptions are registered once at mount; everything they need is read
  // through refs so hosts can pass fresh closures every render (no leak, no
  // stale capture — same pattern Rate History used, now owned here).
  const seriesDefsRef = useRef(series);
  useLayoutEffect(() => { seriesDefsRef.current = series; }, [series]);
  const hiddenRef = useRef(hiddenIds);
  useLayoutEffect(() => { hiddenRef.current = hiddenIds; }, [hiddenIds]);
  const onClickRef = useRef(onClick);
  useLayoutEffect(() => { onClickRef.current = onClick; }, [onClick]);
  const tooltipRef = useRef(tooltip);
  useLayoutEffect(() => { tooltipRef.current = tooltip; }, [tooltip]);

  /** Candidate series for snapping/click resolution — visible ones only. */
  const visibleSeries = useCallback((): Map<string, ISeriesApi<"Line">> => {
    const out = new Map<string, ISeriesApi<"Line">>();
    for (const [id, s] of seriesMapRef.current) {
      if (!hiddenRef.current.has(id)) out.set(id, s);
    }
    return out;
  }, []);

  const handleChartReady = useCallback((chart: IChartApi) => {
    chartRef.current = chart;
    seriesMapRef.current = new Map();

    chart.subscribeClick((param) => {
      const cb = onClickRef.current;
      if (!cb) return;
      let nearest: { id: string; dist: number } | null = null;
      for (const [id, s] of visibleSeries()) {
        const hit = seriesDistanceY(param, s);
        if (hit && (nearest == null || hit.dist < nearest.dist)) nearest = { id, dist: hit.dist };
      }
      cb({ date: param.time != null ? timeToIsoDate(param.time) : null, nearest, param });
    });

    chart.subscribeCrosshairMove((params: MouseEventParams) => {
      if (!params.point) {
        setReticle(null);
        setHover(null);
        return;
      }
      const date = params.time != null ? timeToIsoDate(params.time) : undefined;
      const candidates = visibleSeries();
      const snapped = snapReticleToNearestSeries(chart, params, candidates.values());
      const p = snapped ?? { x: params.point.x + paneOffsetX(chart), y: params.point.y };
      const paneWidth = paneOffsetX(chart) + chart.timeScale().width();
      setReticle({ x: p.x, y: p.y, date, paneWidth });

      if (!tooltipRef.current) return;
      const rows: { id: string; label: string; color: string; text: string }[] = [];
      for (const def of seriesDefsRef.current) {
        const s = candidates.get(def.id);
        if (!s) continue;
        const d = params.seriesData.get(s) as { value?: number } | undefined;
        if (d?.value == null || !Number.isFinite(d.value)) continue;
        const fmt = resolveSeriesFormatter(def) ?? ((v: number) => v.toLocaleString());
        rows.push({ id: def.id, label: def.label, color: def.color, text: fmt(d.value) });
      }
      setHover(rows.length > 0 ? { x: p.x, y: p.y, date, paneWidth, rows } : null);
    });

    onChartReady?.(chart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Diff the live series against the defs: add new, drop removed, update data
  // and options. Also owns the zero line + markers plugin (both live on the
  // first series and must detach before their owner is removed).
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const seriesMap = seriesMapRef.current;
    const wantIds = new Set(series.map((b) => b.id));

    for (const [id, s] of seriesMap) {
      if (!wantIds.has(id)) {
        if (markersOwnerRef.current === s) {
          markersRef.current?.detach();
          markersRef.current = null;
          markersOwnerRef.current = null;
        }
        if (zeroLineRef.current?.owner === s) zeroLineRef.current = null;
        chart.removeSeries(s);
        seriesMap.delete(id);
      }
    }

    for (const def of series) {
      let s = seriesMap.get(def.id);
      const formatter = resolveSeriesFormatter(def);
      const showBadge = badgeVisible(def, series.length, badgeLimit);
      const options = {
        color: def.color,
        lineWidth: def.lineWidth ?? 2,
        lineStyle: def.dashed ? LineStyle.Dashed : LineStyle.Solid,
        // lightweight-charts paints the title label on the price axis even
        // with lastValueVisible off — blank it too or the badge pile survives
        // as a label pile (verified live, s14).
        title: showBadge ? (def.axisTitle ?? def.label) : "",
        priceScaleId: def.priceScaleId ?? "right",
        lastValueVisible: showBadge,
        ...(priceLineVisible === undefined ? {} : { priceLineVisible }),
        ...(formatter
          ? { priceFormat: { type: "custom" as const, formatter } }
          : {}),
        visible: !hiddenIds.has(def.id),
      };
      if (!s) {
        s = chart.addSeries(LineSeries, options);
        seriesMap.set(def.id, s);
      } else {
        s.applyOptions(options);
      }
      s.setData(def.data as never);
    }

    // Left (bp/secondary) axis visible only while a series is on it.
    const hasLeft = series.some((b) => b.priceScaleId === "left");
    chart.priceScale("left").applyOptions({ visible: hasLeft });

    // Zero line on the first series (re-anchor if the first series changed).
    const first = series.length > 0 ? seriesMap.get(series[0].id) : undefined;
    if (zeroLineRef.current && (!zeroLine || zeroLineRef.current.owner !== first)) {
      try {
        zeroLineRef.current.owner.removePriceLine(zeroLineRef.current.line);
      } catch {
        /* owner already removed */
      }
      zeroLineRef.current = null;
    }
    if (zeroLine && first && !zeroLineRef.current) {
      zeroLineRef.current = {
        owner: first,
        line: first.createPriceLine({
          price: 0,
          color: ZERO_LINE_COLOR,
          lineWidth: 1,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: false,
          title: "",
        }),
      };
    }

    // Markers plugin follows the first series as well.
    if (markersOwnerRef.current !== first) {
      markersRef.current?.detach();
      markersRef.current = null;
      markersOwnerRef.current = null;
    }
    if (first && markers.length > 0) {
      const mapped = markers.map(
        (m): SeriesMarker<Time> => ({
          time: m.time as Time,
          position: "inBar",
          color: m.color,
          shape: "circle",
          text: m.text,
        }),
      );
      if (!markersRef.current) {
        markersRef.current = createSeriesMarkers(first, mapped);
        markersOwnerRef.current = first;
      } else {
        markersRef.current.setMarkers(mapped);
      }
    } else if (markersRef.current) {
      markersRef.current.setMarkers([]);
    }

    // Refit only when the SET of series changes, never on data refresh.
    const idsKey = series.map((b) => b.id).sort().join("|");
    if (idsKey !== prevIdsRef.current) {
      prevIdsRef.current = idsKey;
      chart.timeScale().fitContent();
    }
  }, [series, hiddenIds, zeroLine, markers, priceLineVisible, badgeLimit]);

  const toggleSeries = useCallback((id: string) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const tooltipStyle = useMemo(() => {
    if (!hover) return undefined;
    // Flip to the left of the point once past the pane's midpoint so the
    // tooltip never clips on the right edge or covers the reticle badge.
    const flip = hover.paneWidth > 0 && hover.x > hover.paneWidth / 2;
    return {
      left: hover.x,
      top: Math.max(hover.y, 8),
      transform: flip ? "translate(calc(-100% - 14px), 14px)" : "translate(14px, 14px)",
    } as const;
  }, [hover]);

  return (
    <div className="relative h-full w-full">
      <LwChartBase onChartReady={handleChartReady} options={chartOptions} />
      <CrosshairReticle point={reticle} date={reticle?.date} paneWidth={reticle?.paneWidth} />

      {pills && series.length > 0 && (
        <div className="absolute left-2 top-2 z-10 flex max-w-[calc(100%-16px)] flex-wrap gap-1.5">
          {series.map((def) => {
            const hidden = hiddenIds.has(def.id);
            return (
              <button
                key={def.id}
                type="button"
                onClick={() => toggleSeries(def.id)}
                aria-pressed={!hidden}
                title={hidden ? `${def.label} 표시` : `${def.label} 숨기기`}
                className={`inline-flex h-6 items-center gap-1.5 border border-border-subtle bg-bg-secondary px-2 transition-opacity ${
                  hidden ? "opacity-45" : ""
                }`}
              >
                {/* Swatch keeps a subtle border so dark steps (e.g. Navy-80)
                    stay legible as chips — DESIGN.md Navy-80 caveat (b). */}
                <span
                  className="inline-block h-2 w-2 shrink-0 border border-border-subtle"
                  style={{ backgroundColor: def.color }}
                />
                <span className={`text-micro ${hidden ? "text-fg-dim line-through" : "text-fg-primary"}`}>
                  {def.label}
                </span>
                {def.removable && onRemoveSeries && (
                  <span
                    role="button"
                    aria-label={`Remove ${def.label}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveSeries(def.id);
                    }}
                    className="flex items-center text-fg-dim hover:text-fg-secondary"
                  >
                    <X size={11} strokeWidth={1.5} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {tooltip && hover && tooltipStyle && (
        <div
          className="pointer-events-none absolute z-20 flex flex-col gap-0.5 border border-border-subtle bg-bg-elevated px-2 py-1.5"
          style={tooltipStyle}
        >
          {hover.date && (
            <span className="text-micro font-bold tabular-nums text-fg-primary">{hover.date}</span>
          )}
          {hover.rows.map((r) => (
            <span key={r.id} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 shrink-0 border border-border-subtle"
                style={{ backgroundColor: r.color }}
              />
              <span className="text-micro text-fg-muted">{r.label}</span>
              <span className="ml-auto pl-3 text-micro tabular-nums text-fg-primary">{r.text}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
