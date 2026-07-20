import { describe, expect, it, vi } from "vitest";
import {
  MATURITY_BUCKET_COLORS,
  MATURITY_RAMP,
  PNL_COLORS,
  SECTOR_COLORS,
  SECTOR_ORDER,
  SIM_SERIES_COLORS,
  maturityColor,
  sectorColor,
} from "./chart-colors";

const HEX = /^#[0-9A-Fa-f]{6}$/;

describe("SECTOR_COLORS", () => {
  it("resolves all 7 backend sector keys to hex colors", () => {
    const keys = ["국고채", "통안채", "공사채", "특은채", "시은채", "여전채", "회사채"] as const;
    for (const k of keys) {
      expect(SECTOR_COLORS[k], k).toMatch(HEX);
      expect(sectorColor(k)).toBe(SECTOR_COLORS[k]);
    }
  });

  it("assigns every sector a distinct color (adjacency depends on it)", () => {
    const values = Object.values(SECTOR_COLORS);
    expect(new Set(values).size).toBe(values.length);
  });

  it("SECTOR_ORDER covers exactly the mapped keys, credit-descending", () => {
    expect(SECTOR_ORDER).toEqual(["국고채", "통안채", "공사채", "특은채", "시은채", "여전채", "회사채"]);
    expect([...SECTOR_ORDER].sort()).toEqual(Object.keys(SECTOR_COLORS).sort());
  });

  it("falls back loudly (dev warn + neutral) on an unknown key — never by index", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const c = sectorColor("존재하지않는섹터");
      expect(c).toBe("#5C7080"); // neutral --fg-dim, not any sector hue
      expect(Object.values(SECTOR_COLORS)).not.toContain(c);
      expect(warn).toHaveBeenCalledTimes(1);
      // warn-once: a second lookup of the same key must not spam per render
      sectorColor("존재하지않는섹터");
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("MATURITY_RAMP", () => {
  it("maps the 3 backend bucket labels onto the single-hue ramp", () => {
    expect(maturityColor("단기(1년 미만)")).toBe(MATURITY_RAMP.short);
    expect(maturityColor("중기(1~3년)")).toBe(MATURITY_RAMP.mid);
    expect(maturityColor("장기(3년 이상)")).toBe(MATURITY_RAMP.long);
    expect(Object.keys(MATURITY_BUCKET_COLORS)).toHaveLength(3);
  });

  it("falls back to neutral on an unknown bucket", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(maturityColor("초장기(30년)")).toBe("#5C7080");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("PNL_COLORS / SIM_SERIES_COLORS completeness", () => {
  it("PNL pair carries pos/neg + fill variants", () => {
    expect(Object.keys(PNL_COLORS).sort()).toEqual(["neg", "negFill", "pos", "posFill"]);
    for (const v of Object.values(PNL_COLORS)) expect(v).toMatch(HEX);
  });

  it("simulation series map is complete for the Total-Return + component-curve series", () => {
    // HARDEN-1: `funding` (조달비용, Navy-40) joins for the Results
    // component-curves hero — the five component lines are funding/mtm/carry/
    // swapValuation/swapTheta; `total` remains for the legacy five-series view.
    expect(Object.keys(SIM_SERIES_COLORS).sort()).toEqual(
      ["carry", "funding", "mtm", "swapTheta", "swapValuation", "total"],
    );
    for (const v of Object.values(SIM_SERIES_COLORS)) expect(v).toMatch(HEX);
    // distinct hues — the composite hierarchy fails if two series merge
    const values = Object.values(SIM_SERIES_COLORS);
    expect(new Set(values).size).toBe(values.length);
  });
});
