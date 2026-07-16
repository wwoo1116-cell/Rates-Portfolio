/**
 * S12 semantic-color lockdown guard. Owner decision: Jade/Berry is the
 * universal signed/directional pair, and the hue family is LOCKED to that
 * semantic exclusively; the old green/red sem tokens are retired.
 *
 * Enforced here, on comment-stripped sources:
 *  1. Jade/Berry FAMILY VALUES (all six MS hexes + the rgb-triplet forms the
 *     deprecated soft aliases use) may exist only in the semantic modules.
 *  2. RAW-LAYER TOKEN references (--ms-jade*, --ms-berry*) likewise — code
 *     consumes the semantic interface (--chart-pnl-*, --chart-heat-*,
 *     PNL_COLORS, HEAT_*), never the raw family.
 *  3. RETIRED green/red sem names (sem-positive / sem-negative, as CSS vars
 *     or Tailwind classes) must not reappear ANYWHERE. The s12 deprecated
 *     aliases were deleted at integration v3 once the simulation slice (the
 *     last consumer) was migrated to the semantic tokens.
 *  4. Tailwind's stock green/red palette classes are banned outright.
 *  5. The Blueprint greens/reds: #0F9960 is gone entirely; #DB3737 exists
 *     only as tokens.css's --sem-danger (error semantic — never directional).
 *
 * ALLOWLIST (deliberately tiny — the two homes of color truth):
 *  - src/lib/chart-colors.ts  (semantic module / canvas mirrors)
 *  - src/app/tokens.css       (token layer)
 *  Test files (*.test.*) are exempt so gates can name the values they check.
 *
 * SCOPE: src/** + tailwind.config.ts — REPO-WIDE since integration v3 (the
 * s12 simulation-directory exclusion is gone; the slice was migrated and the
 * deprecated sem aliases deleted).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

const SEMANTIC_HOMES = new Set(["src/lib/chart-colors.ts", "src/app/tokens.css"]);
/** Integration v3: the aliases are deleted — the retired names may appear NOWHERE. */
const RETIRED_NAME_HOMES = new Set<string>();

/** Jade: #3EB661/#65C581/#B2E2C0 — Berry: #D3086F/#DC398C/#ED9CC5. */
const FAMILY_HEX = /#(3EB661|65C581|B2E2C0|D3086F|DC398C|ED9CC5)\b/gi;
/** rgb-triplet forms of Jade-80 / Berry-80 (used by the soft aliases). */
const FAMILY_RGB = /rgba?\(\s*(?:101\s*,\s*197\s*,\s*129|220\s*,\s*57\s*,\s*140)/g;
const RAW_LAYER_TOKENS = /--ms-(?:jade|berry)[\w-]*/g;
const RETIRED_NAMES = /\bsem-(?:positive|negative)(?:-soft)?\b|--sem-(?:positive|negative)(?:-soft)?/g;
const TAILWIND_GREEN_RED =
  /\b(?:bg|text|border|ring|outline|fill|stroke|from|via|to|decoration|divide|accent|caret|shadow)-(?:green|red|emerald|rose|lime)-\d{2,3}\b/g;
const BLUEPRINT_GREEN = /#0F9960\b/gi;
const BLUEPRINT_RED = /#DB3737\b/gi;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|css)$/.test(name)) out.push(p);
  }
  return out;
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

interface ScannedFile {
  rel: string; // repo-relative, forward slashes
  code: string; // comment-stripped
}

function scannedFiles(): ScannedFile[] {
  const files = [...walk(SRC), join(ROOT, "tailwind.config.ts")];
  const out: ScannedFile[] = [];
  for (const p of files) {
    const rel = relative(ROOT, p).split(sep).join("/");
    if (/\.test\.(ts|tsx)$/.test(rel)) continue;
    out.push({ rel, code: stripComments(readFileSync(p, "utf8")) });
  }
  return out;
}

function offendersOf(
  files: ScannedFile[],
  pattern: RegExp,
  allowed: ReadonlySet<string>,
): string[] {
  const offenders: string[] = [];
  for (const f of files) {
    if (allowed.has(f.rel)) continue;
    const hits = f.code.match(pattern);
    if (hits) offenders.push(`${f.rel}: ${[...new Set(hits)].join(", ")}`);
  }
  return offenders;
}

describe("semantic color lockdown (S12)", () => {
  const files = scannedFiles();

  it("scans a plausible surface (guard sanity) — INCLUDING the simulation slice", () => {
    expect(files.length).toBeGreaterThanOrEqual(100);
    expect(files.some((f) => f.rel === "tailwind.config.ts")).toBe(true);
    expect(files.some((f) => f.rel.includes("features/simulation"))).toBe(true);
  });

  it("Jade/Berry family values exist only in the semantic modules", () => {
    expect(offendersOf(files, FAMILY_HEX, SEMANTIC_HOMES)).toEqual([]);
    expect(offendersOf(files, FAMILY_RGB, SEMANTIC_HOMES)).toEqual([]);
  });

  it("raw-layer --ms-jade/--ms-berry tokens are referenced only in the semantic modules", () => {
    expect(offendersOf(files, RAW_LAYER_TOKENS, SEMANTIC_HOMES)).toEqual([]);
  });

  it("retired sem-positive/sem-negative names do not reappear anywhere (aliases deleted, iv3)", () => {
    expect(offendersOf(files, RETIRED_NAMES, RETIRED_NAME_HOMES)).toEqual([]);
  });

  it("Tailwind stock green/red palette classes are banned everywhere", () => {
    expect(offendersOf(files, TAILWIND_GREEN_RED, new Set())).toEqual([]);
  });

  it("Blueprint green #0F9960 is gone; #DB3737 survives only as tokens.css's --sem-danger", () => {
    expect(offendersOf(files, BLUEPRINT_GREEN, new Set())).toEqual([]);
    expect(offendersOf(files, BLUEPRINT_RED, new Set(["src/app/tokens.css"]))).toEqual([]);
    // The danger token really is the surviving red (definition drift check).
    const tokens = readFileSync(join(SRC, "app", "tokens.css"), "utf8");
    expect(tokens).toMatch(/--sem-danger:\s*#DB3737/);
  });

  it("the deprecated aliases are fully deleted from the token layer (iv3 retirement)", () => {
    const tokens = stripComments(readFileSync(join(SRC, "app", "tokens.css"), "utf8"));
    expect(tokens).not.toMatch(/--sem-positive/);
    expect(tokens).not.toMatch(/--sem-negative/);
  });
});
