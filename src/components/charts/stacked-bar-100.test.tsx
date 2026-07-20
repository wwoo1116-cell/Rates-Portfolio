// @vitest-environment jsdom
/**
 * R3B-PLUS B2 mechanism pins for StackedBar100's in-segment percentage
 * labels: format, the omission threshold, and per-fill label color — each
 * asserted directly against the rendered DOM so a revert (or a threshold/
 * color-resolution regression) fails these, not just a downstream snapshot.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MIN_LABEL_SEGMENT_PCT, StackedBar100, type StackedBar100Column } from "./stacked-bar-100";
import { LABEL_ON_FILL_DARK, LABEL_ON_FILL_LIGHT, resolveSegmentLabelColor } from "@/lib/chart-colors";

afterEach(cleanup);

const DARK_FILL = "#202B33"; // resolves to LIGHT label text
const LIGHT_FILL = "#F5F8FA"; // resolves to DARK label text

function columns(values: Record<string, number>): StackedBar100Column[] {
  return [{ key: "c1", label: "Col 1", values }];
}

/** jsdom normalizes inline style.color to rgb(...), never the source hex. */
function toRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

describe("StackedBar100 in-segment labels (B2)", () => {
  it("labels a segment at/above the threshold with the same one-decimal-plus-% format as the tooltip", () => {
    render(
      <StackedBar100
        columns={columns({ a: MIN_LABEL_SEGMENT_PCT, b: 100 - MIN_LABEL_SEGMENT_PCT })}
        seriesKeys={["a", "b"]}
        colorFor={() => DARK_FILL}
      />,
    );
    expect(screen.getByText(`${MIN_LABEL_SEGMENT_PCT.toFixed(1)}%`)).toBeDefined();
  });

  it("omits the label just below the threshold (tooltip is the fallback, not asserted here)", () => {
    const below = MIN_LABEL_SEGMENT_PCT - 0.1;
    render(
      <StackedBar100
        columns={columns({ a: below, b: 100 - below })}
        seriesKeys={["a", "b"]}
        colorFor={() => DARK_FILL}
      />,
    );
    expect(screen.queryByText(`${below.toFixed(1)}%`)).toBeNull();
  });

  it("a custom formatValue is honored in the in-segment label too (no separate hardcoded format)", () => {
    render(
      <StackedBar100
        columns={columns({ a: 50, b: 50 })}
        seriesKeys={["a", "b"]}
        colorFor={() => DARK_FILL}
        formatValue={(pct) => `${pct}pct`}
      />,
    );
    expect(screen.getAllByText("50pct")).toHaveLength(2);
  });

  it("does not force-fudge segment labels to sum to 100.0 -- each renders its own independently-rounded value", () => {
    // 33.33 + 33.33 + 33.34 all round to "33.3%" at one decimal, summing the
    // DISPLAYED digits to 99.9, not 100.0 -- that's expected, not corrected
    // (no cross-segment adjustment logic exists to make it hit 100.0).
    render(
      <StackedBar100
        columns={columns({ a: 33.33, b: 33.33, c: 33.34 })}
        seriesKeys={["a", "b", "c"]}
        colorFor={() => DARK_FILL}
      />,
    );
    expect(screen.getAllByText("33.3%")).toHaveLength(3);
  });

  it("picks the higher-contrast label color per the segment's resolved fill", () => {
    const { container: darkFillContainer } = render(
      <StackedBar100 columns={columns({ a: 50 })} seriesKeys={["a"]} colorFor={() => DARK_FILL} />,
    );
    const darkLabel = darkFillContainer.querySelector("span.tabular-nums") as HTMLElement;
    expect(darkLabel.style.color).toBe(toRgb(resolveSegmentLabelColor(DARK_FILL)));
    expect(resolveSegmentLabelColor(DARK_FILL)).toBe(LABEL_ON_FILL_LIGHT);
    cleanup();

    const { container: lightFillContainer } = render(
      <StackedBar100 columns={columns({ a: 50 })} seriesKeys={["a"]} colorFor={() => LIGHT_FILL} />,
    );
    const lightLabel = lightFillContainer.querySelector("span.tabular-nums") as HTMLElement;
    expect(lightLabel.style.color).toBe(toRgb(resolveSegmentLabelColor(LIGHT_FILL)));
    expect(resolveSegmentLabelColor(LIGHT_FILL)).toBe(LABEL_ON_FILL_DARK);
  });

  it("an empty column renders no segment labels", () => {
    render(
      <StackedBar100
        columns={[{ key: "c1", label: "Col 1", values: {}, empty: true }]}
        seriesKeys={["a"]}
        colorFor={() => DARK_FILL}
      />,
    );
    expect(screen.getByText("No data")).toBeDefined();
    expect(screen.queryByText(/%$/)).toBeNull();
  });
});
