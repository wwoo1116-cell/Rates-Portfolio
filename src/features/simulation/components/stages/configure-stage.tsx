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

import { anchorConversionError, toNum } from "../../lib/scenario-curves";
import { ANCHOR_TENOR_CHOICES } from "../../types/simulation-port";
import {
  WAYPOINT_STEP_BP,
  buildWaypointPatch,
  lerpDefaultBp,
  waypointClampMax,
} from "../../lib/waypoints";
import { useSimulationDataStore } from "../../store/simulation-data-store";
import { useSimulationPort } from "../../hooks/use-simulation";
import { useMarketDateRange } from "../../hooks/use-input-curves";
import { SegmentedButtons } from "../segmented-buttons";
import { CurveViewPanel } from "../panels/curve-view-panel";

// FB5 B1 (ruling ①) — the credit-spread rows are labeled with the PVBP sector
// taxonomy (the vocabulary the M1/M2 grids and the 커브형 chips use), while the
// underlying creditSpreads param KEY stays the shock-curve family the engine
// reads (generateShockCurves): payload byte-identical, display honest. Mapping
// is the engine's own get_sector_curve_key inverse: 은행채→시은채, 카드채→여전채
// (특은채·회사채 share the name across both vocabularies).
const CREDIT_SECTORS = [
  { key: "특은채", label: "특은채" },
  { key: "은행채", label: "시은채" },
  { key: "카드채", label: "여전채" },
  { key: "회사채", label: "회사채" },
] as const;
const TENOR_SPREADS = [
  { key: "spread1y", label: "1Y 기준" },
  { key: "spread10y", label: "10Y 기준" },
  { key: "spread30y", label: "30Y 기준" },
] as const;

// FB4 T1 — the horizon is edited as a 마감일 calendar date; the store contract
// stays baseDate + simDays (마감일 is DERIVED, never stored). 365 is the same
// max the old 30D~365D segment row offered — exceeding it is an explicit
// validation message, never a silent clamp.
export const MAX_HORIZON_DAYS = 365;

/** ISO date + n days (UTC arithmetic — the codebase's established pattern). */
export function addDaysIso(iso: string, n: number): string {
  return new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);
}

/** Whole days from ISO a → b (positive when b is after a). */
export function diffDaysIso(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
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

/**
 * FB4 T1 — 시작일 calendar (= 평가 기준일 / baseDate). Replaces the old
 * stepper control: a plain calendar field bounded by the backend's market-data
 * range, plus the 오늘로 reset. Writes the slice's userBaseDate exactly as
 * before (the app-layer bridge folds it into inputs.baseDate, so the preview
 * quotes, swap filtering, and the simulate payload all follow one date).
 * Weekend/holiday dates behave exactly as the old control did — the value is
 * taken as typed, no snapping invented (the backend answers honestly for
 * non-business days; s18 rule).
 */
function StartDateControl({ baseDate }: { baseDate: string }) {
  const userBaseDate = useSimulationDataStore((s) => s.userBaseDate);
  const setUserBaseDate = useSimulationDataStore((s) => s.setUserBaseDate);
  const { data: range } = useMarketDateRange();

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label className="text-label uppercase text-fg-muted label-nowrap">
          시작일 (평가 기준일)
        </label>
        {userBaseDate && (
          <button
            type="button"
            onClick={() => setUserBaseDate(null)}
            className="border border-sem-info bg-sem-info-ghost px-2 py-0.5 text-micro text-sem-info transition-colors hover:bg-sem-info-soft label-nowrap"
          >
            오늘로
          </button>
        )}
      </div>
      <Input
        type="date"
        aria-label="시작일 (평가 기준일)"
        data-num
        value={baseDate}
        min={range?.min_date}
        max={range?.max_date}
        onChange={(e) => setUserBaseDate(e.target.value || null)}
      />
    </div>
  );
}

/**
 * FB4 T1 — 마감일 calendar (= horizon end). Replaces the 30D~365D segment
 * row. DERIVED editor over the existing contract: value = 시작일 + simDays;
 * committing a date writes simDays = diffDays(시작일, 마감일). Invalid picks
 * (마감일 ≤ 시작일, or beyond the 365-day cap) show an EXPLICIT message and
 * write nothing — never a silent clamp. Changing 시작일 keeps simDays (the
 * 마감일 display shifts with it), preserving the old control's semantics.
 */
