/**
 * R3B-PLUS B2 contrast gate: the Home allocation bars' in-segment percentage
 * labels pick light or dark text per fill (chart-colors.ts's
 * resolveSegmentLabelColor) rather than a single fixed color, because the
 * sector/maturity fills span Navy-80 (dark) to Aqua-60/Navy-20 (near-white) —
 * unlike the heat ramp's narrower, owner-ruled alpha steps, no single fixed
 * color clears 3:1 everywhere here. This pins that the CHOSEN color actually
 * clears the floor for every fill currently in the live palette (all of
 * SECTOR_COLORS + MATURITY_RAMP; the merged 국고·통안 segment reuses
 * SECTOR_COLORS.국고채, already covered).
 *
 * Segments are opaque solid-hex fills (no alpha), so no --bg-surface
 * compositing step is needed here, unlike the heat ramp's translucent cells.
 */
import { describe, expect, it } from "vitest";
import {
  LABEL_ON_FILL_DARK,
  LABEL_ON_FILL_LIGHT,
  MATURITY_RAMP,
  SECTOR_COLORS,
  resolveSegmentLabelColor,
} from "@/lib/chart-colors";
import { CONTRAST_FLOOR, contrastRatio } from "./check_chart_contrast";

describe("allocation-bar segment label contrast gate (R3B-PLUS B2)", () => {
  const allFills: Record<string, string> = {
    ...Object.fromEntries(Object.entries(SECTOR_COLORS).map(([k, v]) => [`sector:${k}`, v])),
    "maturity:short": MATURITY_RAMP.short,
    "maturity:mid": MATURITY_RAMP.mid,
    "maturity:long": MATURITY_RAMP.long,
  };

  it("the resolved label color clears the floor on EVERY sector + maturity fill", () => {
    const report: string[] = [];
    for (const [name, fill] of Object.entries(allFills)) {
      const label = resolveSegmentLabelColor(fill);
      const ratio = contrastRatio(label, fill);
      report.push(
        `${name} (${fill}) -> label ${label}: ${ratio.toFixed(2)}:1 ${
          ratio >= CONTRAST_FLOOR ? "pass" : "FAIL"
        }`,
      );
    }
    const failures = report.filter((l) => l.endsWith("FAIL"));
    expect(failures, report.join("\n")).toEqual([]);
  });

  it("always picks one of the two sanctioned candidates, never invents a color", () => {
    for (const fill of Object.values(allFills)) {
      expect([LABEL_ON_FILL_LIGHT, LABEL_ON_FILL_DARK]).toContain(resolveSegmentLabelColor(fill));
    }
  });

  it("picks the higher-contrast candidate, not a fixed rule (mechanism, not accident)", () => {
    // MS.blue (mid-saturated) reads better with light text; Navy-20
    // (near-white) reads better with dark text -- if this ever flips, the
    // resolver picked a candidate that does NOT maximize contrast.
    expect(resolveSegmentLabelColor(SECTOR_COLORS.국고채)).toBe(LABEL_ON_FILL_LIGHT);
    expect(resolveSegmentLabelColor(SECTOR_COLORS.회사채)).toBe(LABEL_ON_FILL_DARK);
    for (const fill of Object.values(allFills)) {
      const chosen = resolveSegmentLabelColor(fill);
      const other = chosen === LABEL_ON_FILL_LIGHT ? LABEL_ON_FILL_DARK : LABEL_ON_FILL_LIGHT;
      expect(contrastRatio(chosen, fill)).toBeGreaterThanOrEqual(contrastRatio(other, fill));
    }
  });
});
