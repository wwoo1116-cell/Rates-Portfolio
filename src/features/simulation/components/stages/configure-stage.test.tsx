// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { DEFAULT_SCENARIO_PARAMS, EMPTY_SIMULATION_INPUTS } from "../../types/simulation-port";
import { buildSimulateRequest } from "../../lib/scenario-curves";
import { useSimulationDataStore } from "../../store/simulation-data-store";
import { ConfigureStage } from "./configure-stage";

/**
 * s15 T3 — the Configure stage keeps the S4/§4.2 interaction coverage the
 * superseded ScenarioConfigPanel carried (renamed test-for-test): the stage
 * renders and drives the SimulationDataPort with IDENTICAL store keys and
 * payload semantics. The live curve preview is canvas (lightweight-charts) and
 * can't run in jsdom, so it's mocked out — its logic is covered by
 * scenario-preview tests.
 */
vi.mock("../panels/curve-view-panel", () => ({
  CurveViewPanel: () => <div data-testid="curve-preview" />,
}));

function renderStage() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <ConfigureStage />
    </QueryClientProvider>,
  );
}

// FB4 T1 — the horizon is driven through the 마감일 calendar now; a helper
// keeps the re-pinned tests readable. BASE + 90d = 2026-10-13.
const BASE_DATE = "2026-07-15";
function seedBaseDate() {
  useSimulationDataStore.setState({
    inputs: { ...EMPTY_SIMULATION_INPUTS, baseDate: BASE_DATE },
  });
}
function pickEndDate(iso: string) {
  fireEvent.change(screen.getByLabelText("마감일 (시뮬레이션 종료)"), { target: { value: iso } });
}

beforeEach(() => {
  useSimulationDataStore.setState({
    params: DEFAULT_SCENARIO_PARAMS,
    inputs: EMPTY_SIMULATION_INPUTS,
    lastRun: null,
    lastRunRequest: null,
    status: "idle",
    error: null,
  });
});
afterEach(cleanup);

