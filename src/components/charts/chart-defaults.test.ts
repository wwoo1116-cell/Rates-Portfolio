// @vitest-environment jsdom
/**
 * Pins the s14 shared chart defaults so a future refactor can't silently
 * regress them:
 *  1. Vertical gridlines OFF in BASE_CHART_OPTIONS (every lightweight-charts
 *     host inherits; horizontal guides untouched).
 *  2. valueKind → default formatter resolution: KRW series get the signed
 *     억/만 formatter (no raw floats / sub-만원 digits), rate/bp keep their
 *     pre-s14 formats, and an explicit `formatter` always wins.
 *  3. Badge collision policy: past the limit only `primary` series keep a
 *     last-value badge; the per-series override wins in both directions.
 *
 * jsdom (not node) only because BASE_CHART_OPTIONS lives beside the
 * lightweight-charts import in lw-chart-base.
 */
import { describe, expect, it } from "vitest";
import { BASE_CHART_OPTIONS } from "./lw-chart-base";
import {
  DEFAULT_BADGE_LIMIT,
  badgeVisible,
  resolveSeriesFormatter,
} from "./series-defaults";

describe("BASE_CHART_OPTIONS grid defaults (s14 T1 pin)", () => {
  it("vertical gridlines resolve OFF by default", () => {
    expect(BASE_CHART_OPTIONS.grid?.vertLines?.visible).toBe(false);
  });

  it("horizontal gridlines stay enabled (visible not overridden to false)", () => {
    expect(BASE_CHART_OPTIONS.grid?.horzLines?.visible).not.toBe(false);
    expect(BASE_CHART_OPTIONS.grid?.horzLines?.color).toBe("rgba(255,255,255,0.07)");
  });
});

describe("resolveSeriesFormatter (s14 T2)", () => {
  it("krw kind defaults to the signed 억/만 formatter", () => {
    const fmt = resolveSeriesFormatter({ valueKind: "krw" })!;
    expect(fmt(320_000_000)).toBe("+3.2억");
    expect(fmt(-4_500_000)).toBe("-450만");
    expect(fmt(0)).toBe("0");
  });

  it("krw default never emits raw decimals or sub-만원 digits", () => {
    const fmt = resolveSeriesFormatter({ valueKind: "krw" })!;
    for (const v of [12_345_678.91, -987_654_321.09, 4_567.89, 123_456_789_012.34]) {
      expect(fmt(v)).not.toMatch(/\d+\.\d{2}/);
    }
    expect(fmt(12_345_678.91)).toBe("+1,235만"); // sub-만원 digits dropped
  });

  it("rate kind keeps the 4dp percent format", () => {
    expect(resolveSeriesFormatter({ valueKind: "rate" })!(0.0239)).toBe("2.3900%");
  });

  it("bp kind keeps the 2dp format", () => {
    expect(resolveSeriesFormatter({ valueKind: "bp" })!(12.345)).toBe("12.35");
  });

  it("an explicit formatter overrides the kind default", () => {
    const custom = (v: number) => `custom:${v}`;
    expect(resolveSeriesFormatter({ valueKind: "krw", formatter: custom })!(5)).toBe("custom:5");
  });

  it("no kind and no formatter resolves to undefined (host/library fallback)", () => {
    expect(resolveSeriesFormatter({})).toBeUndefined();
  });
});

describe("badgeVisible collision policy (s14 T3)", () => {
  it("shows every badge at or under the limit", () => {
    expect(badgeVisible({}, DEFAULT_BADGE_LIMIT)).toBe(true);
    expect(badgeVisible({}, 1)).toBe(true);
  });

  it("above the limit only primary series keep badges", () => {
    expect(badgeVisible({}, DEFAULT_BADGE_LIMIT + 1)).toBe(false);
    expect(badgeVisible({ primary: true }, DEFAULT_BADGE_LIMIT + 1)).toBe(true);
  });

  it("explicit lastValueBadge wins in both directions", () => {
    expect(badgeVisible({ lastValueBadge: false }, 1)).toBe(false);
    expect(badgeVisible({ lastValueBadge: true }, 10)).toBe(true);
    expect(badgeVisible({ lastValueBadge: false, primary: true }, 10)).toBe(false);
  });

  it("a custom limit overrides the default", () => {
    expect(badgeVisible({}, 5, Infinity)).toBe(true);
    expect(badgeVisible({}, 2, 1)).toBe(false);
  });
});
