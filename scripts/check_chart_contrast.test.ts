import { describe, expect, it } from "vitest";
import {
  CONTRAST_FLOOR,
  LARGE_FILL_ONLY_ALLOWLIST,
  contrastRatio,
  defaultTokensCssPath,
  formatReport,
  runContrastGate,
} from "./check_chart_contrast";

describe("chart-contrast gate (S7)", () => {
  const { rows, failures } = runContrastGate(defaultTokensCssPath());

  it("finds the chart token layer (parser sanity)", () => {
    // 7 sector + 3 maturity + 4 pnl + 5 sim series + 5 legacy accents = 24
    expect(rows.length).toBeGreaterThanOrEqual(24);
  });

  it(`every --chart-* token clears ${CONTRAST_FLOOR}:1 vs --bg-surface, or is on the documented large-fill-only allowlist`, () => {
    expect(formatReport(failures)).toBe(formatReport([]));
  });

  it("the allowlist stays honest: its entries really are below the floor", () => {
    // If Navy-80 (or a future entry) starts passing, the exemption is stale
    // and must be removed rather than silently widening the gate.
    for (const token of LARGE_FILL_ONLY_ALLOWLIST) {
      const row = rows.find((r) => r.token === token);
      expect(row, token).toBeDefined();
      expect(row!.ratio).toBeLessThan(CONTRAST_FLOOR);
    }
  });

  it("computes the WCAG reference values correctly", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#808080", "#808080")).toBeCloseTo(1, 5);
  });
});
