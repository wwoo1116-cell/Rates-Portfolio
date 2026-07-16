// @vitest-environment jsdom
/**
 * iv4 T2.2/T2.3 pin — the s18 T6 wiring, applied and locked:
 *  1. The return panel's defs resolve the SIGNED 억/만 KRW formatter through
 *     `valueKind: "krw"` (losses read negative — owner feedback ④), with no
 *     explicit `formatter:` key suppressing it.
 *  2. Badge collision policy: exactly the primary (base/합계) def keeps its
 *     last-value badge; panel-added scenario lines stay badge-less.
 *  3. Z-order formatter capture (LWC defect family #4): the lowest-z-order
 *     series on the return panel's price scale MUST carry a priceFormat —
 *     the scale formats ticks and badges from that series, so an unformatted
 *     lowest series reverts the whole scale to raw floats regardless of what
 *     the visible lines declare (s18 T6 root cause).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { formatKrwAxisSigned } from "@/lib/format";

const rec = vi.hoisted(() => ({
  series: [] as {
    options: Record<string, unknown>;
    paneIndex: number;
    order: number | null;
    createdAt: number;
  }[],
  reset() {
    this.series.length = 0;
  },
}));

vi.mock("lightweight-charts", () => {
  const makeSeries = (options: Record<string, unknown>, paneIndex: number) => {
    const s = {
      options: { ...options },
      paneIndex,
      order: null as number | null,
      createdAt: rec.series.length,
      applyOptions(o: Record<string, unknown>) {
        Object.assign(this.options, o);
      },
      setData() {},
      setSeriesOrder(n: number) {
        this.order = n;
      },
      createPriceLine() {
        return {};
      },
      removePriceLine() {},
    };
    rec.series.push(s);
    return s;
  };
  return {
    createChart: () => ({
      addSeries: (_t: unknown, options: Record<string, unknown>, paneIndex = 0) =>
        makeSeries(options, paneIndex),
      addCustomSeries: (_v: unknown, options: Record<string, unknown>) => makeSeries(options, 0),
      removeSeries: () => {},
      priceScale: () => ({ applyOptions: () => {} }),
      timeScale: () => ({ fitContent: () => {}, width: () => 400 }),
      panes: () => [{ setHeight: () => {} }, { setHeight: () => {} }],
      subscribeClick: () => {},
      subscribeCrosshairMove: () => {},
      unsubscribeCrosshairMove: () => {},
      applyOptions: () => {},
      remove: () => {},
    }),
    CrosshairMode: { Normal: 0 },
    LineSeries: "Line",
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2 },
    LineType: { Simple: 0, WithSteps: 1 },
    createSeriesMarkers: () => ({ setMarkers: () => {}, detach: () => {} }),
  };
});
vi.mock("@/components/charts/snap-reticle", () => ({
  paneOffsetX: () => 0,
  snapReticleToNearestSeries: () => null,
  seriesDistanceY: () => null,
}));
vi.mock("../charts/rate-fan-chart", () => ({ RateFanChart: () => null }));

const band = (day: number, v: number) => ({ day, p5: v - 2e7, p25: v - 1e7, p50: v, p75: v + 1e7, p95: v + 2e7 });
const row = (day: number, total: number) => ({
  day,
  totalPnL: total,
  mtmPnL: total / 2,
  cumulativeCarry: total / 4,
  swapThetaPnL: total / 8,
  swapValuationPnL: total / 8,
});

const portState = vi.hoisted(() => ({
  lastRun: null as unknown,
}));
vi.mock("../../hooks/use-simulation", () => ({
  useSimulationPort: () => ({
    lastRun: portState.lastRun,
    inputs: { baseDate: "2026-07-16" },
    status: "idle",
  }),
}));

import { DistributionChartPanel } from "./distribution-chart-panel";

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", FakeResizeObserver);

const SCENARIO_RUN = {
  chartData: [row(0, 0), row(1, -432_400_000)],
  summary: { breakEvenDay: -1 },
  distribution: {
    bands: [band(0, 0), band(1, -432_400_000)],
    sigmaBpDaily: 2.0,
    sigmaTerminalBp: 22.0,
    ratePaths: null,
  },
  fundingCurve: [{ day: 0, fundingRate: 0.0285, positionRate: 0.0342, carryBp: 57.1 }],
};

afterEach(() => {
  cleanup();
  rec.reset();
});

/** Series on the return chart's DEFAULT pane + right scale (funding strip
 * lives on pane 1 with its own scale and is exempt). */
const returnScaleSeries = () => rec.series.filter((s) => s.paneIndex === 0);

describe("distribution panel — s18 T6 wiring applied (iv4 T2.2/T2.3)", () => {
  it("the center def resolves the SIGNED 억/만 formatter via valueKind (no explicit formatter)", () => {
    portState.lastRun = SCENARIO_RUN;
    render(<DistributionChartPanel />);
    const center = returnScaleSeries().find((s) => s.options.lastValueVisible !== false)!;
    expect(center, "a badged center series must exist").toBeDefined();
    const pf = center.options.priceFormat as { type?: string; formatter?: (v: number) => string };
    expect(pf?.type).toBe("custom");
    expect(pf!.formatter!(320_000_000)).toBe("+3.2억"); // gains signed
    expect(pf!.formatter!(-432_400_000)).toBe("-4.3억"); // losses read negative
    expect(pf!.formatter!(-4_500_000)).toBe("-450만"); // no raw floats, no sub-만원 digits
    // Identity with the shared util — one formatter, not a lookalike.
    expect(pf!.formatter!(123_456_789.12)).toBe(formatKrwAxisSigned(123_456_789.12));
  });

  it("exactly one badge on the pane: the primary center; scenario lines are badge-less", () => {
    portState.lastRun = SCENARIO_RUN;
    render(<DistributionChartPanel />);
    const badged = returnScaleSeries().filter((s) => s.options.lastValueVisible !== false);
    expect(badged).toHaveLength(1);
  });

  it("fallback (no distribution): five defs, 합계 carries the only badge", () => {
    portState.lastRun = { ...SCENARIO_RUN, distribution: null, fundingCurve: null };
    render(<DistributionChartPanel />);
    const defs = returnScaleSeries();
    expect(defs).toHaveLength(5);
    const badged = defs.filter((s) => s.options.lastValueVisible !== false);
    expect(badged).toHaveLength(1);
    // The badged def is the 3px 합계 line, and it too is signed-KRW formatted.
    expect(badged[0].options.lineWidth).toBe(3);
    const pf = badged[0].options.priceFormat as { formatter?: (v: number) => string };
    expect(pf!.formatter!(-432_400_000)).toBe("-4.3억");
  });

  it("z-order rule: the lowest-z-order series on the scale carries a priceFormat", () => {
    portState.lastRun = SCENARIO_RUN;
    render(<DistributionChartPanel />);
    const scale = returnScaleSeries();
    // Effective z-order: explicit setSeriesOrder wins; otherwise creation order.
    const lowest = [...scale].sort(
      (a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt),
    )[0];
    expect(
      lowest.options.priceFormat,
      "the lowest-z-order series dictates the scale format (LWC defect family #4) — it must carry a priceFormat",
    ).toBeDefined();
  });
});
