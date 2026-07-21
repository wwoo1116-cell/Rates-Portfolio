// @vitest-environment jsdom
/**
 * RECON2-RH — Δbp time-series chart pins:
 *  - all-on default (owner ruling): every TENOR_COLS pillar as a series,
 *    labeled in the D+1 / D+91 / D+1Y vocabulary, valueKind "bp" on every
 *    series (scale-formatter z-order rule);
 *  - parity: point values come from the RETAINED row.deltaBp maps;
 *  - calendar honesty: weekend slots, window-mismatch days and unmapped
 *    pillars are WHITESPACE points; a measured 0.0bp is a value point;
 *  - legibility solution: existing 3-step maturity-ramp colors + Tangerine
 *    hover highlight + s14 primary-only badge (3Y);
 *  - chips filter on top of the all-on default; the last one stays.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { CHART_SERIES_COLORS, MATURITY_RAMP } from "@/lib/chart-colors";
import type { SeriesChartSeriesDef } from "@/components/charts/series-chart";
import type { ReconRangeRow } from "@/hooks/use-recon-range";

let chartProps: { series: SeriesChartSeriesDef[] } | null = null;
vi.mock("@/components/charts/series-chart", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/charts/series-chart")>();
  return {
    ...actual,
    SeriesChart: (props: { series: SeriesChartSeriesDef[] }) => {
      chartProps = props;
      return <div data-testid="series-chart" />;
    },
  };
});

const { ReconDeltaBpChart, buildDeltaBpSeries, TENOR_DAY_LABELS, HIGHLIGHT_COLOR } = await import(
  "./recon-deltabp-chart"
);
const { TENOR_COLS } = await import("./pvbp-sensitivity-table");

/** Wed 07-15 full map (1D unmapped, 3M +2.0, 4Y −1.5, rest 0) · Thu 07-16
 * window mismatch (no map) · Mon 07-20 (after the 07-18/19 weekend) with a
 * MEASURED 0.0 on 3M. */
function fullMap(): Record<string, number | null> {
  return Object.fromEntries(TENOR_COLS.map((c) => [c, c === "1D" ? null : 0])) as Record<
    string,
    number | null
  >;
}
const ROWS: ReconRangeRow[] = [
  {
    asOf: "2026-07-15",
    close: "2026-07-14",
    theta: 5e5,
    assumed: -1e6,
    expected: -5e5,
    realized: -7e5,
    residual: 3e5,
    residualPct: 42.9,
    deltaBp: { ...fullMap(), "3M": 2.0, "4Y": -1.5 },
  },
  {
    asOf: "2026-07-16",
    close: "2026-07-15",
    theta: null,
    assumed: null,
    expected: null,
    realized: null,
    residual: null,
    residualPct: null,
    note: "서버 평가일 2026-07-20 ≠ 다음 가용일 — 창 불일치로 제외",
    // no deltaBp — window mismatch
  },
  {
    asOf: "2026-07-20",
    close: "2026-07-16",
    theta: 0,
    assumed: 0,
    expected: 0,
    realized: 0,
    residual: 0,
    residualPct: null,
    deltaBp: { ...fullMap(), "3M": 0.0, "4Y": 1.0 },
  },
];

afterEach(() => {
  cleanup();
  chartProps = null;
});

function seriesById(id: string): SeriesChartSeriesDef {
  const s = chartProps!.series.find((d) => d.id === id);
  expect(s, id).toBeDefined();
  return s!;
}

