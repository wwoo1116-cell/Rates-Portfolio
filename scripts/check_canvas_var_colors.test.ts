/**
 * Canvas resolved-hex guard (integration v3). lightweight-charts (and raw
 * canvas 2D) render outside the DOM: a CSS custom property handed to them as
 * "var(--x)" is NOT resolved — the option silently falls back to the library
 * default. This defect class shipped twice (s10: Portfolio MtM line on
 * var(--accent); iv3 sweep: the sim pricer's mid line + crosshair marker),
 * so it gets a gate:
 *
 *  A. Inside the argument span of any canvas-bound call —
 *     createChart / addSeries / applyOptions / createPriceLine /
 *     createSeriesMarkers / setMarkers — a "var(" string literal is banned.
 *     (Balanced-paren span over comment-stripped source, so multi-line
 *     option objects are covered.)
 *  B. Anywhere in a chart file, canvas-ONLY option keys (lineColor,
 *     topColor, crosshairMarker*Color, priceLineColor, …) must not be
 *     assigned a "var(" literal — these keys never reach the DOM, so there
 *     is no legitimate var() use, even via an intermediate object.
 *
 * DOM JSX styles (style={{ color: "var(--…)" }}) in the same files stay
 * legal — they're not scanned by A (outside call spans) or B (plain
 * `color:`/`background:` keys are DOM-ambiguous and deliberately excluded).
 * KNOWN LIMIT: a marker/series-def object built in a helper and passed by
 * reference is only caught if it uses a canvas-only key (B) — reviewers
 * still own that corner.
 *
 * Scope: every file importing lightweight-charts, plus src/components/charts/**.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

const CANVAS_CALLS = /\b(?:createChart|addSeries|applyOptions|createPriceLine|createSeriesMarkers|setMarkers)\s*\(/g;
const CANVAS_ONLY_KEYS =
  /\b(?:lineColor|topColor|bottomColor|priceLineColor|baseLineColor|wickColor|borderUpColor|borderDownColor|crosshairMarkerBorderColor|crosshairMarkerBackgroundColor|vertLine|horzLine)\w*\s*:\s*["'`]var\(/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** Text spans of the (balanced-paren) argument lists of canvas-bound calls. */
function canvasCallSpans(code: string): string[] {
  const spans: string[] = [];
  for (const m of code.matchAll(CANVAS_CALLS)) {
    const openIdx = m.index! + m[0].length - 1;
    let depth = 0;
    for (let i = openIdx; i < code.length; i++) {
      const ch = code[i];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) {
          spans.push(code.slice(openIdx + 1, i));
          break;
        }
      }
    }
  }
  return spans;
}

describe("canvas var( guard (iv3)", () => {
  const files = walk(SRC).filter((p) => {
    const rel = relative(SRC, p).split(sep).join("/");
    if (rel.startsWith("components/charts/")) return true;
    return readFileSync(p, "utf8").includes('from "lightweight-charts"');
  });

  it("scans a plausible chart surface (guard sanity)", () => {
    expect(files.length).toBeGreaterThanOrEqual(12);
  });

  it("A: no var( string literal inside canvas-bound call arguments", () => {
    const offenders: string[] = [];
    for (const p of files) {
      const code = stripComments(readFileSync(p, "utf8"));
      for (const span of canvasCallSpans(code)) {
        const hits = span.match(/["'`]var\(--[\w-]+\)/g);
        if (hits) {
          offenders.push(
            `${relative(SRC, p).split(sep).join("/")}: ${[...new Set(hits)].join(", ")}`,
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("B: canvas-only option keys are never assigned var( literals", () => {
    const offenders: string[] = [];
    for (const p of files) {
      const code = stripComments(readFileSync(p, "utf8"));
      const hits = code.match(CANVAS_ONLY_KEYS);
      if (hits) {
        offenders.push(
          `${relative(SRC, p).split(sep).join("/")}: ${[...new Set(hits)].join(", ")}`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });
});
