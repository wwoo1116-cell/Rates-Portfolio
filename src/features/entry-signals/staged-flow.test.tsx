// @vitest-environment jsdom
/**
 * s17 staged-flow contract: Configure -> Running -> Results transitions, the
 * honest Running stage (holds while series are unresolved, cancel works,
 * auto-completes when ready), 조건 수정 round-tripping every input, re-run
 * REPLACING the pinned run, and the stale marker when the live config drifts
 * from the pinned run. Chart/grid panels are mocked — their internals are
 * covered by their own suites (KPI identity by backtest-kpi-fixture.test.tsx).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BuiltSeries, SelectedInstrument } from "@/lib/rv-instruments";

const INST_3Y: SelectedInstrument = {
  kind: "outright",
  id: "O:IRS||3Y",
  leg: { sector: "IRS", rating: null, tenor: "3Y" },
};
const INST_10Y: SelectedInstrument = {
  kind: "outright",
  id: "O:IRS||10Y",
  leg: { sector: "IRS", rating: null, tenor: "10Y" },
};

function miniSeries(id: string): BuiltSeries {
  return {
    id,
    kind: "outright",
    label: id,
    color: "var(--chart-ocean)",
    priceScaleId: "right",
    lineData: [
      { time: "2026-07-14", value: 0.03 },
      { time: "2026-07-15", value: 0.031 },
    ],
  } as BuiltSeries;
}

/** Mutable knobs the mocked data hook reads — set BEFORE render per test. */
const dataState = vi.hoisted(() => ({ isLoading: false, isError: false, ready: true }));

vi.mock("./use-entry-signals-data", () => ({
  useEntrySignalsData: () => ({
    minDate: "2010-03-02",
    maxDate: "2026-07-15",
    taxonomy: undefined,
    focusedSeries: null,
    seriesById: dataState.ready
      ? new Map([
          [INST_3Y.id, miniSeries(INST_3Y.id)],
          [INST_10Y.id, miniSeries(INST_10Y.id)],
        ])
      : new Map(),
    isLoading: dataState.isLoading,
    isError: dataState.isError,
  }),
}));

// Stage plumbing under test; panel internals are not.
vi.mock("./price-panel", () => ({ PricePanel: () => <div data-testid="price-preview" /> }));
vi.mock("./zscore-oscillator-panel", () => ({ ZScoreOscillatorPanel: () => <div data-testid="zscore" /> }));
vi.mock("./equity-curve-panel", () => ({ EquityCurvePanel: () => <div data-testid="equity" /> }));
vi.mock("./signal-grid-panel", () => ({ SignalGridPanel: () => <div data-testid="signals" /> }));
vi.mock("./backtest-panel", () => ({ BacktestPanel: () => <div data-testid="backtest-block" /> }));
vi.mock("@/components/rate-history/instrument-selector", () => ({
  InstrumentSelector: () => <div data-testid="instrument-selector" />,
}));

import { EntrySignalsWorkspace } from "./entry-signals-workspace";
import { useEntrySignalsStore } from "@/stores/entry-signals-store";

const BASE_PARAMS = {
  lookback: 60,
  entryZ: 2.0,
  warnZ: 1.5,
  showBands: true,
  exitZ: 0.5,
  stopZ: 3.5,
  costBp: 0.05,
  notional: 1_000_000,
} as const;

beforeEach(() => {
  dataState.isLoading = false;
  dataState.isError = false;
  dataState.ready = true;
  useEntrySignalsStore.setState({
    ...BASE_PARAMS,
    focused: INST_3Y,
    watchlist: [INST_3Y, INST_10Y],
    stage: "configure",
    lastRun: null,
    pendingRun: null,
  });
});

afterEach(cleanup);

const runButton = () => screen.getByRole("button", { name: "백테스트 실행" });

