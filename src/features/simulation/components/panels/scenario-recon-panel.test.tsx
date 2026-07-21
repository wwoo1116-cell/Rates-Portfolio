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

    // Three series: assumed (solid), engine (solid), 잔차 (dashed).
    expect(lwProps!.series.length).toBe(3);
    expect(lwProps!.series[2].dashed).toBe(true);

    // Series data == the lib selectors, point for point.
    const { request, response } = loadFixture("linear");
    const { points } = buildScenarioRecon(request, response);
    expect(lwProps!.series[0].data.map((p) => p.value)).toEqual(points.map((p) => p.assumed));
    expect(lwProps!.series[1].data.map((p) => p.value)).toEqual(points.map((p) => p.engine));
    expect(lwProps!.series[2].data.map((p) => p.value)).toEqual(points.map((p) => p.residual));

    // Legend + caption.
    expect(screen.getByText("가정 경로")).toBeTruthy();
    expect(screen.getByText("엔진 평가 경로")).toBeTruthy();
    expect(screen.getByText("잔차")).toBeTruthy();
    expect(screen.getByText(/기준일 KRD 고정/)).toBeTruthy();

    // Surfaced SIM2-4 machinery table with its lane headers.
    expect(screen.getByText(/엔진 내부 머시너리/)).toBeTruthy();
    expect(screen.getByText("추정 P&L")).toBeTruthy();
    expect(screen.getByText("실제 P&L")).toBeTruthy();
  });

  it("naming guard in the RENDERED DOM: the 잔차 lane is never captioned 테타/carry", () => {
    seedRun();
    render(<ScenarioReconPanel />);
    const legendItem = screen.getByText("잔차").closest("span");
    expect(legendItem?.textContent).toBe("잔차");
    const caption = screen.getByText(/선형 근사/);
    expect(/테타|carry|캐리|theta/i.test(caption.textContent ?? "")).toBe(false);
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