describe("ConfigureStage (s15 staged flow — configure)", () => {
  it("renders defaults and disables Run when there are no positions", () => {
    renderStage();
    expect(screen.getByText("시나리오 조건 설정")).toBeTruthy();
    expect(screen.getByText("180 Days")).toBeTruthy();
    const run = screen.getByRole("button", { name: /시뮬레이션 실행/ }) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
  });

  it("shows the live curve preview beside the controls", () => {
    renderStage();
    expect(screen.getByTestId("curve-preview")).toBeTruthy();
  });

  it("collapses waypoints, curve spreads and 금통위 into closed 고급 설정 accordions", () => {
    const { container } = renderStage();
    expect(screen.getByText("고급 설정")).toBeTruthy();
    const accordions = container.querySelectorAll("details");
    expect(accordions.length).toBe(3);
    for (const d of accordions) expect(d.open).toBe(false);
  });

  it("edits the horizon through the port (마감일 calendar → store → display) [CHANGED, FB4]", () => {
    seedBaseDate();
    renderStage();
    pickEndDate("2026-10-13"); // BASE + 90d
    expect(useSimulationDataStore.getState().params.simDays).toBe(90);
    expect(screen.getByText("90 Days")).toBeTruthy();
    // The picker reads back the DERIVED end date (contract stays baseDate+simDays).
    expect((screen.getByLabelText("마감일 (시뮬레이션 종료)") as HTMLInputElement).value).toBe(
      "2026-10-13",
    );
  });

  it("edits the base shock through the port", () => {
    renderStage();
    const input = screen.getByDisplayValue("30");
    fireEvent.change(input, { target: { value: "45" } });
    expect(useSimulationDataStore.getState().params.baseShockBp).toBe("45");
  });

  it("auto-regenerates the 30-day waypoint rows for the horizon", () => {
    renderStage();
    // 180d → intermediate waypoints at 30/60/90/120/150 (5 stepper fields).
    expect(screen.getAllByLabelText(/^D\+\d+ 변동폭$/).length).toBe(5);
  });

  it("contains zero slide toggles / range sliders (s11 T2 acceptance)", () => {
    const { container } = renderStage();
    expect(screen.queryAllByRole("slider").length).toBe(0);
    expect(container.querySelectorAll('input[type="range"]').length).toBe(0);
  });

  it("steps a waypoint with the ∓/± buttons and accepts typed values", () => {
    // [CHANGED, SIM2-2 ruling] — untouched D+30 now starts at the on-line lerp
    // (30×30/180 = 5bp), not 0; one +5 step lands at 10. The old pin froze the
    // back-loaded 0-default.
    renderStage();
    expect(
      useSimulationDataStore.getState().params.waypoints.find((w) => w.day === 30)?.bp,
    ).toBe(5);
    fireEvent.click(screen.getByRole("button", { name: "D+30 변동폭 5bp 증가" }));
    expect(
      useSimulationDataStore.getState().params.waypoints.find((w) => w.day === 30)?.bp,
    ).toBe(10);

    fireEvent.change(screen.getByLabelText("D+60 변동폭"), { target: { value: "-12" } });
    expect(
      useSimulationDataStore.getState().params.waypoints.find((w) => w.day === 60)?.bp,
    ).toBe(-12);
    expect(useSimulationDataStore.getState().params.touchedWaypointDays.sort()).toEqual([30, 60]);
  });

  // HARDEN-1 (supersedes the DEMO-DEBT σ-test skip): the σ/fan design left
  // the Simulation surface PERMANENTLY (owner ruling) — the old stepper test
  // is rewritten to pin the CURRENT spec instead of waiting for a control
  // that is not coming back.
  it("σ removal is permanent: no σ control, engine σ contract intact (HARDEN-1)", () => {
    renderStage();
    // No σ control or fan-band affordance anywhere on Configure.
    expect(screen.queryByText(/분포 σ/)).toBeNull();
    expect(screen.queryByLabelText("분포 σ")).toBeNull();
    expect(screen.queryByText(/팬 차트/)).toBeNull();
    // The REQUEST contract is untouched: sigmaBp default survives in the
    // store and buildSimulateRequest still ships sigma_bp = 2.0.
    const { params, inputs } = useSimulationDataStore.getState();
    expect(params.sigmaBp).toBe("2.0");
    expect(buildSimulateRequest(inputs, params).sigma_bp).toBe(2.0);
  });

  it("keeps waypoint state semantics identical for equivalent selections (payload parity)", () => {
    // [CHANGED, SIM2-2 ruling] — the untouched D+60 is the on-line lerp
    // (30×60/90 = 20bp), not the old 0-pin. The touched D+30 carries the
    // user's 10 exactly; terminal pin unchanged.
    seedBaseDate();
    renderStage();
    pickEndDate("2026-10-13"); // BASE + 90d  [CHANGED, FB4]
    fireEvent.change(screen.getByLabelText("D+30 변동폭"), { target: { value: "10" } });
    const { params } = useSimulationDataStore.getState();
    expect(params.simDays).toBe(90);
    expect(params.waypoints).toEqual([
      { day: 0, bp: 0 },
      { day: 30, bp: 10 },
      { day: 60, bp: 20 },
      { day: 90, bp: 30 },
    ]);
  });

  // ── SIM2-2 (ruling ①) — untouched = on-line lerp, touched = byte-preserved ──

  it("untouched intermediates re-lerp when the target changes", () => {
    renderStage();
    fireEvent.change(screen.getByDisplayValue("30"), { target: { value: "60" } });
    const wps = useSimulationDataStore.getState().params.waypoints;
    // 180D grid: D+30 = 60×30/180 = 10 … D+150 = 50; terminal pinned at 60.
    expect(wps.find((w) => w.day === 30)?.bp).toBe(10);
    expect(wps.find((w) => w.day === 90)?.bp).toBe(30);
    expect(wps.find((w) => w.day === 150)?.bp).toBe(50);
    expect(wps.at(-1)).toEqual({ day: 180, bp: 60 });
  });

  it("touched waypoints are byte-preserved across a target change", () => {
    renderStage();
    fireEvent.change(screen.getByLabelText("D+30 변동폭"), { target: { value: "7" } });
    fireEvent.change(screen.getByDisplayValue("30"), { target: { value: "60" } });
    const wps = useSimulationDataStore.getState().params.waypoints;
    expect(wps.find((w) => w.day === 30)?.bp).toBe(7); // user value, not re-lerped
    expect(wps.find((w) => w.day === 60)?.bp).toBe(20); // untouched: 60×60/180
  });

  it("touched is an explicit flag, not value-equality: a round-trip edit back TO the lerp value still pins it", () => {
    renderStage();
    // D+30's lerp default at 180D/30bp is exactly 5. Step +5 then −5: the
    // value ends back AT the lerp default, but the day is now flagged —
    // value-equality inference would wrongly treat it as untouched.
    fireEvent.click(screen.getByRole("button", { name: "D+30 변동폭 5bp 증가" }));
    fireEvent.click(screen.getByRole("button", { name: "D+30 변동폭 5bp 감소" }));
    expect(useSimulationDataStore.getState().params.waypoints.find((w) => w.day === 30)?.bp).toBe(5);
    expect(useSimulationDataStore.getState().params.touchedWaypointDays).toContain(30);

    fireEvent.change(screen.getByDisplayValue("30"), { target: { value: "60" } });
    const wps = useSimulationDataStore.getState().params.waypoints;
    expect(wps.find((w) => w.day === 30)?.bp).toBe(5); // pinned; lerp would be 10
  });

  // ── SIM2-5 (ruling ④) — 조달 스테핑 opt-in toggle ──

  it("funding stepping defaults OFF and ships fundingStepping:false", () => {
    renderStage();
    const sw = screen.getByRole("switch", { name: "조달비용 금통위 스테핑" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    const { inputs, params } = useSimulationDataStore.getState();
    expect(params.fundingStepping).toBe(false);
    expect(buildSimulateRequest(inputs, params).fundingStepping).toBe(false);
  });

  it("toggling ON flips the store and the payload; OFF returns byte-equivalent", () => {
    renderStage();
    const sw = screen.getByRole("switch", { name: "조달비용 금통위 스테핑" });
    fireEvent.click(sw);
    expect(useSimulationDataStore.getState().params.fundingStepping).toBe(true);
    const { inputs, params } = useSimulationDataStore.getState();
    expect(buildSimulateRequest(inputs, params).fundingStepping).toBe(true);
    fireEvent.click(sw);
    expect(useSimulationDataStore.getState().params.fundingStepping).toBe(false);
  });

  it("prunes touched flags for days that fall off the grid on horizon shrink", () => {
    seedBaseDate();
    renderStage();
    fireEvent.change(screen.getByLabelText("D+120 변동폭"), { target: { value: "9" } });
    expect(useSimulationDataStore.getState().params.touchedWaypointDays).toContain(120);
    pickEndDate("2026-10-13"); // BASE + 90d  [CHANGED, FB4]
    const { params } = useSimulationDataStore.getState();
    expect(params.touchedWaypointDays).not.toContain(120);
    expect(params.waypoints.some((w) => w.day === 120)).toBe(false);
  });
});

describe("ConfigureStage — FB4 T1 date pickers", () => {
  it("rejects 마감일 ≤ 시작일 with an explicit message and writes NOTHING", () => {
    seedBaseDate();
    renderStage();
    pickEndDate("2026-07-10"); // before 시작일
    expect(screen.getByText("마감일은 시작일 이후여야 합니다.")).toBeTruthy();
    expect(useSimulationDataStore.getState().params.simDays).toBe(180); // untouched
    expect(screen.getByText("180 Days")).toBeTruthy();
  });

  it("rejects a horizon beyond the 365-day cap with the explicit cap message — never a silent clamp", () => {
    seedBaseDate();
    renderStage();
    pickEndDate("2027-07-20"); // 370d
    expect(screen.getByText(/최대 기간 365일을 초과합니다 — 2027-07-15 이하/)).toBeTruthy();
    expect(useSimulationDataStore.getState().params.simDays).toBe(180);
  });

  it("accepts a NON-PRESET horizon (100d) — the capability the segment row could not express", () => {
    seedBaseDate();
    renderStage();
    pickEndDate("2026-10-23"); // BASE + 100d
    expect(useSimulationDataStore.getState().params.simDays).toBe(100);
    expect(screen.getByText("100 Days")).toBeTruthy();
    // Waypoint grid: intermediates i×30 for i < floor(100/30) → D+30/D+60,
    // then the terminal pin at the exact (non-multiple) horizon day.
    expect(useSimulationDataStore.getState().params.waypoints.map((w) => w.day)).toEqual([
      0, 30, 60, 100,
    ]);
  });

  it("changing 시작일 keeps simDays (마감일 display shifts) — the old control's semantics", () => {
    seedBaseDate();
    renderStage();
    pickEndDate("2026-10-13"); // 90d
    fireEvent.change(screen.getByLabelText("시작일 (평가 기준일)"), {
      target: { value: "2026-07-10" },
    });
    expect(useSimulationDataStore.getState().userBaseDate).toBe("2026-07-10");
    expect(useSimulationDataStore.getState().params.simDays).toBe(90); // unchanged
  });

  it("payload byte-identity: picker-driven selections reproduce the pre-refactor fixture bytes", () => {
    // The fixture was captured from the UNTOUCHED builder at acb395f (see
    // __fixtures__/generate-payload-pin.test.ts). Drive the store to the
    // non-preset case's (baseDate, simDays) THROUGH THE PICKER, set the
    // remaining params, and the wire bytes must match exactly.
    seedBaseDate();
    renderStage();
    pickEndDate("2026-10-23"); // BASE + 100d
    useSimulationDataStore.getState().patchParams({
      anchorTenor: "5Y",
      baseShockBp: "20",
      spread10y: "10",
      waypoints: [
        { day: 0, bp: 0 },
        { day: 100, bp: 20 },
      ],
      touchedWaypointDays: [],
    });
    const { inputs, params } = useSimulationDataStore.getState();
    const built = buildSimulateRequest(inputs, params);
    const fixture = JSON.parse(
      readFileSync(
        join(process.cwd(), "src", "features", "simulation", "lib", "__fixtures__", "payload-pin.json"),
        "utf-8",
      ),
    );
    expect(built).toEqual(fixture["non-preset-100d-anchor-5y"]);
  });
});

describe("ConfigureStage — N1 anchor selector", () => {
  it("renders the four owner choices with 3Y pressed by default and 3Y wording intact", () => {
    renderStage();
    const group = screen.getByRole("group", { name: "목표 앵커 테너" });
    const labels = Array.from(group.querySelectorAll("button")).map((b) => b.textContent);
    expect(labels).toEqual(["1Y", "3Y", "5Y", "10Y"]);
    const pressed = Array.from(group.querySelectorAll('button[aria-pressed="true"]')).map(
      (b) => b.textContent,
    );
    expect(pressed).toEqual(["3Y"]);
    // Default anchor keeps the legacy copy verbatim (identity path).
    expect(screen.getByLabelText("국채 3Y 목표 변동")).toBeTruthy();
    expect(screen.getByText("경로 설정 (국채 3Y 웨이포인트)")).toBeTruthy();
  });

  it("selecting 5Y re-labels the design surfaces to the anchor (spread label stays vs 3Y)", () => {
    renderStage();
    fireEvent.click(screen.getByRole("group", { name: "목표 앵커 테너" }).querySelectorAll("button")[2]);
    expect(useSimulationDataStore.getState().params.anchorTenor).toBe("5Y");
    expect(screen.getByLabelText("국채 5Y 목표 변동")).toBeTruthy();
    expect(screen.getByText("경로 설정 (국채 5Y 웨이포인트)")).toBeTruthy();
    expect(screen.getByText(/국채 5Y 기준 금리 경로 설계/)).toBeTruthy();
    // Owner ruling: 테너 스프레드 stays DEFINED vs 3Y — label must not move.
    expect(screen.getByText("국고채 테너 스프레드 (vs 국채 3Y)")).toBeTruthy();
  });

  it("degenerate anchor conversion blocks the run and names the cause (0.5bp floor)", () => {
    useSimulationDataStore.setState((s) => ({
      inputs: { ...s.inputs, positions: [{ id: "p" } as never] },
      params: { ...s.params, anchorTenor: "10Y", spread10y: "12", baseShockBp: "12" },
    }));
    renderStage();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/상쇄/);
    expect(alert.textContent).toMatch(/0.5bp/);
    const run = screen.getByRole("button", { name: /시뮬레이션 실행/ }) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    // Clearing the degeneracy re-enables the run (positions present).
    fireEvent.change(screen.getByLabelText("국채 10Y 목표 변동"), { target: { value: "30" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect((screen.getByRole("button", { name: /시뮬레이션 실행/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});
