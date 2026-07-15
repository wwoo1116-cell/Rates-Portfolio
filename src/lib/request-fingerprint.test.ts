import { describe, expect, it } from "vitest";

import { requestFingerprint } from "./request-fingerprint";

// The fingerprint replaces the request object in analytics query keys, so its
// contract is cache correctness: identical content must collapse to one key
// (else spurious refetches), and ANY content change must produce a new key
// (else stale data served silently — the failure mode that matters).

const mkRequest = () => ({
  valuation_date: "2026-07-06",
  cd_rate: 0.0292,
  on_rate: 0.02438,
  swap_quotes: [
    { tenor_years: 1, rate: 0.029 },
    { tenor_years: 5, rate: 0.031 },
  ],
  positions: Array.from({ length: 50 }, (_, i) => ({
    instrument_type: i % 2 ? "bond" : "irs",
    position_id: `P-${i}`,
    notional: 10_000_000_000,
    fixed_rate: 0.0305,
    pvbp: 1_432_100 + i,
  })),
});

describe("requestFingerprint", () => {
  it("is stable across object identity (same content, fresh objects)", () => {
    expect(requestFingerprint(mkRequest())).toBe(requestFingerprint(mkRequest()));
  });

  it("is insensitive to object key order, matching hashKey's semantics", () => {
    const a = { x: 1, y: { p: 2, q: 3 } };
    const b = { y: { q: 3, p: 2 }, x: 1 };
    expect(requestFingerprint(a)).toBe(requestFingerprint(b));
  });

  it("changes when a single position field changes", () => {
    const base = mkRequest();
    const edited = mkRequest();
    edited.positions[37].pvbp += 1;
    expect(requestFingerprint(edited)).not.toBe(requestFingerprint(base));
  });

  it("changes when a quote changes", () => {
    const base = mkRequest();
    const edited = mkRequest();
    edited.swap_quotes[1].rate = 0.0311;
    expect(requestFingerprint(edited)).not.toBe(requestFingerprint(base));
  });

  it("changes when a top-level scalar (funding spread) is added", () => {
    const base = mkRequest();
    expect(requestFingerprint({ ...base, funding_spread_bp: 10 })).not.toBe(
      requestFingerprint(base),
    );
  });

  it("distinguishes null from absent from zero", () => {
    const a = requestFingerprint({ v: null });
    const b = requestFingerprint({});
    const c = requestFingerprint({ v: 0 });
    expect(new Set([a, b, c]).size).toBe(3);
  });
});
