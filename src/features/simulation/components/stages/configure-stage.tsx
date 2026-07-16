"use client";

/**
 * Configure stage (s15 T3) — the first screen of the staged Simulation flow.
 * Restructured from the s4/s11 ScenarioConfigPanel (whose dockview panel this
 * supersedes): only what the user actually adjusts sits on top — horizon
 * segment group, target move, σ stepper — while the path waypoints, curve
 * spreads and 금통위 이벤트 collapse into "고급 설정" accordions (collapsed by
 * default). A live curve preview (CurveViewPanel, unchanged) sits beside the
 * controls, and the single full-width 시뮬레이션 실행 CTA spans the stage.
 *
 * Control-surface relayout only: same store keys (simDays: number, waypoints
 * {day, bp:number}, sigmaBp/baseShockBp strings), same defaults, same simulate
 * payload for equivalent selections. The waypoint clamp (±max(|baseShock|+50,
 * 100)) and the s13 σ clamp (0, 25] are kept on steppers and typed commits.
 */
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { toNum } from "../../lib/scenario-curves";
import { useSimulationDataStore } from "../../store/simulation-data-store";
import { useSimulationPort } from "../../hooks/use-simulation";
import { CurveViewPanel } from "../panels/curve-view-panel";

const CREDIT_SECTORS = ["특은채", "은행채", "카드채", "회사채"] as const;
const TENOR_SPREADS = [
  { key: "spread1y", label: "1Y 기준" },
  { key: "spread10y", label: "10Y 기준" },
  { key: "spread30y", label: "30Y 기준" },
] as const;

// Horizon presets, all multiples of 30 so the waypoint regen (floor(simDays/30))
// lands on clean 30d steps. 180 is DEFAULT_SCENARIO_PARAMS.simDays.
const HORIZON_CHOICES = [30, 60, 90, 180, 270, 365] as const;

const WAYPOINT_STEP_BP = 5;

/**
 * Segmented button group (mutually exclusive choice). Composed from the Button
 * primitive — pressed state reuses the accent-ghost recipe the "+ 추가" button
 * established (border-sem-info / bg-sem-info-ghost / text-sem-info); no new
 * visual language. A value outside `choices` (possible if the store was
 * patched elsewhere) simply renders with no segment pressed — never coerced.
 */
function SegmentedButtons({
  choices,
  value,
  onChange,
  format,
  label,
}: {
  choices: readonly number[];
  value: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex w-full border border-border-subtle">
      {choices.map((c) => (
        <Button
          key={c}
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={value === c}
          onClick={() => onChange(c)}
          data-num
          className={cn(
            "min-w-0 flex-1 px-0 text-micro",
            value === c
              ? "bg-sem-info-ghost text-sem-info shadow-[inset_0_0_0_1px_var(--sem-info)]"
              : "text-fg-muted",
          )}
        >
          {format(c)}
        </Button>
      ))}
    </div>
  );
}

/**
 * Numeric bp field with a local draft so partial input ("-", "1.") can be typed:
 * every keystroke commits toNum(text) clamped to [min, max], the draft renders
 * verbatim until blur, then snaps to the store value. Commits round to 3
 * decimals so fractional steps (σ ±0.5) never leak float noise into the store.
 */
function BpStepperField({
  value,
  min,
  max,
  step,
  onCommit,
  ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (bp: number) => void;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (n: number) => Math.round(Math.max(min, Math.min(max, n)) * 1000) / 1000;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <Button
        type="button"
        variant="icon"
        size="sm"
        aria-label={`${ariaLabel} ${step}bp 감소`}
        onClick={() => onCommit(clamp(value - step))}
      >
        −
      </Button>
      <div className="min-w-0 flex-1">
        <Input
          type="text"
          inputMode="decimal"
          data-num
          aria-label={ariaLabel}
          className="text-right"
          value={draft ?? String(value)}
          onChange={(e) => {
            setDraft(e.target.value);
            onCommit(clamp(toNum(e.target.value)));
          }}
          onBlur={() => setDraft(null)}
        />
      </div>
      <Button
        type="button"
        variant="icon"
        size="sm"
        aria-label={`${ariaLabel} ${step}bp 증가`}
        onClick={() => onCommit(clamp(value + step))}
      >
        +
      </Button>
    </div>
  );
}

