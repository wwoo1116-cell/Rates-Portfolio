/**
 * S10 heat-ramp contrast gate: the DV01/PVBP/KRD signed-sensitivity heatmaps
 * render fixed WHITE text on Jade (positive) / Berry (negative) alpha-step
 * fills. Every step of both ramps, composited over --bg-surface, must keep
 * white text at >= 3:1 (WCAG 1.4.11 floor, same as the S7 chart-token gate).
 * The owner rule when a step fails is to CLAMP the ramp (drop the step), never
 * to switch the text to dark — so this gate failing means the alpha steps in
 * HEAT_ALPHA_STEPS need lowering, not the text color changing.
 *
 * Also pins the tokens.css mirror (--chart-heat-*) to the chart-colors
 * constants, the same both-homes-agree contract the rest of the palette has.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  HEAT_ALPHA_STEPS,
  HEAT_NEG_BASE,
  HEAT_NEG_RAMP,
  HEAT_POS_BASE,
  HEAT_POS_RAMP,
  HEAT_TEXT_COLOR,
  heatRampFill,
} from "@/lib/chart-colors";
import {
  CONTRAST_FLOOR,
  contrastRatio,
  defaultTokensCssPath,
  parseCustomProps,
  resolveProp,
} from "./check_chart_contrast";

const props = parseCustomProps(readFileSync(defaultTokensCssPath(), "utf8"));
const SURFACE = resolveProp(props, "--bg-surface");

function parseRgba(s: string): { r: number; g: number; b: number; a: number } {
  const m = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(s.trim());
  if (!m) throw new Error(`expected rgba(r, g, b, a), got "${s}"`);
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: Number(m[4]) };
}

function hexChannels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** sRGB source-over compositing of an alpha fill on an opaque background —
 * what the browser actually paints for these cells. */
function compositeOverSurface(rgba: string): string {
  const { r, g, b, a } = parseRgba(rgba);
  const [br, bg, bb] = hexChannels(SURFACE);
  const ch = (fgc: number, bgc: number) => Math.round(a * fgc + (1 - a) * bgc);
  return `#${[ch(r, br), ch(g, bg), ch(b, bb)]
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}`;
}

describe("heat-ramp contrast gate (S10)", () => {
  it("white cell text clears the floor on EVERY step of both ramps", () => {
    const report: string[] = [];
    for (const [family, ramp] of [
      ["pos(Jade)", HEAT_POS_RAMP],
      ["neg(Berry)", HEAT_NEG_RAMP],
    ] as const) {
      ramp.forEach((step, i) => {
        const composite = compositeOverSurface(step);
        const ratio = contrastRatio(HEAT_TEXT_COLOR, composite);
        report.push(
          `${family} step ${i + 1} (${step} -> ${composite}): ${ratio.toFixed(2)}:1 ${
            ratio >= CONTRAST_FLOOR ? "pass" : "FAIL"
          }`,
        );
      });
    }
    const failures = report.filter((l) => l.endsWith("FAIL"));
    expect(failures, report.join("\n")).toEqual([]);
  });

  it("the clamp stays honest: one more 15% step above the top WOULD fail for Jade", () => {
    // If this starts passing, the ramp can be extended upward — the clamp is
    // stale, tighten deliberately rather than leaving headroom undocumented.
    const overTop = `rgba(${hexChannels(HEAT_POS_BASE).join(", ")}, ${
      HEAT_ALPHA_STEPS[HEAT_ALPHA_STEPS.length - 1] + 0.15
    })`;
    expect(contrastRatio(HEAT_TEXT_COLOR, compositeOverSurface(overTop))).toBeLessThan(
      CONTRAST_FLOOR,
    );
  });

  it("ramps step monotonically (stronger magnitude -> stronger fill)", () => {
    for (let i = 1; i < HEAT_ALPHA_STEPS.length; i++) {
      expect(HEAT_ALPHA_STEPS[i]).toBeGreaterThan(HEAT_ALPHA_STEPS[i - 1]);
    }
    expect(HEAT_POS_RAMP).toHaveLength(HEAT_ALPHA_STEPS.length);
    expect(HEAT_NEG_RAMP).toHaveLength(HEAT_ALPHA_STEPS.length);
  });

  it("tokens.css --chart-heat-* mirrors the chart-colors constants", () => {
    expect(resolveProp(props, "--chart-heat-pos").toUpperCase()).toBe(HEAT_POS_BASE.toUpperCase());
    expect(resolveProp(props, "--chart-heat-neg").toUpperCase()).toBe(HEAT_NEG_BASE.toUpperCase());
    expect(resolveProp(props, "--chart-heat-text").toUpperCase()).toBe(
      HEAT_TEXT_COLOR.toUpperCase(),
    );
    // Jade/Berry P&L hue families, as selected by the owner (T2).
    expect(HEAT_POS_BASE).toBe(resolveProp(props, "--ms-jade-80"));
    expect(HEAT_NEG_BASE).toBe(resolveProp(props, "--ms-berry-80"));
  });

  it("heatRampFill picks family by sign, step by |value|/range, transparent at zero", () => {
    expect(heatRampFill(0, 100)).toBe("transparent");
    expect(heatRampFill(50, 0)).toBe("transparent");
    expect(heatRampFill(Number.NaN, 100)).toBe("transparent");
    expect(heatRampFill(1, 100)).toBe(HEAT_POS_RAMP[0]);
    expect(heatRampFill(-1, 100)).toBe(HEAT_NEG_RAMP[0]);
    expect(heatRampFill(100, 100)).toBe(HEAT_POS_RAMP[HEAT_POS_RAMP.length - 1]);
    expect(heatRampFill(-1e9, 100)).toBe(HEAT_NEG_RAMP[HEAT_NEG_RAMP.length - 1]);
    // Values above range clamp to the top step, never index out of the ramp.
    expect(heatRampFill(250, 100)).toBe(HEAT_POS_RAMP[HEAT_POS_RAMP.length - 1]);
  });
});
