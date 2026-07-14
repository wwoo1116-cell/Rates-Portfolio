"use client";

/**
 * Scenario Config panel (dockview panel body). Consumes ONLY the SimulationDataPort
 * — no app stores, no dockview types — so it stays inside the slice boundary. The
 * mount host (src/app/(workspace)/simulation/simulation-tab.tsx) wraps it with the
 * dockview panel chrome (constraints, focus containment).
 *
 * Phase 3 scope: this wires the port's read/write path (change simDays / base shock →
 * patchParams → shared store → other panels see it) and the run trigger. The FULL
 * input surface from the source ScenarioSimulator (waypoint sliders, curve spreads,
 * 금통위 events) is ported + restyled in S4; kept minimal here on purpose.
 *
 * Styling uses target tokens per the Phase 2 token map (no hex, no arbitrary color —
 * enforced by eslint block C).
 */
import { useSimulationPort } from "../../hooks/use-simulation";

export function ScenarioConfigPanel() {
  const { params, inputs, status, patchParams, runCurrent } = useSimulationPort();
  const canRun = inputs.positions.length > 0 && status !== "running";

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-y-auto bg-bg-secondary p-4">
      <div>
        <h2 className="text-h2 text-fg-primary">시나리오 조건 설정</h2>
        <p className="text-micro text-fg-muted mt-1">국채 3Y 기준 금리 경로 · 포트 연동</p>
      </div>

      <label className="flex flex-col gap-2">
        <span className="text-label uppercase text-fg-muted">시뮬레이션 기간 (Days)</span>
        <input
          type="range"
          min={30}
          max={365}
          step={1}
          value={params.simDays}
          onChange={(e) => patchParams({ simDays: Number(e.target.value) })}
          className="w-full accent-sem-info"
        />
        <span data-num className="text-right text-body-strong text-sem-info">
          {params.simDays} Days
        </span>
      </label>

      <label className="flex flex-col gap-2">
        <span className="text-label uppercase text-fg-muted">국채 3Y 목표 변동 (bp)</span>
        <input
          type="text"
          inputMode="decimal"
          value={params.baseShockBp}
          onChange={(e) => patchParams({ baseShockBp: e.target.value })}
          data-num
          className="bg-bg-tertiary border border-border-subtle px-3 py-2 text-right text-body-strong text-fg-primary focus:border-sem-info focus:outline-none"
        />
      </label>

      <button
        type="button"
        disabled={!canRun}
        onClick={() => void runCurrent()}
        className="mt-auto bg-sem-info px-4 py-3 text-body-strong text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-bg-tertiary disabled:text-fg-dim"
        title={inputs.positions.length === 0 ? "포지션 입력 필요 (S6에서 포트폴리오 스토어 연동)" : undefined}
      >
        {status === "running" ? "계산 중..." : "시뮬레이션 실행"}
      </button>

      <p className="text-micro text-fg-dim">
        S4: 웨이포인트·커브 스프레드·금통위 이벤트 전체 입력 이식 · 요청 조립(generateShockCurves)을 포트로 이동.
      </p>
    </div>
  );
}
