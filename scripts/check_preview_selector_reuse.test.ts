/**
 * FB5R R2 reuse guard: the simulation preview's selection UI must be the IMPORTED
 * Rates History control row (InstrumentSelector) configured per mode — the owner
 * ruling ("Rates History의 방식", and the amendment "the RH selector's own
 * dropdown doing its job"), NOT a mirror. A fork (a new preview-local selector,
 * or the panel hand-rolling HTMLSelect dropdowns) fails here by name, and the old
 * 1D~10Y tenor-button / 곡선군 chip-toggle rows must be gone. Source-level, like
 * the other reuse gates in scripts/ — a runtime test can't see a copy-paste that
 * never imports the original.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "src");
const PANEL = join(
  SRC, "features", "simulation", "components", "panels", "curve-view-panel.tsx",
);
// The shared selector now lives in the slice-sanctioned shared surface
// (@/components/ui, like the canonical SeriesChart in @/components/charts) so the
// simulation slice can import it without crossing the isolation boundary.
const SELECTOR = join(SRC, "components", "ui", "instrument-selector.tsx");

describe("preview selector reuse guard (FB5R R2)", () => {
  const panel = readFileSync(PANEL, "utf8");
  const selector = readFileSync(SELECTOR, "utf8");

  it("the panel IMPORTS the shared Rate History selector (reuse, not mirror)", () => {
    expect(panel).toMatch(
      /import\s*\{\s*InstrumentSelector\s*\}\s*from\s*"@\/components\/ui\/instrument-selector"/,
    );
    // …and actually renders it in BOTH modes (configured per mode).
    expect(panel).toMatch(/<InstrumentSelector/);
    expect(panel).toMatch(/ratingDisabled/); // 시계열형 config
    expect(panel).toMatch(/tenorDisabled/); // 커브형 config
  });

  it("the panel owns NO dropdown grammar of its own — it delegates to the shared component", () => {
    // No mirrored selector primitives: the three-dropdown grammar lives in the
    // imported component, never re-implemented here.
    expect(panel).not.toMatch(/HTMLSelect/);
    expect(panel).not.toMatch(/@blueprintjs\/core/);
  });

  it("the old tenor-button / 곡선군 chip-toggle rows are gone (pinned absent)", () => {
    // ToggleChip was the old aria-pressed chip; both chip rows are replaced by
    // the selector + removable chips.
    expect(panel).not.toMatch(/ToggleChip/);
    expect(panel).not.toMatch(/aria-pressed/);
    expect(panel).not.toMatch(/toggleIn/);
    expect(panel).not.toMatch(/selCurveFamilies|selFamilies|selTenors/);
  });

  it("the shared selector genuinely carries the preview configuration (config, not a fork)", () => {
    // The RH component exposes the optional, default-preserving knobs the preview
    // needs; if these vanish (someone forks a preview copy instead), the reuse
    // path is broken.
    for (const prop of ["modes", "showFilter", "ratingDisabled", "tenorDisabled", "colorOf"]) {
      expect(selector).toMatch(new RegExp(`\\b${prop}\\b`));
    }
  });
});