function EndDateControl({ baseDate, simDays }: { baseDate: string; simDays: number }) {
  const { patchParams } = useSimulationPort();
  const [error, setError] = useState<string | null>(null);

  const endDate = baseDate ? addDaysIso(baseDate, simDays) : "";
  const maxEnd = baseDate ? addDaysIso(baseDate, MAX_HORIZON_DAYS) : undefined;

  const commit = (raw: string) => {
    if (!raw || !baseDate) return;
    const d = diffDaysIso(baseDate, raw);
    if (d <= 0) {
      setError("마감일은 시작일 이후여야 합니다.");
      return;
    }
    if (d > MAX_HORIZON_DAYS) {
      setError(`최대 기간 ${MAX_HORIZON_DAYS}일을 초과합니다 — ${maxEnd} 이하로 선택하세요.`);
      return;
    }
    setError(null);
    patchParams({ simDays: d });
  };

  return (
    <div>
      <label className="mb-2 block text-label uppercase text-fg-muted label-nowrap">
        마감일 (시뮬레이션 종료)
      </label>
      <Input
        type="date"
        aria-label="마감일 (시뮬레이션 종료)"
        data-num
        value={endDate}
        min={baseDate ? addDaysIso(baseDate, 1) : undefined}
        max={maxEnd}
        disabled={!baseDate}
        onChange={(e) => commit(e.target.value)}
      />
      <div className="mt-1 flex items-baseline justify-between gap-2">
        {error ? (
          <span className="text-micro text-sem-danger">{error}</span>
        ) : (
          <span />
        )}
        <span data-num className="text-right text-body-strong text-sem-info label-nowrap">
          {simDays} Days
        </span>
      </div>
    </div>
  );
}

