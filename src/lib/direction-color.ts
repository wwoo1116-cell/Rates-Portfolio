import type { BadgeTone } from "@/components/ui/badge";

/**
 * THE direction→color rule (owner ruling, integration v3): Pay = Berry,
 * everything else (Rec / Buy / Sell) = Jade — identical on every surface.
 *
 * s12 preserved each surface's legacy green/red sign exactly, which kept a
 * pre-existing contradiction alive (Positions grid: Pay=Berry; details DIR
 * badge: Pay=Jade). This module is the single source both consume now;
 * direction-color.test.ts pins the values AND that both surfaces import it,
 * so they cannot diverge again.
 */
export function directionPnlTone(direction: string): Extract<BadgeTone, "pnl-positive" | "pnl-negative"> {
  return direction === "Pay" ? "pnl-negative" : "pnl-positive";
}

/** CSS-var form for inline styles / AG Grid cellStyle. */
export function directionPnlColor(direction: string): string {
  return direction === "Pay" ? "var(--chart-pnl-neg)" : "var(--chart-pnl-pos)";
}
