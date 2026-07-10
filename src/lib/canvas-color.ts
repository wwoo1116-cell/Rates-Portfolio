/**
 * Canvas 2D's fillStyle/strokeStyle do not resolve CSS custom properties --
 * assigning ctx.fillStyle = "var(--accent)" is silently invalid and the
 * context keeps its previous color (default black). Anything drawn on a
 * <canvas> that should track a design token must read the token's computed
 * value first.
 */
export function resolveCssVar(name: string, fallback = "#000000"): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}
