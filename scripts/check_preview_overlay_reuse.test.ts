/**
 * FB4 T2 reuse guard: the 커브형 scenario overlay must be a VIEW over the
 * request's own path machinery — lib/recon/path-matrix's evaluator consumed
 * through buildScenarioOverlay. A forked propagation (local stitching math in
 * the panel, or an overlay builder that stops importing the evaluator) fails
 * here by name. Source-level, like the other reuse gates in scripts/.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "src");
const LIB = join(SRC, "features", "simulation", "lib", "input-curve-preview.ts");
const PANEL = join(
  SRC, "features", "simulation", "components", "panels", "curve-view-panel.tsx",
);

describe("커브형 overlay reuse guard (FB4 T2)", () => {
  it("the overlay builder consumes the path-matrix evaluator (the ONE propagation source)", () => {
    const lib = readFileSync(LIB, "utf8");
    expect(lib).toMatch(/import\s*\{[^}]*createPathEvaluator[^}]*\}\s*from\s*"\.\/recon\/path-matrix"/);
    // The ghost values flow through cumBpAt — no local zone/staircase math
    // (the stitching constants live in path-matrix alone).
    expect(lib).toMatch(/cumBpAt\(/);
  });

  it("the panel renders overlays only through buildScenarioOverlay — no direct terminal-shock math", () => {
    const panel = readFileSync(PANEL, "utf8");
    expect(panel).toMatch(/buildScenarioOverlay/);
    // The panel must not reach for the raw node interpolators itself: the
    // terminal-only helpers stay lib-internal to the overlay path.
    expect(panel).not.toMatch(/\bshockAtTenor\b/);
    expect(panel).not.toMatch(/\bgenerateShockCurves\b/);
    expect(panel).not.toMatch(/\bderiveFundingSteps\b/);
    // Legacy two-line builder retired from the panel (still lib-tested).
    expect(panel).not.toMatch(/\bbuildInputCurvePreview\b/);
  });
});
