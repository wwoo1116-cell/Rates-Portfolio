/**
 * S7 chart-contrast gate: computes the WCAG 2.x contrast ratio of every
 * `--chart-*` token in src/app/tokens.css against `--bg-surface` and fails
 * anything below 3.0:1 — the graphics floor (WCAG 1.4.11 non-text contrast)
 * for lines, markers, and small chart elements on the dark surface.
 *
 * LARGE-FILL-ONLY ALLOWLIST: tokens sanctioned to sit below the gate because
 * they only ever render as large fills whose effective background is the
 * NEIGHBORING SLICES, not the surface (stacked-bar segments with 1px
 * separator strokes; see DESIGN.md §2 "Known caveat — Navy-80"). Allowlisted
 * tokens are REPORTED with their real ratio but not failed. Anything added
 * here needs the same DESIGN.md treatment: a documented caveat + mitigations.
 *
 * Enforced in the test suite via scripts/check_chart_contrast.test.ts; also
 * runnable standalone (`pnpm check:contrast`) for the report table.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const CONTRAST_FLOOR = 3.0;

export const LARGE_FILL_ONLY_ALLOWLIST: readonly string[] = [
  // Navy-80 (특은채): ~1.9:1 vs --bg-surface. Stacked-bar slices only —
  // never lines, markers, or text (DESIGN.md §2 caveat, mitigations a–c).
  "--chart-sector-specbank",
];

export interface ContrastRow {
  token: string;
  resolvedHex: string;
  ratio: number;
  allowlisted: boolean;
  pass: boolean;
}

/** All custom properties declared in the css text, unresolved. */
export function parseCustomProps(css: string): Map<string, string> {
  const props = new Map<string, string>();
  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    props.set(m[1], m[2].trim());
  }
  return props;
}

/** Follow var(--x) indirection to a concrete value. */
export function resolveProp(props: Map<string, string>, name: string, depth = 0): string {
  if (depth > 10) throw new Error(`var() chain too deep resolving ${name}`);
  const raw = props.get(name);
  if (raw == null) throw new Error(`unknown custom property ${name}`);
  const m = /^var\((--[\w-]+)\)$/.exec(raw);
  return m ? resolveProp(props, m[1], depth + 1) : raw;
}

function srgbChannel(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) throw new Error(`expected #RRGGBB, got "${hex}"`);
  const n = parseInt(m[1], 16);
  return (
    0.2126 * srgbChannel((n >> 16) & 0xff) +
    0.7152 * srgbChannel((n >> 8) & 0xff) +
    0.0722 * srgbChannel(n & 0xff)
  );
}

export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function runContrastGate(cssPath: string): { rows: ContrastRow[]; failures: ContrastRow[] } {
  const props = parseCustomProps(readFileSync(cssPath, "utf8"));
  const surface = resolveProp(props, "--bg-surface");

  const rows: ContrastRow[] = [];
  for (const name of props.keys()) {
    if (!name.startsWith("--chart-")) continue;
    const resolvedHex = resolveProp(props, name);
    const ratio = contrastRatio(resolvedHex, surface);
    const allowlisted = LARGE_FILL_ONLY_ALLOWLIST.includes(name);
    rows.push({
      token: name,
      resolvedHex,
      ratio,
      allowlisted,
      pass: allowlisted || ratio >= CONTRAST_FLOOR,
    });
  }
  rows.sort((a, b) => a.ratio - b.ratio);
  return { rows, failures: rows.filter((r) => !r.pass) };
}

export function defaultTokensCssPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "src", "app", "tokens.css");
}

export function formatReport(rows: ContrastRow[]): string {
  const lines = ["token | hex | ratio vs --bg-surface | status"];
  for (const r of rows) {
    const status = r.allowlisted
      ? `ALLOWLISTED (large-fill-only, ${r.ratio.toFixed(2)} < ${CONTRAST_FLOOR})`
      : r.pass
        ? "pass"
        : `FAIL (< ${CONTRAST_FLOOR})`;
    lines.push(`${r.token} | ${r.resolvedHex} | ${r.ratio.toFixed(2)}:1 | ${status}`);
  }
  return lines.join("\n");
}

// Standalone entry point (node --experimental-strip-types or tsx).
const invokedDirectly =
  typeof process !== "undefined" &&
  process.argv[1] != null &&
  import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href;
if (invokedDirectly) {
  const { rows, failures } = runContrastGate(defaultTokensCssPath());
  console.log(formatReport(rows));
  if (failures.length > 0) {
    console.error(`\n${failures.length} chart token(s) below ${CONTRAST_FLOOR}:1 and not allowlisted.`);
    process.exit(1);
  }
}
