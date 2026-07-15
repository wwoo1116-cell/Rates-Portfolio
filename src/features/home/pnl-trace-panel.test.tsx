// @vitest-environment jsdom
/**
 * PnL Trace RUN button (S9): disabled-on-invalid (each rule, tooltip names
 * the reason), click dispatches with the CURRENT form values, loading and
 * error states render, Enter-in-field triggers the same run, and the
 * pre-existing auto-trace path stays live (the button is additive).
 *
 * The chart stack (lightweight-charts, LwChartBase, reticle helpers) is
 * mocked out -- this suite exercises the form/trigger region only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mutate = vi.fn();
const npvTraceState = {
  mutate,
  data: null as unknown,
  isError: false,
  error: null as unknown,
  isPending: false,
};

vi.mock("@/hooks/use-api", () => ({
  useMarketDataRange: () => ({ data: { max_date: "2026-07-15" } }),
  useNpvTrace: () => npvTraceState,
}));
vi.mock("@/components/charts/lw-chart-base", () => ({
  LwChartBase: () => <div data-testid="chart-stub" />,
}));
vi.mock("@/components/charts/crosshair-reticle", () => ({
  CrosshairReticle: () => null,
  formatCrosshairDate: (d: string) => d,
}));
vi.mock("@/components/charts/snap-reticle", () => ({
  paneOffsetX: () => 0,
  snapReticleToNearestSeries: () => null,
}));
vi.mock("lightweight-charts", () => ({
  LineSeries: {},
  createSeriesMarkers: () => ({ setMarkers: () => {} }),
}));

import { PnlTracePanel } from "./pnl-trace-panel";

const point = { valuation_date: "2021-07-05" };

function renderPanel() {
  // Only props.params is read by the component; the rest of dockview's
  // IDockviewPanelProps surface is irrelevant to the form/trigger region.
  const props = { params: { point } } as unknown as Parameters<typeof PnlTracePanel>[0];
  return render(<PnlTracePanel {...props} />);
}

function runButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Run PnL trace" }) as HTMLButtonElement;
}

function tooltip(): string | null {
  return runButton().parentElement!.getAttribute("title");
}

function fillValidInputs() {
  fireEvent.change(screen.getByLabelText(/Maturity Date/), { target: { value: "2026-07-05" } });
  fireEvent.change(screen.getByLabelText(/IRS Rate/), { target: { value: "3" } });
  // Notional defaults to 100 (억); Start Date defaults to the clicked date.
}

beforeEach(() => {
  mutate.mockClear();
  npvTraceState.data = null;
  npvTraceState.isError = false;
  npvTraceState.error = null;
  npvTraceState.isPending = false;
});

afterEach(cleanup);

describe("RUN disabled on invalid inputs, tooltip naming the rule", () => {
  it("maturity empty (initial state)", () => {
    renderPanel();
    expect(runButton().disabled).toBe(true);
    expect(tooltip()).toBe("Maturity Date is required");
  });

  it("maturity <= start", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText(/Maturity Date/), { target: { value: "2021-07-05" } });
    expect(runButton().disabled).toBe(true);
    expect(tooltip()).toBe("Maturity Date must be after Start Date");
  });

  it("rate empty", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText(/Maturity Date/), { target: { value: "2026-07-05" } });
    expect(runButton().disabled).toBe(true);
    expect(tooltip()).toBe("IRS Rate is empty or not a number");
  });

  it("notional cleared", () => {
    renderPanel();
    fillValidInputs();
    fireEvent.change(screen.getByLabelText(/Notional/), { target: { value: "" } });
    expect(runButton().disabled).toBe(true);
    expect(tooltip()).toBe("Notional is empty or not a number");
  });

  it("start date cleared", () => {
    renderPanel();
    fillValidInputs();
    fireEvent.change(screen.getByLabelText(/Start Date/), { target: { value: "" } });
    expect(runButton().disabled).toBe(true);
    expect(tooltip()).toBe("Start Date is required");
  });

  it("valid inputs -> enabled, no tooltip", () => {
    renderPanel();
    fillValidInputs();
    expect(runButton().disabled).toBe(false);
    expect(tooltip()).toBe(null);
  });
});

describe("dispatch", () => {
  it("click runs the trace with the CURRENT form values", () => {
    renderPanel();
    fillValidInputs();
    fireEvent.click(screen.getByRole("button", { name: "REC" }));
    mutate.mockClear(); // drop auto-trace calls; measure the click alone
    fireEvent.click(runButton());
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({
      swap: {
        trade_date: "2021-07-05",
        tenor_years: 1826 / 365,
        maturity_date: "2026-07-05",
        notional: 100 * 100_000_000,
        fixed_rate: 0.03,
        pay_fixed: false,
      },
      start_date: "2021-07-05",
      end_date: "2026-07-15",
    });
  });

  it("the pre-existing auto-trace path still fires on input change (button is additive)", () => {
    renderPanel();
    fillValidInputs();
    expect(mutate).toHaveBeenCalled(); // no click involved
  });

  it("Enter in a form field triggers the same run", () => {
    renderPanel();
    fillValidInputs();
    mutate.mockClear();
    fireEvent.keyDown(screen.getByLabelText(/IRS Rate/), { key: "Enter" });
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("Enter is a no-op while a trace is in flight", () => {
    npvTraceState.isPending = true;
    renderPanel();
    fillValidInputs();
    mutate.mockClear();
    fireEvent.keyDown(screen.getByLabelText(/IRS Rate/), { key: "Enter" });
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe("async states", () => {
  it("loading: button disabled with spinner (label swapped out)", () => {
    npvTraceState.isPending = true;
    renderPanel();
    fillValidInputs();
    const btn = runButton();
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe(""); // Button primitive replaces children with the spinner
  });

  it("backend error with no data: message renders where the chart would", () => {
    npvTraceState.isError = true;
    npvTraceState.error = new Error("pricing server exploded");
    renderPanel();
    expect(screen.getByText("pricing server exploded")).toBeTruthy();
    expect(screen.queryByTestId("chart-stub")).toBe(null);
  });

  it("non-Error rejection falls back to the generic message", () => {
    npvTraceState.isError = true;
    npvTraceState.error = "boom";
    renderPanel();
    expect(
      screen.getByText(/confirm the pricing server is reachable/),
    ).toBeTruthy();
  });
});
