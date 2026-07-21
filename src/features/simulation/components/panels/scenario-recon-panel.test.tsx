// @vitest-environment jsdom
/**
 * RECON-SCEN — 시나리오 대사 panel pins:
 *  - M3 default view: three lanes through LwLineChart on the run's
 *    business-day calendar axis, legend 가정/엔진/잔차, the linearity caption,
 *    and the surfaced SIM2-4 engine recon table;
 *  - rendered-DOM naming guard: the 잔차 legend/caption carry no 테타/carry;
 *  - M1 subtab: full pillar columns + 합계 row in the Home matrix grammar;
 *  - M2 subtab: business-day rows of the designed path matrix;
 *  - honest empty when the response lacks decompositionDaily.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render as rtlRender, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { DEFAULT_SCENARIO_PARAMS, EMPTY_SIMULATION_INPUTS } from "../../types/simulation-port";
import { useSimulationDataStore } from "../../store/simulation-data-store";
import type { LwLineChartProps } from "../charts/lw-line-chart";
import { buildScenarioRecon } from "../../lib/recon/scenario-recon";
import { cloneFixture, loadFixture } from "../../lib/recon/fixtures";

let lwProps: LwLineChartProps | null = null;
vi.mock("../charts/lw-line-chart", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../charts/lw-line-chart")>();
  return {
    ...actual,
    LwLineChart: (props: LwLineChartProps) => {
      lwProps = props;
      return <div data-testid="recon-chart" />;
    },
  };
});

const { ScenarioReconPanel } = await import("./scenario-recon-panel");

function render(ui: React.ReactElement) {
  const qc = new QueryClient();
  return rtlRender(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function seedRun() {
  const { request, response } = loadFixture("linear");
  useSimulationDataStore.setState({
    params: DEFAULT_SCENARIO_PARAMS,
    inputs: { ...EMPTY_SIMULATION_INPUTS, baseDate: request.baseDate },
    lastRun: response,
    lastRunRequest: request,
    status: "success",
    error: null,
  });
}

beforeEach(() => {
  lwProps = null;
});
afterEach(cleanup);

describe("ScenarioReconPanel (RECON-SCEN M1–M3)", () => {
  it("renders nothing without a finished run", () => {
    useSimulationDataStore.setState({ lastRun: null, lastRunRequest: null });
    const { container } = render(<ScenarioReconPanel />);
    expect(container.firstChild).toBeNull();
  });

  it("M3 default: three lanes on the business-day axis + legend + linearity caption", () => {
    seedRun();
    render(<ScenarioReconPanel />);
    expect(screen.getByText("시나리오 대사")).toBeTruthy();
    expect(screen.getByTestId("recon-chart")).toBeTruthy();

    // [CHANGED, FB3] ladder lanes: 예상 (solid), 실현 (solid), 잔차 (dashed).
    expect(lwProps!.series.length).toBe(3);
    expect(lwProps!.series[2].dashed).toBe(true);

    // Series data == the lib selectors, point for point — and the 잔차
    // series is byte-identical to the pre-ladder engine−assumed values.
    const { request, response } = loadFixture("linear");
    const { points } = buildScenarioRecon(request, response);
    expect(lwProps!.series[0].data.map((p) => p.value)).toEqual(points.map((p) => p.expected));
    expect(lwProps!.series[1].data.map((p) => p.value)).toEqual(points.map((p) => p.realized));
    expect(lwProps!.series[2].data.map((p) => p.value)).toEqual(points.map((p) => p.residual));
    expect(points.map((p) => p.residual)).toEqual(points.map((p) => p.engine - p.assumed));

    // Legend (ladder labels) + terminal bridge line + caption.
    expect(screen.getByText("예상 경로")).toBeTruthy();
    expect(screen.getByText("실현 경로 (테타+평가)")).toBeTruthy();
    expect(screen.getByText("잔차")).toBeTruthy();
    expect(screen.getByText(/만기 브리지/)).toBeTruthy();
    expect(screen.getByText(/기준일 KRD 고정/)).toBeTruthy();
    // [old wording pinned absent]
    expect(screen.queryByText("엔진 평가 경로")).toBeNull();
    expect(screen.queryByText("가정 경로")).toBeNull();

    // Surfaced SIM2-4 machinery table with its lane headers.
    expect(screen.getByText(/엔진 내부 머시너리/)).toBeTruthy();
    expect(screen.getByText("추정 P&L")).toBeTruthy();
    expect(screen.getByText("실제 P&L")).toBeTruthy();
  });

  it("naming guard in the RENDERED DOM: the 잔차 lane keeps its own name — 테타 appears only as a ladder term", () => {
    seedRun();
    render(<ScenarioReconPanel />);
    const legendItem = screen.getByText("잔차").closest("span");
    expect(legendItem?.textContent).toBe("잔차");
    // The caption may DESCRIBE the theta rung (it states the bridge), but the
    // residual clause names 잔차 as 컨벡시티(+베이시스), never as a theta.
    const caption = screen.getByText(/선형 근사/);
    expect(caption.textContent).toContain("잔차 = 컨벡시티(+베이시스)");
    expect(caption.textContent).not.toMatch(/잔차[^.]*(테타|carry|캐리|theta)\s*(이|로|입니다)/);
  });

  it("M1 subtab: full pillar columns, sector rows, emphasized 합계", () => {
    seedRun();
    render(<ScenarioReconPanel />);
    fireEvent.click(screen.getByRole("button", { name: "KRD 그리드" }));
    for (const col of ["1D", "3M", "9Y", "10Y"]) {
      expect(screen.getByRole("columnheader", { name: col })).toBeTruthy();
    }
    expect(screen.getByText("국고채")).toBeTruthy();
    expect(screen.getByText("IRS")).toBeTruthy();
    expect(screen.getByText("합계")).toBeTruthy();
    expect(screen.getByText(/KRD @ 2026-04-01/)).toBeTruthy();
  });

  it("M2 subtab: business-day rows of the designed day × tenor matrix", () => {
    seedRun();
    render(<ScenarioReconPanel />);
    fireEvent.click(screen.getByRole("button", { name: "경로 매트릭스" }));
    // First business day after base — a row label; weekends never appear.
    expect(screen.getByText("2026-04-02")).toBeTruthy();
    expect(screen.queryByText("2026-04-04")).toBeNull();
    expect(screen.getByText(/시계열형 미리보기와 동일한 원천/)).toBeTruthy();
  });

  it("FB3 F4a — M2 renders the genuinely-zero short end as 0.0, never the unmapped — (0.0-vs-— rule)", () => {
    // Live-app regime: no 금통위 events → the FE-built curves pin the short
    // nodes at 0 (the committed fixture ships an explicit flat short end, so
    // its request curves are patched here to the FE's no-event form — the
    // matrix reads the request's own curves).
    seedRun();
    const fx = cloneFixture(loadFixture("linear"));
    for (const nodes of [
      ...Object.values(fx.request.shockCurves.bondCurves),
      fx.request.shockCurves.swapCurve,
    ]) {
      for (const n of nodes as { t: number; val: number }[]) {
        if (n.t <= 0.25) n.val = 0;
      }
    }
    useSimulationDataStore.setState({ lastRun: fx.response, lastRunRequest: fx.request });
    render(<ScenarioReconPanel />);
    fireEvent.click(screen.getByRole("button", { name: "경로 매트릭스" }));

    const row = screen.getByText("2026-04-02").closest("tr")!;
    const cells = Array.from(row.querySelectorAll("td")).map((td) => td.textContent?.trim());
    // Layout: [일자, ...15 pillar cells]. 1D and 3M are MEASURED zeros of the
    // designed path (short end moves only via 금통위 events — by design),
    // while 3Y carries the ramped value.
    expect(cells[1]).toBe("+0.0"); // 1D — a value, not the unmapped em-dash
    expect(cells[2]).toBe("+0.0"); // 3M
    expect(cells[8]).not.toBe("—"); // 3Y carries a value
    expect(screen.getByText(/금통위 이벤트로만 이동/)).toBeTruthy();

    // …and the KRD grid (M1) keeps the mass grammar: zero-mass cells still —.
    fireEvent.click(screen.getByRole("button", { name: "KRD 그리드" }));
    const ktbRow = screen.getByText("국고채").closest("tr")!;
    const ktbCells = Array.from(ktbRow.querySelectorAll("td")).map((td) => td.textContent?.trim());
    expect(ktbCells[1]).toBe("—"); // 1D — no KRD mass there in the fixture
  });

  it("T4b 정산 CF subtab: settlement rows in the CashflowTable grammar + engine-lane 대사 line", () => {
    seedRun();
    render(<ScenarioReconPanel />);
    fireEvent.click(screen.getByRole("button", { name: "정산 CF" }));
    // Settlement days only (2026-04-20 / 2026-05-08 in the fixture window).
    expect(screen.getByText("2026-04-20")).toBeTruthy();
    expect(screen.getByText("2026-05-08")).toBeTruthy();
    expect(screen.getByText("IRS-PAY")).toBeTruthy();
    expect(screen.getByText("-6,164,384")).toBeTruthy();
    expect(screen.getByText("3,657,534")).toBeTruthy();
    expect(screen.getByText(/창구별 대사 일치/)).toBeTruthy();
    expect(screen.getByText(/채권 현금흐름은 보류/)).toBeTruthy();
  });

  it("T4b honest empty: a run without settlements says so instead of zero rows", () => {
    seedRun();
    const fx = cloneFixture(loadFixture("linear"));
    fx.response.irsSettlementEvents = [];
    for (const r of fx.response.irsDailyReconciliation ?? []) r.settleCf = 0;
    useSimulationDataStore.setState({ lastRun: fx.response, lastRunRequest: fx.request });
    render(<ScenarioReconPanel />);
    fireEvent.click(screen.getByRole("button", { name: "정산 CF" }));
    expect(screen.getByText(/구간 내 스왑 정산일 없음/)).toBeTruthy();
  });

  it("honest empty: a run without decompositionDaily explains itself instead of charting nothing", () => {
    seedRun();
    const fx = cloneFixture(loadFixture("linear"));
    delete fx.response.decompositionDaily;
    useSimulationDataStore.setState({ lastRun: fx.response, lastRunRequest: fx.request });
    render(<ScenarioReconPanel />);
    expect(screen.getByText(/일별 성분 분해.*없습니다/)).toBeTruthy();
    expect(screen.queryByTestId("recon-chart")).toBeNull();
  });
});

describe("F-VMP-1 — 불일치 raw-difference transparency", () => {
  it("formatRawDeltaKrw: sub-won drift prints its magnitude, never a rounded 0", async () => {
    const { formatRawDeltaKrw } = await import("./scenario-recon-panel");
    expect(formatRawDeltaKrw(0.42)).toBe("+0.42");
    expect(formatRawDeltaKrw(-0.42)).toBe("-0.42");
    expect(formatRawDeltaKrw(1234.5)).toBe("+1,234.5");
    expect(formatRawDeltaKrw(-2)).toBe("-2");
    // The VMP failure mode: drift below 0.005 must not display as 0.00.
    expect(formatRawDeltaKrw(0.0004)).toBe("+0.0004");
    expect(formatRawDeltaKrw(-0.0004)).toBe("-0.0004");
  });

  it("a 불일치 window renders the raw signed Δ next to the verdict (threshold untouched)", () => {
    seedRun();
    const fx = cloneFixture(loadFixture("linear"));
    // Nudge one engine window by ₩2.42 — beyond the ±₩1 pin, but far below
    // the 억/만 display grain (both printed sides would look identical: the
    // exact VMP observation the raw Δ exists to explain).
    const recon = (fx.response.irsDailyReconciliation ?? []).find((r) => r.settleCf !== 0)!;
    recon.settleCf += 2.42;
    useSimulationDataStore.setState({ lastRun: fx.response, lastRunRequest: fx.request });
    render(<ScenarioReconPanel />);
    fireEvent.click(screen.getByRole("button", { name: "정산 CF" }));

    const line = screen.getByText(/엔진 정산-현금 레인과 불일치/);
    expect(line.textContent).toMatch(/\(Δ ₩-2\.42\)/);
    // Verdict threshold unchanged: the other window still reconciles, so the
    // all-match line is gone but no math was altered (projected side intact).
    expect(screen.queryByText(/창구별 대사 일치/)).toBeNull();
  });
});
