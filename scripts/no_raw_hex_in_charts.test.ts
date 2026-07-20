/**
 * S7 hardcoded-hex guard: chart components obtain colors from the central
 * mapping module (src/lib/chart-colors.ts) or CSS tokens — never inline hex.
 *
 * Scope: everything under src/components/charts/ plus any src file that
 * imports lightweight-charts (the chart hosts).
 *
 * Allowlist — the sanctioned homes for literal hex:
 *  - src/app/tokens.css (the token layer itself; not scanned here anyway)
 *  - src/lib/chart-colors.ts               (the mapping module / canvas mirrors)
 *  - src/features/simulation/lib/chart-theme.ts  (slice's sanctioned mirror file,
 *    same status in eslint.config.mjs rule C)
 *  - src/features/entry-signals/lib/chart-theme.ts  (same pattern, pre-existing)
 *  - src/components/charts/lw-chart-base.tsx     (the canvas base theme:
 *    background/grid/text literals that BASE_CHART_OPTIONS feeds createChart)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

const ALLOWLIST = new Set([
  "lib/chart-colors.ts",
  "features/simulation/lib/chart-theme.ts",
  "features/entry-signals/lib/chart-theme.ts",
  "components/charts/lw-chart-base.tsx",
]);

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

describe("no-raw-hex guard for chart components (S7)", () => {
  const files = walk(SRC);
  const chartFiles = files.filter((p) => {
    const rel = relative(SRC, p).split(sep).join("/");
    if (ALLOWLIST.has(rel)) return false;
    if (rel.startsWith("components/charts/")) return true;
    return readFileSync(p, "utf8").includes('from "lightweight-charts"');
  });

  it("scans a plausible chart surface set (guard sanity)", () => {
    // series-chart, stacked-bar-100, reticle, sparkline, tenor-curve,
    // portfolio-heatmap, snap-reticle + the lw hosts ≈ 14 files as of S7.
    expect(chartFiles.length).toBeGreaterThanOrEqual(10);
  });

  it("chart components contain no literal hex colors", () => {
    const offenders: string[] = [];
    for (const p of chartFiles) {
      const code = stripComments(readFileSync(p, "utf8"));
      const hits = code.match(/#[0-9a-fA-F]{3,8}\b/g);
      if (hits) offenders.push(`${relative(SRC, p)}: ${[...new Set(hits)].join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });
});
