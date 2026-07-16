/**
 * s20 T1 guard — the deterministic full-domain fit must survive BOTH s19 R2a
 * sub-mechanisms at the live-measured geometry (4,040-bar IRS history,
 * ~640px workspace pane). Each test drives ensureFullDomainFit through the
 * exact event sequence a real mount produces (fit-harness.ts mirrors the
 * library's time-scale semantics, including the shipped BASE_CHART_OPTIONS
 * minBarSpacing floor), so this suite fails if either sub-mechanism
 * regresses:
 *  - the cache-hit mount race (fit issued while the pane is unsized, or
 *    dropped by the mount commit) → covered by the unsized-pane and
 *    dropped-fit paths;
 *  - the minBarSpacing ceiling (0.5px default caps the fit at
 *    paneWidth/0.5 bars) → every path asserts FULL-domain coverage at
 *    640px, impossible unless the shared floor stays ≤ 640/4040.
 */
import { describe, expect, it } from "vitest";
import { ensureFullDomainFit, rangeCoversDomain } from "./full-domain-fit";
import { FitHarness } from "./fit-harness";

const PANE_PX = 640; // s19 live-measured Results-grid pane width
const BARS = 4040; // full IRS 10Y−3Y daily history

const expectFullDomain = (h: FitHarness) => {
  const range = h.visibleRange();
  expect(range).not.toBeNull();
  expect(range!.from).toBeLessThanOrEqual(0.5);
  expect(range!.to).toBeGreaterThanOrEqual(BARS - 1.5);
  expect(rangeCoversDomain(range, BARS)).toBe(true);
};

describe("ensureFullDomainFit — 4,040 bars in a 640px pane (s19 geometry)", () => {
  it("cache-hit mount: data + fit land before layout sizes the pane (R2a race)", () => {
    const h = new FitHarness({ width: 0 });
    h.setData(BARS);
    ensureFullDomainFit(h.chart, BARS); // panel arms it right after setData
    h.flush(); // fit applies against a 0-width pane — the no-op s19 observed
    expect(h.visibleRange()).toBeNull(); // nothing rendered yet — pre-layout
    h.layout(PANE_PX); // ResizeObserver applies the real width
    h.flush();
    expectFullDomain(h);
  });

  it("cache-hit mount: the mount commit drops the queued fit (R2a merge)", () => {
    const h = new FitHarness({ width: PANE_PX });
    h.dropNextFit(); // the fit issued in the mount commit never applies
    h.setData(BARS); // …but the data's own tail-window render still happens
    ensureFullDomainFit(h.chart, BARS);
    h.flush();
    expectFullDomain(h);
  });

  it("cold mount: pane sized first, data arrives late", () => {
    const h = new FitHarness({ width: PANE_PX });
    h.flush();
    h.setData(BARS); // query resolves after mount
    ensureFullDomainFit(h.chart, BARS);
    h.flush();
    expectFullDomain(h);
  });

  it("terminates on an unfittable pane and converges once the pane can fit", () => {
    // 150px < 4,040 × 0.05px: no fit can cover the domain — the engine must
    // stop retrying (bounded fitContent calls), then converge after a resize.
    const h = new FitHarness({ width: 150 });
    h.setData(BARS);
    ensureFullDomainFit(h.chart, BARS);
    h.flush();
    expect(rangeCoversDomain(h.visibleRange(), BARS)).toBe(false);
    expect(h.fitCalls).toBeLessThanOrEqual(5); // no refit loop
    h.layout(PANE_PX);
    h.flush();
    expectFullDomain(h);
  });

  it("stays out of the way after convergence (user zoom is not fought)", () => {
    const h = new FitHarness({ width: PANE_PX });
    h.setData(BARS);
    ensureFullDomainFit(h.chart, BARS);
    h.flush();
    expectFullDomain(h);
    const settledCalls = h.fitCalls;
    // Post-convergence size/range activity must trigger no further fits.
    h.layout(PANE_PX / 2);
    h.flush();
    expect(h.fitCalls).toBe(settledCalls);
  });

  it("converges on a synced two-chart stage via the group applier (s20 sync finding)", () => {
    // The Results grid livelock: the lockstep mirrors each chart's range to
    // its sibling, so a lone-chart fit is overwritten by the sibling's stale
    // tail. Reproduce the wiring of use-synced-time-scales and drive both
    // engines through the group applier — both charts must converge.
    const a = new FitHarness({ width: PANE_PX });
    const b = new FitHarness({ width: PANE_PX });
    let applying = false;
    a.subscribeVisibleLogicalRangeChange((r) => {
      if (r && !applying) b.setVisibleLogicalRange({ from: r.from, to: r.to });
    });
    b.subscribeVisibleLogicalRangeChange((r) => {
      if (r && !applying) a.setVisibleLogicalRange({ from: r.from, to: r.to });
    });
    const group = (range: { from: number; to: number }) => {
      applying = true;
      a.setVisibleLogicalRange(range);
      b.setVisibleLogicalRange(range);
      applying = false;
    };
    a.setData(BARS);
    b.setData(BARS); // each data render emits a stale tail that mirrors across
    ensureFullDomainFit(a.chart, BARS, group);
    ensureFullDomainFit(b.chart, BARS, group);
    a.flush();
    b.flush();
    a.flush(); // drain cross-queued mirror applications both ways
    b.flush();
    expectFullDomain(a);
    expectFullDomain(b);
  });

  it("dispose detaches the engine before convergence", () => {
    const h = new FitHarness({ width: 0 });
    h.setData(BARS);
    const dispose = ensureFullDomainFit(h.chart, BARS);
    h.flush();
    dispose();
    const calls = h.fitCalls;
    h.layout(PANE_PX);
    h.flush();
    expect(h.fitCalls).toBe(calls); // no fits after dispose
    expect(rangeCoversDomain(h.visibleRange(), BARS)).toBe(false);
  });
});