export function ConfigureStage() {
  const { params, inputs, status, patchParams, runCurrent } = useSimulationPort();
  const canRun = inputs.positions.length > 0 && status !== "running";

  // Regenerate intermediate waypoints (every 30d) when horizon/target changes,
  // preserving edited bp values — the source's waypoints useEffect. Reads fresh
  // store state to avoid a stale-closure over waypoints.
  useEffect(() => {
    const { params: p, patchParams: patch } = useSimulationDataStore.getState();
    const result: { day: number; bp: number }[] = [{ day: 0, bp: 0 }];
    const numSteps = Math.floor(p.simDays / 30);
    for (let i = 1; i < numSteps; i++) {
      const day = i * 30;
      result.push({ day, bp: p.waypoints.find((w) => w.day === day)?.bp ?? 0 });
    }
    result.push({ day: p.simDays, bp: toNum(p.baseShockBp) });
    patch({ waypoints: result });
  }, [params.simDays, params.baseShockBp]);

  const setWaypoint = (day: number, bp: number) =>
    patchParams({ waypoints: params.waypoints.map((w) => (w.day === day ? { ...w, bp } : w)) });

  const bpTone = (bp: number) =>
    // iv3: Jade/Berry universal pair, sign convention preserved from the old
    // green/red (rates UP = adverse = Berry; rates DOWN = Jade).
    bp > 0 ? "text-chart-pnl-neg" : bp < 0 ? "text-chart-pnl-pos" : "text-fg-muted";

  const eventCount = params.shortEndEvents.filter((e) => e.date).length;
  const nextEventId = () => (params.shortEndEvents.reduce((m, e) => Math.max(m, e.id), -1) + 1);
  const waypointCount = params.waypoints.slice(1, -1).filter((w) => w.bp !== 0).length;

  return (
    <div className="flex h-full w-full flex-col p-4">
      <div className="mb-4">
        <h2 className="text-h2 text-fg-primary">시나리오 조건 설정</h2>
        <p className="text-micro text-fg-muted mt-1">국채 3Y 기준 금리 경로 설계 · 포트 연동</p>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-y-auto lg:grid-cols-[minmax(320px,420px)_1fr] lg:overflow-hidden">
        {/* ── Controls column ── */}
        <div className="space-y-5 lg:overflow-y-auto lg:pr-1">
          {/* 1. 시뮬레이션 기간 — segmented buttons (s11 T2) */}
          <div>
            <label className="mb-2 block text-label uppercase text-fg-muted">시뮬레이션 기간</label>
            <SegmentedButtons
              choices={HORIZON_CHOICES}
              value={params.simDays}
              onChange={(v) => patchParams({ simDays: v })}
              format={(v) => `${v}D`}
              label="시뮬레이션 기간"
            />
            <div data-num className="mt-1 text-right text-body-strong text-sem-info">{params.simDays} Days</div>
          </div>

          {/* 2. Base 충격 */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-label uppercase text-fg-muted">국채 3Y 목표 변동</label>
              <span className="bg-bg-tertiary px-2 py-0.5 text-micro text-fg-muted">D+{params.simDays} 고정</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <Input
                  type="text"
                  inputMode="decimal"
                  value={params.baseShockBp}
                  onChange={(e) => patchParams({ baseShockBp: e.target.value })}
                  data-num
                  className="text-right"
                />
              </div>
              <span className="text-body text-fg-muted">bp</span>
            </div>
          </div>

          {/* 3. 분포 σ — s13: 팬 차트의 bp/√영업일 불확실성, (0, 25] 클램프 */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-label uppercase text-fg-muted">분포 σ (팬 차트)</label>
              <span className="text-micro text-fg-dim">bp/√day</span>
            </div>
            <BpStepperField
              value={toNum(params.sigmaBp)}
              min={0.1}
              max={25}
              step={0.5}
              onCommit={(v) => patchParams({ sigmaBp: String(v) })}
              ariaLabel="분포 σ"
            />
          </div>

          {/* ── 고급 설정 (collapsed by default) ── */}
          <div className="border-t border-border-subtle pt-4">
            <p className="mb-2 text-label uppercase text-fg-muted">고급 설정</p>

            {/* 3a. 경로 설정 (waypoints) */}
            <details className="py-1.5">
              <summary className="flex cursor-pointer list-none items-center justify-between text-body-strong text-fg-secondary hover:text-fg-primary">
                <span>경로 설정 (국채 3Y 웨이포인트)</span>
                {waypointCount > 0 && (
                  <span data-num className="text-micro text-sem-info">{waypointCount}개 조정</span>
                )}
              </summary>
              <div className="mt-3 space-y-2.5">
                <div className="flex select-none items-center gap-2 opacity-40">
                  <span data-num className="w-12 flex-shrink-0 text-micro text-fg-muted">D+0</span>
                  <div className="h-1 flex-1 bg-bg-tertiary" />
                  <span data-num className="w-14 flex-shrink-0 text-right text-micro text-fg-muted">0 bp</span>
                </div>

                {params.waypoints.slice(1, -1).map((wp) => {
                  const absMax = Math.max(Math.abs(toNum(params.baseShockBp)) + 50, 100);
                  return (
                    <div key={wp.day} className="flex items-center gap-2">
                      <span data-num className="w-12 flex-shrink-0 text-micro text-fg-muted">D+{wp.day}</span>
                      <BpStepperField
                        value={wp.bp}
                        min={-absMax}
                        max={absMax}
                        step={WAYPOINT_STEP_BP}
                        onCommit={(bp) => setWaypoint(wp.day, bp)}
                        ariaLabel={`D+${wp.day} 변동폭`}
                      />
                      <span data-num className={`w-14 flex-shrink-0 text-right text-micro font-semibold ${bpTone(wp.bp)}`}>
                        {wp.bp >= 0 ? "+" : ""}{wp.bp} bp
                      </span>
                    </div>
                  );
                })}

                <div className="flex select-none items-center gap-2 opacity-40">
                  <span data-num className="w-12 flex-shrink-0 text-micro text-fg-muted">D+{params.simDays}</span>
                  <div className="h-1 flex-1 bg-bg-tertiary" />
                  <span data-num className={`w-14 flex-shrink-0 text-right text-micro font-semibold ${bpTone(toNum(params.baseShockBp))}`}>
                    {toNum(params.baseShockBp) >= 0 ? "+" : ""}{params.baseShockBp} bp
                  </span>
                </div>
              </div>
            </details>

            {/* 3b. 커브 스프레드 설정 */}
            <details className="border-t border-border-subtle py-1.5">
              <summary className="cursor-pointer list-none text-body-strong text-fg-secondary hover:text-fg-primary">
                커브 스프레드 설정
              </summary>
              <div className="mt-3 space-y-4">
                <div>
                  <p className="mb-2 text-micro text-fg-dim">국고채 테너 스프레드 (vs 국채 3Y)</p>
                  <div className="space-y-1.5">
                    {TENOR_SPREADS.map(({ key, label }) => (
                      <div key={key} className="flex items-center gap-2">
                        <span className="w-14 flex-shrink-0 text-micro text-fg-muted">{label}</span>
                        <div className="min-w-0 flex-1">
                          <Input
                            type="text"
                            inputMode="decimal"
                            value={params[key]}
                            onChange={(e) => patchParams({ [key]: e.target.value })}
                            data-num
                            className="text-right"
                          />
                        </div>
                        <span className="w-5 flex-shrink-0 text-micro text-fg-dim">bp</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-micro text-fg-dim">크레딧 스프레드 (국채 대비 추가)</p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                    {CREDIT_SECTORS.map((sector) => (
                      <div key={sector} className="flex items-center gap-1.5">
                        <span className="w-10 flex-shrink-0 text-micro text-fg-muted">{sector}</span>
                        <div className="min-w-0 flex-1">
                          <Input
                            type="text"
                            inputMode="decimal"
                            value={params.creditSpreads[sector] ?? "0"}
                            onChange={(e) =>
                              patchParams({ creditSpreads: { ...params.creditSpreads, [sector]: e.target.value } })
                            }
                            data-num
                            className="text-right"
                          />
                        </div>
                        <span className="text-micro text-fg-dim">bp</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="w-14 flex-shrink-0 text-micro text-fg-muted">IRS 스프레드</span>
                  <div className="min-w-0 flex-1">
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={params.irsSpread}
                      onChange={(e) => patchParams({ irsSpread: e.target.value })}
                      data-num
                      className="text-right"
                    />
                  </div>
                  <span className="w-5 flex-shrink-0 text-micro text-fg-dim">bp</span>
                </div>
              </div>
            </details>

            {/* 3c. 금통위 이벤트 */}
            <details className="border-t border-border-subtle py-1.5">
              <summary className="flex cursor-pointer list-none items-center justify-between text-body-strong text-fg-secondary hover:text-fg-primary">
                <span>금통위 이벤트 (기준금리)</span>
                {eventCount > 0 && <span data-num className="text-micro text-sem-info">{eventCount}건</span>}
              </summary>
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-micro text-fg-dim">날짜 · 변동폭 (bp)</span>
                  <button
                    type="button"
                    onClick={() =>
                      patchParams({
                        shortEndEvents: [...params.shortEndEvents, { id: nextEventId(), date: "", shiftBp: "-25" }],
                      })
                    }
                    className="border border-sem-info bg-sem-info-ghost px-2 py-0.5 text-micro text-sem-info transition-colors hover:bg-sem-info-soft"
                  >
                    + 추가
                  </button>
                </div>

                {params.shortEndEvents.length === 0 ? (
                  <p className="py-2 text-center text-micro text-fg-dim">등록된 이벤트 없음</p>
                ) : (
                  <div className="space-y-1.5">
                    {params.shortEndEvents.map((ev) => (
                      <div key={ev.id} className="flex items-center gap-1.5">
                        <div className="min-w-0 flex-1">
                          <Input
                            type="date"
                            value={ev.date}
                            onChange={(e) =>
                              patchParams({
                                shortEndEvents: params.shortEndEvents.map((x) =>
                                  x.id === ev.id ? { ...x, date: e.target.value } : x,
                                ),
                              })
                            }
                          />
                        </div>
                        <div className="w-16 flex-shrink-0">
                          <Input
                            type="text"
                            inputMode="decimal"
                            value={ev.shiftBp}
                            onChange={(e) =>
                              patchParams({
                                shortEndEvents: params.shortEndEvents.map((x) =>
                                  x.id === ev.id ? { ...x, shiftBp: e.target.value } : x,
                                ),
                              })
                            }
                            data-num
                            className="px-2 text-right"
                            placeholder="bp"
                          />
                        </div>
                        <span className="flex-shrink-0 text-micro text-fg-dim">bp</span>
                        <button
                          type="button"
                          onClick={() =>
                            patchParams({ shortEndEvents: params.shortEndEvents.filter((x) => x.id !== ev.id) })
                          }
                          className="flex-shrink-0 text-body leading-none text-fg-dim hover:text-sem-danger"
                          aria-label="이벤트 삭제"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </details>
          </div>
        </div>

        {/* ── Live curve preview (beside the controls) ── */}
        <div className="min-h-[240px] bg-bg-secondary lg:min-h-0">
          <CurveViewPanel />
        </div>
      </div>

      <Button
        type="button"
        variant="primary"
        size="lg"
        disabled={!canRun}
        onClick={() => void runCurrent()}
        className="mt-4 w-full"
        title={inputs.positions.length === 0 ? "포지션 입력 필요 (포트폴리오 스토어 연동)" : undefined}
      >
        {status === "running" ? "계산 중..." : "시뮬레이션 실행"}
      </Button>
    </div>
  );
}
