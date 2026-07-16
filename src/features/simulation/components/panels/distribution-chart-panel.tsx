"use client";

/**
 * Distribution / Total-Return panel — s18 T3 dual-axis separation (이중축 분리).
 *
 * The s15 fan exposed a LABELING problem: bands keyed to their generating
 * rate-quantile scenario are honest math, but a return band labeled "P95" is a
 * false claim on a non-monotone book (the p95 RATE scenario is not the p95
 * RETURN — 76/121 days crossed on the live book), and a filled fan visually
 * asserts an ordering that holds on a minority of days. Owner decision:
 *
 *  - RATE fan (primary, top): quantile bands over the 국채 3Y rate path
 *    (distribution.ratePaths). Rates are monotone in the quantile by
 *    construction → bands never cross → P5..P95 labels are truthful here
 *    (RateFanChart + fan-labels.ts rateBandLabel).
 *  - RETURN panel (below): ONE LINE per scenario, keyed to its generating
 *    rate quantile and labeled BY SCENARIO (fan-labels.ts
 *    returnScenarioLabel — e.g. "금리 P95 시나리오"). No fill, no band, no
 *    implied ordering; crossings render naturally as crossing lines. A bare
 *    outcome-rank label ("P95") on this panel is a regression (pinned by
 *    fan-labels.test.ts incl. a source scan of this file).
 *
 * The center return line stays pinned to the BASE run (p50 == chartData
 * .totalPnL byte-equal, σ-independent — backend invariant, unchanged). No
 * per-day sorting anywhere — that was the original defect.
 *
 * s18 T6 → APPLIED at integration v4: every def the `line()` helper returns
 * declares `valueKind: "krw"` (series-defaults resolves the SIGNED 억/만
 * formatter — losses read negative on a return panel, confirmed live) and the
 * center def carries `primary: true` (the badge-collision policy keeps
 * exactly that badge). No `formatter:` key anywhere — an explicit formatter
 * would override the valueKind default and suppress the signed variant.
 * Pinned by distribution-chart-panel.test.tsx.
 *   STANDING RULE (root cause of the s15 raw floats, proven from the LWC
 *     5.2 source — PriceScale._updateFormatter picks the formatter from the
 *     LOWEST-Z-ORDER series on the scale): s15's FanBandSeries was pushed to
 *     z-order −1 via setSeriesOrder(-1) WITHOUT a priceFormat, so the whole
 *     right scale (ticks + every badge) reverted to raw default formatting no
 *     matter what the line defs declared. This panel no longer has a band
 *     series — but any series sent below the lines via setSeriesOrder MUST
 *     carry the same priceFormat as the lines (see rate-fan-chart.tsx).
 *     minMove/creation order were red herrings. See REPORT_s18 T6. Guarded
 *     repo-wide by scripts/check_zorder_priceformat.test.ts (the 4th member
 *     of the lightweight-charts defect family: canvas-var colors ×3,
 *     index-vs-calendar axes, and now z-order formatter capture).
 *
 * T4 (carry visibility, s11): the additive `fundingCurve` renders as a slim
 * bottom pane of the return chart (step line + badge); the header readout
 * shows funding/운용/carry at the hovered time. With the s18 funding spec the
 * strip is the 기준금리+10bp constant (2.85%) on every row.
 *
 * Responses without `distribution` fall back to the S5/S7 five-series view;
 * responses with bands but no ratePaths (older cached runs) get the return
 * lines without the rate fan — rank-labeled return bands are never
 * resurrected.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import { LineSeries, LineType } from "lightweight-charts";

import { formatKrwAxisSigned } from "@/lib/format";
import {
  SeriesChart,
  type SeriesChartMarker,
  type SeriesChartSeriesDef,
} from "@/components/charts/series-chart";
import { getSimulationChartTheme } from "../../lib/chart-theme";
import { useSimulationPort } from "../../hooks/use-simulation";
import { dayToTime } from "../charts/lw-line-chart";
import { RateFanChart } from "../charts/rate-fan-chart";
import {
  FAN_PERCENTILES,
  rateBandLabel,
  returnScenarioLabel,
  returnScenarioShortLabel,
  type FanPercentile,
} from "../../lib/fan-labels";
import type { DistributionBand, FundingCurvePoint } from "../../api/simulate-dto";

const asNum = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

const formatPct = (v: number) => `${v.toFixed(2)}%`;
const formatBp = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}bp`;

/** Hover readout for the funding strip: funding / position / carry at a time. */
function FundingReadout({ point, hovered }: { point: FundingCurvePoint; hovered: boolean }) {
  return (
    <span className="flex items-baseline gap-2 whitespace-nowrap text-micro text-fg-muted" data-num>
      <span className="text-fg-dim">{hovered ? `D+${point.day}` : "현재"}</span>
      <span>
        Funding <span className="text-fg-primary">{formatPct(point.fundingRate * 100)}</span>
      </span>
      <span>
        운용{" "}
        <span className="text-fg-primary">
          {point.positionRate === null ? "—" : formatPct(point.positionRate * 100)}
        </span>
      </span>
      <span>
        Carry{" "}
        <span className={point.carryBp === null ? "text-fg-dim" : point.carryBp >= 0 ? "text-chart-pnl-pos" : "text-chart-pnl-neg"}>
          {point.carryBp === null ? "—" : formatBp(point.carryBp)}
        </span>
      </span>
    </span>
  );
}