describe("ReconDeltaBpChart (RECON2-RH)", () => {
  it("all-on default: one series per TENOR_COLS pillar, D+ vocabulary labels, valueKind bp everywhere", () => {
    render(<ReconDeltaBpChart rows={ROWS} />);
    expect(chartProps!.series.map((s) => s.id)).toEqual([...TENOR_COLS]);
    expect(chartProps!.series.map((s) => s.label)).toEqual([
      "D+1", "D+91", "D+182", "D+273", "D+1Y", "D+18M", "D+2Y", "D+3Y",
      "D+4Y", "D+5Y", "D+6Y", "D+7Y", "D+8Y", "D+9Y", "D+10Y", "D+30Y",
    ]);
    for (const s of chartProps!.series) expect(s.valueKind).toBe("bp");
  });

  it("parity: point values are the retained row.deltaBp values", () => {
    render(<ReconDeltaBpChart rows={ROWS} />);
    const m3 = seriesById("3M").data.find((p) => p.time === "2026-07-15");
    expect(m3).toEqual({ time: "2026-07-15", value: 2.0 });
    const y4 = seriesById("4Y").data.find((p) => p.time === "2026-07-20");
    expect(y4).toEqual({ time: "2026-07-20", value: 1.0 });
  });

  it("calendar honesty: weekend slots, mismatch days and unmapped pillars are whitespace; measured 0.0 is a value", () => {
    render(<ReconDeltaBpChart rows={ROWS} />);
    const m3 = seriesById("3M");
    // Continuous calendar 07-15 → 07-20 inclusive = 6 slots for every series.
    for (const s of chartProps!.series) expect(s.data.length).toBe(6);
    const at = (t: string) => m3.data.find((p) => p.time === t)!;
    expect(at("2026-07-16")).toEqual({ time: "2026-07-16" }); // mismatch → whitespace
    expect(at("2026-07-18")).toEqual({ time: "2026-07-18" }); // Saturday
    expect(at("2026-07-19")).toEqual({ time: "2026-07-19" }); // Sunday
    expect(at("2026-07-20")).toEqual({ time: "2026-07-20", value: 0 }); // measured 0.0 ≠ whitespace
    // Unmapped pillar (1D): whitespace on every day — never zero.
    expect(seriesById("1D").data.every((p) => !("value" in p))).toBe(true);
  });

  it("legibility: existing 3-step maturity ramp only, primary badge only on 3Y", () => {
    render(<ReconDeltaBpChart rows={ROWS} />);
    for (const c of ["1D", "3M", "6M", "9M"]) expect(seriesById(c).color).toBe(MATURITY_RAMP.short);
    for (const c of ["1Y", "1.5Y", "2Y", "3Y"]) expect(seriesById(c).color).toBe(MATURITY_RAMP.mid);
    for (const c of ["4Y", "5Y", "10Y", "30Y"]) expect(seriesById(c).color).toBe(MATURITY_RAMP.long);
    // No hue outside the existing token set on this surface.
    const allowed = new Set<string>([MATURITY_RAMP.short, MATURITY_RAMP.mid, MATURITY_RAMP.long]);
    for (const s of chartProps!.series) expect(allowed.has(s.color)).toBe(true);
    // s14 collision policy: only 3Y opts in as primary.
    expect(chartProps!.series.filter((s) => s.primary).map((s) => s.id)).toEqual(["3Y"]);
  });

  it("chip hover highlights that tenor in the existing Tangerine accent, and restores on leave", () => {
    render(<ReconDeltaBpChart rows={ROWS} />);
    const chip = screen.getByRole("button", { name: "D+91" }); // 3M
    fireEvent.mouseEnter(chip);
    expect(seriesById("3M").color).toBe(HIGHLIGHT_COLOR);
    expect(seriesById("3M").lineWidth).toBe(3);
    expect(seriesById("6M").color).toBe(MATURITY_RAMP.short); // others untouched
    fireEvent.mouseLeave(chip);
    expect(seriesById("3M").color).toBe(MATURITY_RAMP.short);
    expect(seriesById("3M").lineWidth).toBe(1);
    expect(HIGHLIGHT_COLOR).toBe(CHART_SERIES_COLORS[3]); // Tangerine — an existing hue
  });

  it("chips filter the all-on default; the last selected tenor cannot be removed", () => {
    render(<ReconDeltaBpChart rows={ROWS} />);
    fireEvent.click(screen.getByRole("button", { name: "D+1" }));
    expect(chartProps!.series.map((s) => s.id)).toEqual(TENOR_COLS.filter((c) => c !== "1D"));
    // Deselect everything else down to one…
    for (const c of TENOR_COLS.filter((c) => c !== "1D" && c !== "3Y")) {
      fireEvent.click(screen.getByRole("button", { name: TENOR_DAY_LABELS[c] }));
    }
    expect(chartProps!.series.map((s) => s.id)).toEqual(["3Y"]);
    // …and the last one stays.
    fireEvent.click(screen.getByRole("button", { name: "D+3Y" }));
    expect(chartProps!.series.map((s) => s.id)).toEqual(["3Y"]);
  });

  it("buildDeltaBpSeries is pure over the rows (selector-level parity for the pin above)", () => {
    const defs = buildDeltaBpSeries(ROWS, ["3M"], null);
    expect(defs.length).toBe(1);
    expect(defs[0].data.find((p) => p.time === "2026-07-15")).toEqual({
      time: "2026-07-15",
      value: ROWS[0].deltaBp!["3M"],
    });
  });
});
