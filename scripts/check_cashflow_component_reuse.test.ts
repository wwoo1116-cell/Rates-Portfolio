/**
 * RECON-DAILY T4a reuse guard: the swap-cashflow reconciliation must render
 * its settlement window through the Portfolio Management tab's CashflowTable
 * — a FORK of that table (a second cashflow-table implementation anywhere in
 * src/) fails here by name. Source-level, like the other gates in scripts/:
 * runtime tests can't see a copy-paste that never imports the original.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "src");
const CANONICAL = join("features", "portfolio", "details-panel.tsx");
const CONSUMER = join("features", "home", "swap-cashflow-recon.tsx");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe("CashflowTable reuse guard (RECON-DAILY T4a)", () => {
  const files = walk(SRC);

  it("exactly one CashflowTable definition exists, in the Portfolio details panel", () => {
    const defining = files.filter((f) =>
      /(function|const)\s+CashflowTable\b/.test(readFileSync(f, "utf8")),
    );
    expect(defining.map((f) => f.slice(SRC.length + 1))).toEqual([CANONICAL]);
  });

  it("the swap-cashflow recon imports it from the details panel (no fork, no copy)", () => {
    const source = readFileSync(join(SRC, CONSUMER), "utf8");
    expect(source).toMatch(
      /import\s*\{[^}]*\bCashflowTable\b[^}]*\}\s*from\s*"@\/features\/portfolio\/details-panel"/,
    );
    // And it renders the imported table rather than any local <table> of its
    // own for the cashflow lines.
    expect(source).toContain("<CashflowTable");
    expect(source).not.toContain("<table");
  });
});
