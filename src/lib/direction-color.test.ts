import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { directionPnlColor, directionPnlTone } from "./direction-color";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("direction color rule (owner ruling, integration v3)", () => {
  it("Pay = Berry, Rec/Buy/Sell = Jade", () => {
    expect(directionPnlTone("Pay")).toBe("pnl-negative");
    expect(directionPnlColor("Pay")).toBe("var(--chart-pnl-neg)");
    for (const d of ["Rec", "Buy", "Sell"]) {
      expect(directionPnlTone(d), d).toBe("pnl-positive");
      expect(directionPnlColor(d), d).toBe("var(--chart-pnl-pos)");
    }
  });

  it("the grid Dir column and the details DIR badge both consume this module (divergence pin)", () => {
    // The s12-era contradiction (grid Pay=Berry vs badge Pay=Jade) came from
    // each surface hand-rolling the rule. If either stops importing the
    // shared helper, this fails before a reviewer has to notice hues.
    for (const rel of [
      "features/portfolio/positions-grid.tsx",
      "features/portfolio/details-panel.tsx",
    ]) {
      const code = readFileSync(join(SRC, rel), "utf8");
      expect(code, rel).toMatch(/from "@\/lib\/direction-color"/);
      expect(code, rel).toMatch(/directionPnl(Tone|Color)/);
    }
  });
});
