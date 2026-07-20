/**
 * WCAG 2.x contrast-ratio primitives — pure math, zero Node/DOM dependencies,
 * safe to import from both client components (runtime label-color choices)
 * and scripts/ (the build-time gate scripts). Extracted from
 * scripts/check_chart_contrast.ts (R3B-PLUS B2) so the two homes can't drift:
 * scripts/ and components both depend on this; this depends on neither.
 */

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
