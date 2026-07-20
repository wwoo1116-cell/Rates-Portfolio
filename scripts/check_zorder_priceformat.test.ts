/**
 * iv4 guard — z-order formatter capture (the FOURTH individual in the
 * lightweight-charts defect family: three canvas-`var()` colors, the
 * index-vs-calendar axis, and now this).
 *
 * Mechanism (proven in s18 T6 from the LWC 5.2 source,
 * `PriceScale._updateFormatter`: "choose source with the lowest zorder"): a
 * price scale formats its ticks AND every badge on it using the formatter of
 * the LOWEST-z-order series attached to it. Any series pushed behind the
 * lines via `setSeriesOrder(...)` therefore dictates the whole scale's
 * format — if it carries no `priceFormat`, the scale silently reverts to raw
 * default floats no matter what the visible line series declare. This was
 * the real cause of the s15 return-panel raw floats (not a missing shared
 * default).
 *
 * Rule enforced: in any src file that calls `setSeriesOrder`, EVERY series
 * creation (`addSeries` / `addCustomSeries`) must carry an explicit
 * `priceFormat`. Deliberately conservative — adding a priceFormat to a
 * series that didn't strictly need one is always safe; omitting one on a
 * reordered series breaks the scale.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

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

/** Every argument block of `addSeries(`/`addCustomSeries(` in the file,
 * captured by brace balance from the first `{` after the call. */
function seriesCreationBlocks(code: string): string[] {
  const out: string[] = [];
  const re = /\.add(?:Custom)?Series\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const start = code.indexOf("{", m.index);
    if (start === -1) continue;
    let depth = 0;
    for (let i = start; i < code.length; i++) {
      if (code[i] === "{") depth++;
      else if (code[i] === "}") {
        depth--;
        if (depth === 0) {
          out.push(code.slice(start, i + 1));
          break;
        }
      }
    }
  }
  return out;
}

describe("z-order formatter-capture guard (iv4, LWC defect family #4)", () => {
  const files = walk(SRC);
  const reordering = files.filter((p) => stripComments(readFileSync(p, "utf8")).includes("setSeriesOrder"));

  it("scans a plausible surface (guard sanity)", () => {
    // HARDEN-1: rate-fan-chart.tsx (the original reordering host) left with
    // the quantile-fan removal, so ZERO reordering files is now a legitimate
    // state — the guard stays armed for any future setSeriesOrder user. The
    // sanity floor moves to the walker itself.
    expect(files.length).toBeGreaterThanOrEqual(50);
  });

  it("every series created in a setSeriesOrder-using file carries a priceFormat", () => {
    const offenders: string[] = [];
    for (const p of reordering) {
      const code = stripComments(readFileSync(p, "utf8"));
      const blocks = seriesCreationBlocks(code);
      expect(blocks.length, `${relative(SRC, p)}: expected series creations`).toBeGreaterThan(0);
      for (const b of blocks) {
        if (!/priceFormat\s*:/.test(b)) {
          offenders.push(`${relative(SRC, p).split(sep).join("/")}: ${b.slice(0, 80)}…`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