/** Per-scenario return values at the hovered day — SCENARIO labels, never
 * outcome ranks. The scenario lines are panel-added (not crosshair-tooltip
 * series), so this readout is where their values read. */
function ReturnReadout({ band }: { band: DistributionBand }) {
  const cells = ([95, 75, 25, 5] as FanPercentile[]).map((pct) => ({
    label: returnScenarioShortLabel(pct),
    value: band[`p${pct}` as "p95"],
  }));
  return (
    <span className="flex items-baseline gap-2 whitespace-nowrap text-micro text-fg-muted" data-num>
      {cells.map((c) => (
        <span key={c.label}>
          {c.label} <span className="text-fg-primary">{formatKrwAxisSigned(c.value)}</span>
        </span>
      ))}
    </span>
  );
}

/** Scenario line hue per percentile — four DISTINCT hues because the lines may
 * cross; all resolved theme tokens (no literals — slice lint block C). */
function scenarioColors(): Record<Exclude<FanPercentile, 50>, string> {
  const t = getSimulationChartTheme();
  return { 95: t.series.carry, 75: t.previewPalette[1], 25: t.series.swapValuation, 5: t.series.swapTheta };
}

export function DistributionChartPanel() {
  const { lastRun, inputs, status } = useSimulationPort();
  const [chart, setChart] = useState<IChartApi | null>(null);
  const scenarioSeriesRef = useRef<Map<number, ISeriesApi<"Line">>>(new Map());
  const fundingSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const [hoverDay, setHoverDay] = useState<number | null>(null);

  const distribution = lastRun?.distribution ?? null;
  const fundingCurve = lastRun?.fundingCurve ?? null;
  const hasScenarios = Boolean(distribution && distribution.bands.length > 0);
  const ratePaths = distribution?.ratePaths ?? null;

  // ── SeriesChart defs: the CENTER (base-run) return line only ──────────────
  const series = useMemo<SeriesChartSeriesDef[]>(() => {
    if (!lastRun) return [];
    const t = getSimulationChartTheme();
    // iv4 (s18 T6 TODO applied): valueKind resolves the signed 억/만 formatter
    // from series-defaults; `primary` marks the one badge the collision policy
    // keeps. Deliberately still NO `formatter:` key — it would override the
    // valueKind default and suppress the signed variant.
    const line = (
      id: string,
      label: string,
      color: string,
      data: { time: ReturnType<typeof dayToTime>; value: number }[],
      lineWidth: 1 | 2 | 3 | 4 = 2,
      primary = false,
    ): SeriesChartSeriesDef => ({
      id,
      label,
      color,
      lineWidth,
      axisTitle: "",
      valueKind: "krw",
      primary,
      data,
    });

    const rows = lastRun.chartData;
    const fromRows = (key: string) =>
      rows.map((r) => ({ time: dayToTime(inputs.baseDate, asNum(r.day)), value: asNum(r[key]) }));

    if (hasScenarios) {
      // Center pinned to the BASE run (byte-equal to the p50 rate scenario).
      return [line("base", returnScenarioLabel(50), t.series.total, fromRows("totalPnL"), 3, true)];
    }

    // Fallback: the S5/S7 five-series Total-Return view for responses without
    // the s11 distribution field. 합계 is the primary badge; the component
    // lines read via crosshair (s14 collision policy — five stacked badges
    // was the s15 before-state defect).
    return [
      line("mtmPnL", "MTM", t.series.mtm, fromRows("mtmPnL")),
      line("cumulativeCarry", "캐리", t.series.carry, fromRows("cumulativeCarry")),
      line("swapThetaPnL", "스왑세타", t.series.swapTheta, fromRows("swapThetaPnL")),
      line("swapValuationPnL", "스왑평가", t.series.swapValuation, fromRows("swapValuationPnL")),
      line("totalPnL", "합계", t.series.total, fromRows("totalPnL"), 3, true),
    ];
  }, [lastRun, inputs.baseDate, hasScenarios]);

  const markers = useMemo<SeriesChartMarker[]>(() => {
    const bep = lastRun?.summary.breakEvenDay ?? -1;
    if (!lastRun || bep <= 0) return [];
    return [{ time: dayToTime(inputs.baseDate, bep), text: "BEP", color: getSimulationChartTheme().bepLine }];
  }, [lastRun, inputs.baseDate]);

  const chartOptions = useMemo(
    () => ({
      layout: {
        background: { color: getSimulationChartTheme().background },
        // s15 T4(b): the library's attribution logo was the "broken glyph".
        attributionLogo: false,
      },
    }),
    [],
  );

  const handleChartReady = useCallback((c: IChartApi) => {
    setChart(c);
    c.subscribeCrosshairMove((params) => {
      if (params.time == null) {
        setHoverDay(null);
        return;
      }
      setHoverDay(typeof params.time === "number" ? params.time : null);
    });
  }, []);

  // ── scenario return LINES + funding strip, via the onChartReady seam ──────
  useEffect(() => {
    if (!chart) return;
    const t = getSimulationChartTheme();

    if (hasScenarios && distribution) {
      const colors = scenarioColors();
      const lastDay = distribution.bands[distribution.bands.length - 1].day;
      const byDay = new Map(distribution.bands.map((b) => [b.day, b]));
      for (const pct of FAN_PERCENTILES) {
        if (pct === 50) continue; // the center is the SeriesChart def (base run)
        let s = scenarioSeriesRef.current.get(pct);
        if (!s) {
          s = chart.addSeries(LineSeries, {
            color: colors[pct as Exclude<FanPercentile, 50>],
            lineWidth: 1,
            priceLineVisible: false,
            // One badge on the panel: the center line's. Scenario values read
            // via the header ReturnReadout.
            lastValueVisible: false,
            title: "",
          });
          scenarioSeriesRef.current.set(pct, s);
        }
        // Whitespace calendar slots between business-day rows (s15 rule) so
        // weekend moves keep their true width — no invented points.
        const data: ({ time: ReturnType<typeof dayToTime> } | { time: ReturnType<typeof dayToTime>; value: number })[] = [];
        for (let d = 0; d <= lastDay; d++) {
          const time = dayToTime(inputs.baseDate, d);
          const b = byDay.get(d);
          if (b) data.push({ time, value: b[`p${pct}` as "p95"] });
          else data.push({ time });
        }
        s.setData(data as never);
      }
      // New run replaces outright — refit after the stage layout settles
      // (immediate fit keeps the pre-layout width; observed live in s15).
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          try {
            chart.timeScale().fitContent();
          } catch {
            /* disposed mid-transition */
          }
        }),
      );
    } else {
      for (const s of scenarioSeriesRef.current.values()) s.setData([]);
    }

    // Funding strip: slim bottom pane sharing the time axis. Full custom
    // priceFormat incl. minMove — this badge has always formatted correctly.
    if (fundingCurve && fundingCurve.length > 0) {
      if (!fundingSeriesRef.current) {
        const s = chart.addSeries(
          LineSeries,
          {
            color: t.series.carry,
            lineWidth: 1,
            lineType: LineType.WithSteps,
            priceLineVisible: false,
            lastValueVisible: true,
            title: "",
            priceFormat: { type: "custom", formatter: formatPct, minMove: 0.001 },
          },
          1,
        );
        fundingSeriesRef.current = s;
        try {
          chart.panes()[1]?.setHeight(56);
        } catch {
          /* pane sizing is cosmetic — older lib builds keep the default split */
        }
      }
      fundingSeriesRef.current.setData(
        fundingCurve.map((p) => ({
          time: dayToTime(inputs.baseDate, p.day),
          value: p.fundingRate * 100,
        })) as never,
      );
    } else if (fundingSeriesRef.current) {
      fundingSeriesRef.current.setData([]);
    }
  }, [chart, hasScenarios, distribution, fundingCurve, inputs.baseDate]);

  // Refs die with the chart (LwChartBase disposes it); drop them so a remount
  // doesn't touch disposed series.
  useEffect(() => {
    if (!chart) return;
    return () => {
      scenarioSeriesRef.current = new Map();
      fundingSeriesRef.current = null;
    };
  }, [chart]);

  // ── hover → D+day resolution shared by the readouts ───────────────────────
  const hoveredDayIndex = useMemo<number | null>(() => {
    if (hoverDay === null || !inputs.baseDate) return null;
    const base = dayToTime(inputs.baseDate, 0);
    return Math.round((hoverDay - base) / 86400);
  }, [hoverDay, inputs.baseDate]);

  const readoutPoint = useMemo<FundingCurvePoint | null>(() => {
    if (!fundingCurve || fundingCurve.length === 0) return null;
    if (hoveredDayIndex !== null) {
      const hit = fundingCurve.filter((p) => p.day <= hoveredDayIndex).at(-1);
      if (hit) return hit;
    }
    return fundingCurve[fundingCurve.length - 1];
  }, [fundingCurve, hoveredDayIndex]);

  const readoutBand = useMemo<DistributionBand | null>(() => {
    if (!distribution || distribution.bands.length === 0) return null;
    if (hoveredDayIndex !== null) {
      const hit = distribution.bands.filter((b) => b.day <= hoveredDayIndex).at(-1);
      if (hit) return hit;
    }
    return distribution.bands[distribution.bands.length - 1];
  }, [distribution, hoveredDayIndex]);

  if (!lastRun) {
    return (
      <div className="flex h-full w-full items-center justify-center p-4 text-center">
        <p className="text-body text-fg-muted">
          {status === "running" ? "엔진 계산 중..." : "시뮬레이션을 실행하면 Total Return 분포가 표시됩니다."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col p-3">
      {/* ── 1축: 금리 팬 — 라벨이 진실인 축 (구성상 절대 비교차) ── */}
      {ratePaths && ratePaths.length > 0 && (
        <>
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="text-body-strong text-fg-primary">금리 경로 분위수 (국채 3Y, bp)</h3>
            <div className="flex items-baseline gap-3">
              {distribution && (
                <span className="text-micro text-fg-dim" data-num>
                  σ {distribution.sigmaBpDaily.toFixed(1)}bp/일 · 만기 ±{distribution.sigmaTerminalBp.toFixed(1)}bp
                </span>
              )}
              <span className="flex items-baseline gap-2 text-micro text-fg-dim" data-num>
                {FAN_PERCENTILES.map((pct) => (
                  <span key={pct} className={pct === 50 ? "text-fg-primary" : undefined}>
                    {rateBandLabel(pct)}
                  </span>
                ))}
              </span>
            </div>
          </div>
          <div className="mb-2 h-[160px] flex-shrink-0">
            <RateFanChart ratePaths={ratePaths} baseDate={inputs.baseDate} />
          </div>
        </>
      )}

      {/* ── 2축: 시나리오별 수익 라인 — 순위 라벨 금지, 교차가 정보 ── */}
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-body-strong text-fg-primary">
          {hasScenarios ? "시나리오별 Total Return" : "Total Return 누적 궤적"}
        </h3>
        <div className="flex flex-wrap items-baseline gap-3">
          {readoutBand && <ReturnReadout band={readoutBand} />}
          {readoutPoint && <FundingReadout point={readoutPoint} hovered={hoverDay !== null} />}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <SeriesChart
          series={series}
          pills
          tooltip
          zeroLine
          markers={markers}
          priceLineVisible={false}
          chartOptions={chartOptions}
          onChartReady={handleChartReady}
        />
      </div>
      {hasScenarios && (
        <p className="mt-1 text-micro text-fg-dim">
          라인 = 각 금리 분위수 시나리오의 실제 엔진 런 · 중앙선 = 기본 시나리오 (금리 P50 런과 바이트 동일) · 교차는 비단조 북의 정보 — 수익 축에는 순위 라벨을 쓰지 않는다
        </p>
      )}
    </div>
  );
}
