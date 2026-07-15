"use client";

/**
 * Scenario Config panel (S4) — full input surface ported from the source
 * ScenarioSimulator's left panel, restyled per the Phase 2 token map and wired to
 * the SimulationDataPort (reads/writes params via patchParams; runs via runCurrent).
 * Pure port consumer — no app stores, no dockview types — stays inside the slice boundary.
 *
 * s11 T2: the range sliders (horizon + per-waypoint bp) are replaced by
 * button-style controls — a segmented button group for the horizon (mutually
 * exclusive choice) and ∓/± stepper buttons + a numeric field per waypoint.
 * Control-surface swap only: same store keys (simDays: number, waypoints
 * {day, bp:number}), same defaults, same simulate payload for equivalent
 * selections. The waypoint clamp (±max(|baseShock|+50, 100)) the sliders
 * enforced via min/max is kept on both the steppers and the typed commit.
 */
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { toNum } from "../../lib/scenario-curves";
import { useSimulationDataStore } from "../../store/simulation-data-store";
import { useSimulationPort } from "../../hooks/use-simulation";

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
 * primitive — pressed state reuses the accent-ghost recipe the panel's "+ 추가"
 * button already established (border-sem-info / bg-sem-info-ghost / text-sem-info);
 * no new visual language. A value outside `choices` (possible if the store was
 * patched elsewhere) simply renders with no segment pressed — it is never coerced.
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
 * every keystroke commits toNum(text) clamped to ±absMax (the sliders' old
 * min/max), the draft renders verbatim until blur, then snaps to the store value.
 */
function BpStepperField({
  value,
  absMax,
  onCommit,
  ariaLabel,
}: {
  value: number;
  absMax: number;
  onCommit: (bp: number) => void;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (n: number) => Math.max(-absMax, Math.min(absMax, n));
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <Button
        type="button"
        variant="icon"
        size="sm"
        aria-label={`${ariaLabel} ${WAYPOINT_STEP_BP}bp 감소`}
        onClick={() => onCommit(clamp(value - WAYPOINT_STEP_BP))}
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
        aria-label={`${ariaLabel} ${WAYPOINT_STEP_BP}bp 증가`}
        onClick={() => onCommit(clamp(value + WAYPOINT_STEP_BP))}
      >
        +
      </Button>
    </div>
  );
}

export function ScenarioConfigPanel() {
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
    bp > 0 ? "text-sem-negative" : bp < 0 ? "text-sem-positive" : "text-fg-muted";

  const eventCount = params.shortEndEvents.filter((e) => e.date).length;
  const nextEventId = () => (params.shortEndEvents.reduce((m, e) => Math.max(m, e.id), -1) + 1);

  return (
    <div className="flex h-full w-full flex-col p-4">
      <div className="mb-4">
        <h2 className="text-h2 text-fg-primary">시나리오 조건 설정</h2>
        <p className="text-micro text-fg-muted mt-1">국채 3Y 기준 금리 경로 설계 · 포트 연동</p>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto pr-1">
        {/* 1. 시뮬레이션 기간 — segmented buttons (s11 T2, was a range slider) */}
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

        {/* 3. 경로 설정 (waypoints) */}
        <div>
          <label className="mb-3 block text-label uppercase text-fg-muted">경로 설정 (국채 3Y)</label>
          <div className="space-y-2.5">
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
                    absMax={absMax}
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
        </div>

        {/* 4. 커브 스프레드 설정 (collapsible) */}
        <details className="border-t border-border-subtle pt-4">
          <summary className="cursor-pointer list-none text-label uppercase text-fg-muted hover:text-fg-primary">
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

        {/* 5. 금통위 이벤트 (collapsible) */}
        <details className="border-t border-border-subtle pt-4">
          <summary className="flex cursor-pointer list-none items-center justify-between text-label uppercase text-fg-muted">
            <span>
              금통위 이벤트 (기준금리)
              {eventCount > 0 && <span className="ml-2 normal-case text-micro tracking-normal text-sem-info">{eventCount}건</span>}
            </span>
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
                      className="flex-shrink-0 text-body leading-none text-fg-dim hover:text-sem-negative"
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

      <Button
        type="button"
        variant="primary"
        size="lg"
        disabled={!canRun}
        onClick={() => void runCurrent()}
        className="mt-4 w-full"
        title={inputs.positions.length === 0 ? "포지션 입력 필요 (S6에서 포트폴리오 스토어 연동)" : undefined}
      >
        {status === "running" ? "계산 중..." : "시뮬레이션 실행"}
      </Button>
    </div>
  );
}