export function ConfigureStage() {
  const { params, inputs, status, patchParams, runCurrent } = useSimulationPort();
  // N1 — the designed anchor pillar (absent ≡ 3Y for pre-N1 param states) and
  // its degeneracy validation (the honest reason a conversion can't run).
  const anchorTenor = params.anchorTenor ?? "3Y";
  const anchorError = anchorConversionError(params);
  const canRun = inputs.positions.length > 0 && status !== "running" && !anchorError;

  // Regenerate intermediate waypoints (every 30d) when horizon/target changes.
  // SIM2-2 (ruling ①): an UNTOUCHED intermediate defaults to the on-the-line
  // lerp toward {simDays, baseShockBp} — the default path is a smooth ramp,
  // not the old back-loaded 0-pin. TOUCHED waypoints (explicit flags in
  // params.touchedWaypointDays, set by stepper/typed/drag edits — never
  // value-equality inference) are byte-preserved while their day stays on the
  // grid; flags for days that fall off the grid are pruned. Terminal pin
  // {simDays, baseShockBp} and the D+0 zero pin are unchanged. Reads fresh
  // store state to avoid a stale-closure over waypoints.
  useEffect(() => {
    const { params: p, patchParams: patch } = useSimulationDataStore.getState();
    const target = toNum(p.baseShockBp);
    const touched = new Set(p.touchedWaypointDays);
    const grid: number[] = [];
    const numSteps = Math.floor(p.simDays / 30);
    for (let i = 1; i < numSteps; i++) grid.push(i * 30);

    const result: { day: number; bp: number }[] = [{ day: 0, bp: 0 }];
    for (const day of grid) {
      const prev = p.waypoints.find((w) => w.day === day);
      result.push({
        day,
        bp: touched.has(day) && prev !== undefined ? prev.bp : lerpDefaultBp(target, day, p.simDays),
      });
    }
    result.push({ day: p.simDays, bp: target });
    patch({
      waypoints: result,
      touchedWaypointDays: p.touchedWaypointDays.filter((d) => grid.includes(d)),
    });
  }, [params.simDays, params.baseShockBp]);

  // Any user edit (stepper, typed commit — and SIM2-3 drag, which commits
  // through the SAME lib patch) marks the day touched so regen never
  // re-lerps it.
  const setWaypoint = (day: number, bp: number) =>
    patchParams(buildWaypointPatch(params, day, bp));

  const bpTone = (bp: number) =>
    // iv3: Jade/Berry universal pair, sign convention preserved from the old
    // green/red (rates UP = adverse = Berry; rates DOWN = Jade).
    bp > 0 ? "text-chart-pnl-neg" : bp < 0 ? "text-chart-pnl-pos" : "text-fg-muted";

  const eventCount = params.shortEndEvents.filter((e) => e.date).length;
  const nextEventId = () => (params.shortEndEvents.reduce((m, e) => Math.max(m, e.id), -1) + 1);
  // SIM2-2: "adjusted" now means USER-touched — under lerp defaults every
  // intermediate is nonzero, so the old bp!==0 census would always read full.
  const waypointCount = params.touchedWaypointDays.length;

  return (
    <div className="flex h-full w-full flex-col p-4">
      <div className="mb-4">
        <h2 className="text-h2 text-fg-primary">시나리오 조건 설정</h2>
        <p className="text-micro text-fg-muted mt-1">국채 {anchorTenor} 기준 금리 경로 설계 · 포트 연동</p>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-y-auto lg:grid-cols-[minmax(320px,420px)_1fr] lg:overflow-hidden">
        {/* ── Controls column ── */}
        <div className="space-y-5 lg:overflow-y-auto lg:pr-1">
          {/* 0/1. FB4 T1 — 시작일/마감일 date pickers (replace the 평가 기준일
              stepper + the 30D~365D segment row; store contract unchanged:
              baseDate + simDays, 마감일 derived). */}
          <StartDateControl baseDate={inputs.baseDate} />
          <EndDateControl baseDate={inputs.baseDate} simDays={params.simDays} />

          {/* 1b. N1 — 목표 앵커 테너: which 국고 pillar the target/path/drag
              design. Owner-fixed choices; the wire stays 3Y-정규화 (재표현). */}
          <div>
            <label className="mb-2 block text-label uppercase text-fg-muted">목표 앵커 테너 (국고)</label>
            <SegmentedButtons
              choices={ANCHOR_TENOR_CHOICES}
              value={anchorTenor}
              onChange={(v) => patchParams({ anchorTenor: v })}
              format={(v) => v}
              label="목표 앵커 테너"
            />
          </div>

          {/* 2. Base 충격 */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-label uppercase text-fg-muted">국채 {anchorTenor} 목표 변동</label>
              <span className="bg-bg-tertiary px-2 py-0.5 text-micro text-fg-muted">D+{params.simDays} 고정</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <Input
                  type="text"
                  inputMode="decimal"
                  aria-label={`국채 ${anchorTenor} 목표 변동`}
                  value={params.baseShockBp}
                  onChange={(e) => patchParams({ baseShockBp: e.target.value })}
                  data-num
                  className="text-right"
                />
              </div>
              <span className="text-body text-fg-muted">bp</span>
            </div>
            {/* N1 degeneracy floor — the run is blocked (canRun) AND the cause
                is named where the offending inputs live. Never a silent
                customPath-disable via this route. */}
            {anchorError && (
              <p className="mt-1.5 text-micro text-sem-danger" role="alert">
                {anchorError}
              </p>
            )}
          </div>

          {/* 분포 σ input removed for the demo two-pane (trader feedback):
              the preview is a single-curve view. params.sigmaBp stays in the
              store/payload (default 2.0) — engine σ capability intact. See
              DEMO_DEBT.md. */}

          {/* ── 고급 설정 (collapsed by default) ── */}
          <div className="border-t border-border-subtle pt-4">
            <p className="mb-2 text-label uppercase text-fg-muted">고급 설정</p>

            {/* 3a. 경로 설정 (waypoints) */}
            <details className="py-1.5">
              <summary className="flex cursor-pointer list-none items-center justify-between text-body-strong text-fg-secondary hover:text-fg-primary">
                <span>경로 설정 (국채 {anchorTenor} 웨이포인트)</span>
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
                  const absMax = waypointClampMax(params.baseShockBp);
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
                    {CREDIT_SECTORS.map(({ key, label }) => (
                      <div key={key} className="flex items-center gap-1.5">
                        <span className="w-10 flex-shrink-0 text-micro text-fg-muted">{label}</span>
                        <div className="min-w-0 flex-1">
                          <Input
                            type="text"
                            inputMode="decimal"
                            value={params.creditSpreads[key] ?? "0"}
                            onChange={(e) =>
                              patchParams({ creditSpreads: { ...params.creditSpreads, [key]: e.target.value } })
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
                {/* SIM2-5 (ruling ④) — 조달 스테핑 옵트인. 기본 off = s15 고정
                    상수(바이트 동일). on이면 조달 비용이 아래 이벤트로 스테핑
                    (금리 경로 쪽 이벤트 사용은 원래부터 항상 적용). */}
                <div className="flex items-center justify-between">
                  <span className="text-micro text-fg-muted">조달비용 금통위 스테핑</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={params.fundingStepping}
                    aria-label="조달비용 금통위 스테핑"
                    onClick={() => patchParams({ fundingStepping: !params.fundingStepping })}
                    className={`border px-2 py-0.5 text-micro transition-colors ${
                      params.fundingStepping
                        ? "border-sem-info bg-sem-info-ghost text-sem-info"
                        : "border-border-subtle text-fg-dim hover:text-fg-muted"
                    }`}
                  >
                    {params.fundingStepping ? "ON" : "OFF"}
                  </button>
                </div>
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
