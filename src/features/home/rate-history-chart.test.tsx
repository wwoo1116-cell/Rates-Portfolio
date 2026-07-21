// @vitest-environment jsdom
/**
 * FB5R R1 (owner ruling ②) — the crosshair-bound rate readout AT the Rate
 * History chart. The canonical SeriesChart is mocked so the panel's own logic is
 * under test: it exposes the opt-in onCrosshairMove seam and renders a readout
 * strip that layers the IRS 3Y/10Y BENCHMARK pair (from the already-loaded
 * points, always shown, deduped against any charted series of the same tenor)
 * over EVERY charted series' own value (which SeriesChart sources same-source
 * from param.seriesData). Clicking a date PINS the row.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render as rtlRender, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type {
  SeriesChartClickContext,
  SeriesChartReadout,
} from "@/components/charts/series-chart";

// Capture the SeriesChart seams; render nothing (canvas host not needed here).
let onCrosshairMove: ((r: SeriesChartReadout | null) => void) | undefined;
let onClick: ((ctx: SeriesChartClickContext) => void) | undefined;
vi.mock("@/components/charts/series-chart", () => ({
  SeriesChart: (props: { onCrosshairMove?: typeof onCrosshairMove; onClick?: typeof onClick }) => {
    onCrosshairMove = props.onCrosshairMove;
    onClick = props.onClick;
    return <div data-testid="series-chart" />;
  },
}));
vi.mock("@/components/ui/instrument-selector", () => ({
  InstrumentSelector: () => <div data-testid="instrument-selector" />,
}));
vi.mock("@/components/charts/chart-frame", () => ({
  ChartFrame: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// One session's rate history: IRS 3Y and 10Y quotes on the trade date.
const POINT = {
  valuation_date: "2026-03-23",
  cd_rate: 0.029,
  tenor_rates: { "3Y": 0.028, "10Y": 0.031 } as Record<string, number>,
};
vi.mock("@/hooks/use-api", () => ({
  useMarketDataRange: () => ({ data: { min_date: "2026-01-02", max_date: "2026-03-23" }, isLoading: false, isError: false }),
  useRateHistory: () => ({ data: { points: [POINT] }, isLoading: false, isError: false }),
  useCreditCurveTaxonomy: () => ({ data: { sectors: [] } }),
  useCreditCurveSeries: () => ({ data: { results: [] } }),
}));

const { RateHistoryChart } = await import("./rate-history-chart");

function render() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(
    <QueryClientProvider client={qc}>
      <RateHistoryChart />
    </QueryClientProvider>,
  );
}

/** A readout as SeriesChart would emit it from param.seriesData (same-source). */
function emit(date: string | null, points: SeriesChartReadout["points"]) {
  act(() => onCrosshairMove!({ date, points }));
}

afterEach(() => {
  cleanup();
  onCrosshairMove = undefined;
  onClick = undefined;
});

describe("RateHistoryChart — FB5R R1 crosshair rate readout", () => {
  it("renders a reserved readout strip with an idle hint until a crosshair fires", () => {
    render();
    const strip = screen.getByTestId("rh-rate-readout");
    expect(within(strip).getByText(/커서를 올리거나 날짜를 클릭하면/)).toBeTruthy();
  });

  it("shows the crosshair date, each charted series' own rate, and the uncharted benchmark tenor", () => {
    render();
    // Only IRS 3Y is charted at this date; SeriesChart hands its plotted value.
    emit("2026-03-23", [
      { id: "O:IRS||3Y", label: "IRS 3Y", color: "rgb(1,1,1)", value: 0.028, text: "2.8000%" },
    ]);
    const strip = screen.getByTestId("rh-rate-readout");
    expect(within(strip).getByText("2026-03-23")).toBeTruthy();
    // Charted series value verbatim (same-source with the line).
    expect(within(strip).getByText("2.8000%")).toBeTruthy();
    // The benchmark pair: IRS 10Y is NOT charted → surfaced from the points
    // (0.031 → 3.1000%), even though it isn't a drawn series.
    expect(within(strip).getByText("IRS 10Y")).toBeTruthy();
    expect(within(strip).getByText("3.1000%")).toBeTruthy();
    // …and IRS 3Y is NOT duplicated as a benchmark (it's the charted series).
    expect(within(strip).queryByText("IRS 3Y")).toBeTruthy(); // present as the series label
    expect(within(strip).queryAllByText("2.8000%")).toHaveLength(1);
  });

  it("a quoteless day shows — for both benchmark tenors (never a fabricated rate)", () => {
    render();
    emit("2099-01-01", []); // date absent from points, nothing charted there
    const strip = screen.getByTestId("rh-rate-readout");
    expect(within(strip).getByText("2099-01-01")).toBeTruthy();
    expect(within(strip).getByText("IRS 3Y")).toBeTruthy();
    expect(within(strip).getByText("IRS 10Y")).toBeTruthy();
    expect(within(strip).getAllByText("—").length).toBe(2); // both benchmarks —
  });

  it("clicking a date PINS the readout so it survives the cursor leaving the chart", () => {
    render();
    // Hover then leave (null) — with no pin the strip would fall back to the hint.
    emit("2026-03-23", [{ id: "O:IRS||3Y", label: "IRS 3Y", color: "rgb(1,1,1)", value: 0.028, text: "2.8000%" }]);
    act(() => onCrosshairMove!(null));
    expect(within(screen.getByTestId("rh-rate-readout")).getByText(/커서를 올리거나/)).toBeTruthy();

    // Click a date: the readout pins and persists after the crosshair leaves.
    act(() =>
      onClick!({
        date: "2026-03-23",
        nearest: null,
        readout: {
          date: "2026-03-23",
          points: [{ id: "O:IRS||10Y", label: "IRS 10Y", color: "rgb(2,2,2)", value: 0.031, text: "3.1000%" }],
        },
        param: {} as SeriesChartClickContext["param"],
      }),
    );
    act(() => onCrosshairMove!(null)); // cursor leaves — pin must remain
    const strip = screen.getByTestId("rh-rate-readout");
    expect(within(strip).getByText("2026-03-23")).toBeTruthy();
    expect(within(strip).getByText("3.1000%")).toBeTruthy(); // pinned series value
  });
});
