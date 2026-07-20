"use client";

/**
 * Component-curves hero (HARDEN-1, owner ruling) — REPLACES the quantile/σ fan
 * on the Results surface entirely. Five cumulative component curves over the
 * horizon — 조달비용 · 채권평가 · 채권캐리 · 스왑평가 · 스왑캐리 — as five
 * lines on one KRW axis, fed by the response's decompositionDaily (the same
 * engine accumulators as the waterfall's totalReturnDecomposition, so the
 * final curve values ARE the waterfall bars).
 *
 * Rules carried over:
 *  - Calendar time axis with WHITESPACE weekend/holiday slots (s15) — a
 *    missing calendar day is a { time } point, never an invented value.
 *  - valueKind:'krw' on every def (signed 억/만, s14); NO formatter key.
 *  - Badge policy (s14): five crossing series → ZERO last-value badges
 *    (lastValueBadge:false on every def); the legend below is mandatory and
 *    the crosshair tooltip carries per-day values.
 *  - Blank policy per class: a day with an excluded class is a whitespace
 *    slot (gap), and a fully-excluded class keeps its legend entry with an
 *    explicit 제외 note — never a silent 0 line.
 *  - Colors: the four SIM_SERIES component hues + --chart-series-funding
 *    (Navy-40, HARDEN-1) — all via chart-theme resolved tokens, no literals.
 *
 * Engine quantile capability and the request-level σ contract are untouched:
 * buildSimulateRequest still ships sigma_bp (default 2.0) and the backend
 * still computes distribution — this UI simply no longer renders it.
 */
import { useMemo } from "react";

import { SeriesChart, type SeriesChartSeriesDef } from "@/components/charts/series-chart";
import { getSimulationChartTheme } from "../../lib/chart-theme";
import { useSimulationPort } from "../../hooks/use-simulation";
import { dayToTime } from "../charts/lw-line-chart";
import type { DecompositionDailyPoint } from "../../api/simulate-dto";

type ComponentKey = "fundingCost" | "bondMtm" | "bondCarry" | "swapMtm" | "swapCarry";

const COMPONENTS: { key: ComponentKey; label: string }[] = [
  { key: "fundingCost", label: "조달비용" },
  { key: "bondMtm", label: "채권평가" },
  { key: "bondCarry", label: "채권캐리" },
  { key: "swapMtm", label: "스왑평가" },
  { key: "swapCarry", label: "스왑캐리" },
];

function componentColors(): Record<ComponentKey, string> {
  const t = getSimulationChartTheme();
  return {
    fundingCost: t.series.funding,
    bondMtm: t.series.mtm,
    bondCarry: t.series.carry,
    swapMtm: t.series.swapValuation,
    swapCarry: t.series.swapTheta,
  };
}

export function ComponentCurvesPanel() {
  const { lastRun, inputs } = useSimulationPort();
  const daily = useMemo<DecompositionDailyPoint[]>(
    () => lastRun?.decompositionDaily ?? [],
    [lastRun],
  );
  const swapExcluded = (lastRun?.exclusions ?? []).some((x) => x.assetClass === "swap");

  const series = useMemo<SeriesChartSeriesDef[]>(() => {
    if (daily.length === 0) return [];
    const colors = componentColors();
    const byDay = new Map(daily.map((r) => [r.day, r]));
    const lastDay = daily[daily.length - 1].day;

    return COMPONENTS.map(({ key, label }) => {
      // Calendar axis with whitespace slots (s15): every calendar day gets a
      // point — a value where a business-day row exists AND the component is
      // defined, whitespace otherwise (weekend/holiday, or excluded class).
      const data: ({ time: ReturnType<typeof dayToTime>; value: number } | { time: ReturnType<typeof dayToTime> })[] = [];
      for (let d = 0; d <= lastDay; d++) {
        const time = dayToTime(inputs.baseDate, d);
        const v = byDay.get(d)?.[key];
        if (v !== undefined && v !== null) data.push({ time, value: v });
        else data.push({ time });
      }
      return {
        id: key,
        label,
        color: colors[key],
        lineWidth: 2 as const,
        axisTitle: "",
        valueKind: "krw" as const,
        // s14 badge policy at five crossing series: zero badges, legend below.
        lastValueBadge: false,
        data,
      };
    });
  }, [daily, inputs.baseDate]);

  if (daily.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center p-4 text-center text-micro text-fg-dim">
        이 실행 결과에는 일별 성분 경로가 없습니다 — 시뮬레이션을 다시 실행하면
        성분 커브가 표시됩니다.
      </div>
    );
  }

  const colors = componentColors();

  return (
    <div className="flex h-full w-full flex-col p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-body-strong text-fg-primary">성분 누적 경로</h3>
        <span data-num className="text-micro text-fg-muted">
          D+0 ~ D+{daily[daily.length - 1].day} · 합계 = 토탈 (±₩1)
        </span>
      </div>
      <div className="min-h-0 flex-1">
        {/* Crosshair tooltip carries the per-day values the (zero) badges
            don't; zeroLine anchors the sign reading; no per-series dotted
            last-price lines at five crossing series. */}
        <SeriesChart series={series} tooltip zeroLine priceLineVisible={false} />
      </div>
      {/* Mandatory legend (badge policy: zero badges at five series). */}
      <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-micro">
        {COMPONENTS.map(({ key, label }) => {
          const excluded = swapExcluded && (key === "swapMtm" || key === "swapCarry");
          return (
            <span key={key} className="inline-flex items-center gap-1.5 text-fg-muted">
              <span className="inline-block h-0.5 w-4" style={{ backgroundColor: colors[key] }} />
              {label}
              {excluded && <span className="text-fg-dim">제외 —</span>}
            </span>
          );
        })}
      </div>
    </div>
  );
}