describe("staged flow (s17)", () => {
  it("starts at Configure: inputs only, no results surfaces", () => {
    render(<EntrySignalsWorkspace />);
    expect(runButton()).toBeDefined();
    expect(screen.getByTestId("price-preview")).toBeDefined(); // the one output that helps configure
    expect(screen.queryByTestId("backtest-block")).toBeNull();
    expect(screen.queryByTestId("zscore")).toBeNull();
    expect(screen.queryByRole("button", { name: "조건 수정" })).toBeNull();
  });

  it("CTA is disabled until a run target is focused; startRun no-ops without one", () => {
    useEntrySignalsStore.setState({ focused: null });
    render(<EntrySignalsWorkspace />);
    expect(runButton().disabled).toBe(true);
    act(() => useEntrySignalsStore.getState().startRun());
    expect(useEntrySignalsStore.getState().stage).toBe("configure");
  });

  it("Running holds honestly while the series is unresolved; cancel returns to Configure", () => {
    dataState.ready = false;
    dataState.isLoading = true;
    render(<EntrySignalsWorkspace />);
    fireEvent.click(runButton());

    expect(screen.getByText("백테스트 실행 중")).toBeDefined();
    expect(screen.getByText("시장 데이터 로딩 중…")).toBeDefined();
    expect(screen.getByText(/경과 /)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "실행 취소" }));
    expect(useEntrySignalsStore.getState().stage).toBe("configure"); // no prior run to fall back to
    expect(useEntrySignalsStore.getState().lastRun).toBeNull();
    expect(runButton()).toBeDefined();
  });

  it("auto-completes to Results when the series is ready and pins the run", () => {
    render(<EntrySignalsWorkspace />);
    fireEvent.click(runButton());

    // Interstitial completes via effect; the pinned chips prove the snapshot.
    expect(screen.getByText("IRS 3Y")).toBeDefined();
    expect(screen.getByText("lookback 60D")).toBeDefined();
    expect(screen.getByText("entry ±2σ")).toBeDefined();
    expect(screen.getByText("notional 1,000,000")).toBeDefined();
    expect(screen.getByTestId("backtest-block")).toBeDefined();
    expect(screen.getByTestId("zscore")).toBeDefined();
    expect(screen.getByTestId("signals")).toBeDefined();
    expect(screen.getByTestId("equity")).toBeDefined();

    const { stage, lastRun, pendingRun } = useEntrySignalsStore.getState();
    expect(stage).toBe("results");
    expect(pendingRun).toBeNull();
    expect(lastRun?.instrument.id).toBe(INST_3Y.id);
    expect(lastRun?.entryZ).toBe(2.0);
  });

  it("조건 수정 round-trips every input", () => {
    render(<EntrySignalsWorkspace />);
    fireEvent.click(runButton());
    fireEvent.click(screen.getByRole("button", { name: "조건 수정" }));

    // Back on Configure with the exact pre-run values in the controls.
    expect((screen.getByLabelText("Entry ±σ") as HTMLInputElement).value).toBe("2");
    expect((screen.getByLabelText("Watch ±σ") as HTMLInputElement).value).toBe("1.5");
    expect((screen.getByLabelText("Exit ±σ") as HTMLInputElement).value).toBe("0.5");
    expect((screen.getByLabelText("Stop ±σ") as HTMLInputElement).value).toBe("3.5");
    expect((screen.getByLabelText("Cost (bp)") as HTMLInputElement).value).toBe("0.05");
    expect((screen.getByLabelText("Notional (₩/bp)") as HTMLInputElement).value).toBe("1000000");
    expect(screen.getByRole("button", { name: "60D" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "IRS 3Y" }).getAttribute("aria-pressed")).toBe("true");
    // The pinned run survives the round-trip untouched.
    expect(useEntrySignalsStore.getState().lastRun?.entryZ).toBe(2.0);
  });

  it("re-run REPLACES the pinned run outright", () => {
    render(<EntrySignalsWorkspace />);
    fireEvent.click(runButton());
    fireEvent.click(screen.getByRole("button", { name: "조건 수정" }));
    fireEvent.click(screen.getByLabelText("Entry ±σ 0.1 증가"));
    fireEvent.click(runButton());

    expect(screen.getByText("entry ±2.1σ")).toBeDefined();
    expect(screen.queryByText("entry ±2σ")).toBeNull(); // replaced, not accumulated
    expect(useEntrySignalsStore.getState().lastRun?.entryZ).toBe(2.1);
  });

  it("marks the backtest block stale when the live config drifts from the pin", () => {
    render(<EntrySignalsWorkspace />);
    fireEvent.click(runButton());
    expect(screen.queryByText(/설정이 변경되었습니다/)).toBeNull();

    // Live monitoring refocus (the Signals grid path) — pinned run untouched,
    // stale marker on.
    act(() => useEntrySignalsStore.getState().setFocused(INST_10Y));
    expect(screen.getByText(/설정이 변경되었습니다/)).toBeDefined();
    expect(useEntrySignalsStore.getState().lastRun?.instrument.id).toBe(INST_3Y.id);

    // 다시 실행 re-pins to the live config and clears the marker.
    fireEvent.click(screen.getByRole("button", { name: "다시 실행" }));
    expect(screen.queryByText(/설정이 변경되었습니다/)).toBeNull();
    expect(useEntrySignalsStore.getState().lastRun?.instrument.id).toBe(INST_10Y.id);
    expect(screen.getByText("IRS 10Y")).toBeDefined();
  });

  it("cancel during a re-run falls back to the previous Results, old pin intact", () => {
    render(<EntrySignalsWorkspace />);
    fireEvent.click(runButton());
    const firstRanAt = useEntrySignalsStore.getState().lastRun?.ranAt;

    dataState.ready = false; // next run will hold on the interstitial
    fireEvent.click(screen.getByRole("button", { name: "다시 실행" }));
    expect(screen.getByText("백테스트 실행 중")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "실행 취소" }));
    expect(useEntrySignalsStore.getState().stage).toBe("results");
    expect(useEntrySignalsStore.getState().lastRun?.ranAt).toBe(firstRanAt);
  });
});
