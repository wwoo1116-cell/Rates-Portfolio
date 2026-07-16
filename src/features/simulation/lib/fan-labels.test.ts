import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  BARE_RANK_LABEL,
  FAN_PERCENTILES,
  rateBandLabel,
  returnScenarioLabel,
  returnScenarioShortLabel,
} from "./fan-labels";

/**
 * s18 T3 — the dual-axis label policy, pinned. Outcome-rank labels ("P95")
 * are truthful ONLY on the rate axis (monotone in the quantile by
 * construction). The return panel must label by SCENARIO; a bare rank label
 * there is a false claim on non-monotone books and fails here.
 */
describe("fan label policy (s18 T3)", () => {
  it("rate-axis labels are the truthful bare ranks", () => {
    expect(FAN_PERCENTILES.map(rateBandLabel)).toEqual(["P5", "P25", "P50", "P75", "P95"]);
  });

  it("return-panel labels are scenario labels, never bare outcome ranks", () => {
    for (const pct of FAN_PERCENTILES) {
      expect(returnScenarioLabel(pct)).not.toMatch(BARE_RANK_LABEL);
      expect(returnScenarioShortLabel(pct)).not.toMatch(BARE_RANK_LABEL);
    }
    expect(returnScenarioLabel(95)).toBe("금리 P95 시나리오");
    expect(returnScenarioLabel(50)).toBe("기본 시나리오 (금리 P50)");
  });

  it("the return panel component carries no bare rank label literal", () => {
    // Source scan: the return panel (distribution-chart-panel.tsx) must take
    // every label from fan-labels.ts. A bare "P95"-style string literal in the
    // file is exactly the regression the owner banned. (rateBandLabel's bare
    // ranks are legal only inside the rate-fan header, which this panel builds
    // via rateBandLabel(), never a literal.)
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      join(here, "../components/panels/distribution-chart-panel.tsx"),
      "utf-8",
    );
    // Comments may DISCUSS the banned label ("P95" appears in the policy
    // docstring); the ban is on rendered/code literals, so strip comments
    // before scanning.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const bareLabelLiteral = /["'`]P\d{1,2}["'`]/;
    expect(code).not.toMatch(bareLabelLiteral);
  });
});
