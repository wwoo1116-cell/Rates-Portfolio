/**
 * RECON2-RH reuse guard: the M2 Δbp time series must be a VIEW over the SAME
 * M2 machinery — the deltaBp map the range loop already computed and
 * retained on ReconRangeRow. A forked recomputation (a new deltaBpByTenor
 * call site, or the chart fetching/deriving its own rates) fails here by
 * name. Source-level, like check_cashflow_component_reuse: runtime tests
 * can't see a copy-paste that never imports the original.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "src");

/** The frozen deltaBpByTenor call-site set: the definition, the single-date
 * hook, and the range loop (whose result is RETAINED on the row). Anything
 * else referencing the function is a fork. */
const ALLOWED_CALL_SITES = [
  join("lib", "daily-recon-math.ts"),
  join("hooks", "use-daily-recon.ts"),
  join("hooks", "use-recon-range.ts"),
];

const CHART = join("features", "home", "recon-deltabp-chart.tsx");
const STRIP = join("features", "home", "recon-range-strip.tsx");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe("Δbp reuse guard (RECON2-RH)", () => {
  const files = walk(SRC);

  it("deltaBpByTenor is referenced ONLY at the frozen call sites", () => {
    const referencing = files
      .filter((f) => /\bdeltaBpByTenor\b/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(SRC.length + 1))
      .sort();
    expect(referencing).toEqual([...ALLOWED_CALL_SITES].sort());
  });

  it("the Δbp chart consumes the RETAINED row map and computes/fetches nothing", () => {
    const source = readFileSync(join(SRC, CHART), "utf8");
    // Reads the retained map…
    expect(source).toMatch(/\.deltaBp\b/);
    // …and has no computation/fetch path of its own: no recon math import,
    // no API client, no snapshot access, no bp conversion arithmetic.
    expect(source).not.toMatch(/daily-recon-math/);
    expect(source).not.toMatch(/api-client|marketDataApi|portfolioAnalyticsApi/);
    expect(source).not.toMatch(/pillarRates|swap_quotes|cd_rate|on_rate/);
    expect(source).not.toMatch(/10[_ ]?000/);
  });

  it("the strip passes rows through without touching the math either", () => {
    const source = readFileSync(join(SRC, STRIP), "utf8");
    expect(source).not.toMatch(/\bdeltaBpByTenor\b/);
    expect(source).not.toMatch(/api-client|marketDataApi/);
  });
});
