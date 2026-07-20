# REPORT s18 — Simulation Rate Constant, Fan Semantics, and Perf Measurement

Branches (stacked on the s15 heads, **not merged**): BE `s18/sim-rate-and-perf` (off `s15/sim-engine` @ f65454b), FE `s18/sim-dual-axis` (off `s15/sim-flow` @ a63ec88). Evidence in `docs/s18/`; live captures against the s18 stack on :3100/:8100 (owner's :3000/:8000 untouched; the orphaned s15 dev server found still holding :3100 was verified as ours and killed — S6 double-execution rule).

| Task | Verdict in one line |
| --- | --- |
| T1 | 2.75%+10bp landed; live carry delta **−25.0bp exactly** — check passed |
| T2 | The two observations shared **neither base date nor book**; fixed-book/date residual **0.000bp**; "purely" claim corrected in REPORT_s15 |
| T3 | Dual-axis live: rate bands never cross, return lines cross honestly; crossing count unchanged (see table) |
| T4 | baseDate now Asia/Seoul; both clock fakes pass; swap book stays priced pre-09:00 |
| T5 | "273 s" was a misreading — 273 is the bond count; measured full-book numbers + bootstrap call counts below |
| T6 | s15's attribution was **wrong**; real mechanism found in LWC source (z-order picks the scale formatter), proven live in 3 steps |

---

## T1 — Policy base rate 2.50% → 2.75% [BLOCKER] — **check passed**

`POLICY_BASE_RATE_KRW = 0.0275` (BOK MPC hike, effective 2026-07-16 — first hike since 2023-01, ending the 14-month hold), derived `FUNDING_RATE_KRW = 0.0285`. The definition site now states the provenance rule: **manually maintained constant, not derived from the repo's BOK series** — `Data/BOK Base Rate.xlsx` lags the decision (its latest row on decision day was still 2026-07-08 @ 2.50%) and must never be treated as this constant's source. No MPC stepping (horizon-fixed constant remains the spec). Drift guard: `test_funding_constants_spec` pins both the constant (0.0275) and the derived rate (0.0285); the strip/carry analytics tests were re-pinned to 2.85%.

**Falsifiable check (required):** same seed book (24 bonds + 6 swaps), same base date 2026-07-16, s15 baseline vs s18:

| | s15 (`docs/s18/s15-baseline-results.png`) | s18 (`docs/s18/s18-results-final.png`) |
|---|---|---|
| Funding | 2.60% | **2.85%** |
| 운용 | 3.42% | 3.42% (unchanged) |
| Carry | +82.1bp | **+57.1bp** |

Carry delta = **−25.0bp exactly** (±0.0). Funding is consumed nowhere it shouldn't be. (Total Return −6.1억 → −9.8억: 조달 비용 −39.6 → −43.4억 scales exactly by 2.85/2.60; 채권 캐리(총) +36.2 → +36.4억 is the maturity-reinvestment leg, which accrues at the funding rate by design — documented in s15 T2, not a leak.)

## T2 — The 15.9bp "residual": observation mismatch, residual 0 at fixed conditions

**Q1 — do the two observations share a base date?** **No — and they don't share a book either.** The −93.8bp @ 운용 3.26% screenshot is the owner's own session on the owner's full uploaded ledger (pre-s15, when the bridge still derived baseDate in UTC, so even its date is uncertain ±1 day). The +82.1bp @ 운용 3.42% figure is s15's capture on the 24-bond seed subset at 2026-07-16. 운용 is an evaluation-weighted book property; comparing it across two books measures the books, not funding.

**Q2 — same-base-date A/B (live, seed book, baseDate 2026-07-16, run against :8100):**

| Run | Funding | 운용 (positionRate) | Carry |
|---|---|---|---|
| A — explicit `fundingRate: 0.042` (legacy payload) | 4.20% | 3.4213% | **−77.9bp** |
| B — field omitted (constant) | 2.85% | 3.4213% (byte-identical, every strip row) | **+57.1bp** |

Carry delta +135.00bp == funding delta × 1e4 == +135.00bp → **residual −0.000bp**. Note run A independently reproduces s15's *before* capture (−77.9bp), so the s15 before/after pair was itself a clean same-book 160.0bp funding-only move.

**Verdict on the claim:** REPORT_s15's "the −93.8bp carry was *purely* an artifact of the fake 4.20%" was **unverified as stated** — it compared across different books and dates. Corrected in place (REPORT_s15.md §T1, marked `[CORRECTED, s18 T2]`). The mechanical statement that survives verification: at any fixed book + base date, funding explains the carry move exactly.

**Regression pin:** `tests/test_simulate_s18.py::test_carry_ab_only_funding_moves` — 운용 byte-identical across A/B on every row, carry delta == funding delta (±0.1bp), MTM identical, carry accrual difference analytic.

## T3 — Dual-axis separation (이중축 분리)

**BE:** `distribution.ratePaths` (additive; router model extended) — each quantile scenario's 국채 3Y cumulative-bp path on the same day axis as `bands`. Not new math: it is the 3Y section of the exact shock the engine consumes (`interpolate_curve_shift(3.0, 국채커브) × multiplier` in matrix mode; `baseShockBp × multiplier` in parallel), collected inside `build_chart_data`'s existing loop for the base run and each percentile run. p50 == the base run's own path. Rates are monotone in the quantile by construction → these bands cannot cross (`test_rate_bands_never_cross`, σ 2.0/7.5; terminal offsets == z·σ_t pinned).

**FE:** the fan is split (`docs/s18/s18-results-final.png`):
- **금리 경로 분위수 (top, RateFanChart)** — filled quantile bands + P50 line, **P5..P95 labels retained** (truthful here), bp-formatted axis/badge (`+30.0bp`).
- **시나리오별 Total Return (below)** — **no fill, no band**: the center line (기본 시나리오, byte-equal to the 금리 P50 run — invariant pinned at σ 2.0/5.0/7.5) plus four thin scenario lines in distinct hues, labeled only through `fan-labels.ts` (`금리 P95 시나리오`, readout short form `금리P95`). Crossings render as crossing lines — visible live (readout: 금리P95 −12.8억 · 금리P75 −11.1억 · 금리P25 −8.1억 · **금리P5 −10.3억** — P5 below P25, on screen, unsorted).
- **Bare-rank ban:** `fan-labels.test.ts` pins the label functions AND source-scans the return panel component for bare `"P##"` literals (comments stripped; the rate panel's legal ranks come only via `rateBandLabel()`).

**No per-day sorting anywhere; no rank semantics on returns.** Fixture pins all three required properties in one response (`test_fixture_rate_bands_ordered_while_return_lines_cross`): (a) rate bands ordered every day, (b) return crossings survive, (c) center identity byte-equal.

**Live-book crossing recount (presentation-change proof):** **76 / 121 — unchanged** (same full-book request as s15's count, from the T5 instrumented run; rate-band ordering violations: 0). The full-book `finalMTM` (−1,791,744,928) and `finalSwap` (−671,985,789) are byte-identical to s15's capture — the dual-axis work moved no math.

**Old cached responses:** `distribution` without `ratePaths` renders scenario LINES without the rate panel — rank-labeled return bands are never resurrected; no-`distribution` responses keep the S5/S7 fallback.

## T4 — baseDate in Asia/Seoul

`position-bridge.ts` gains `todayInSeoul()` (Intl, `Asia/Seoul`, en-CA → ISO date) and `buildSimulationInputs` uses it; `toISOString()` (UTC) is gone. Clock-fake pins (`position-bridge.test.ts`):

| Faked instant | = KST | Old (UTC) result | New result |
|---|---|---|---|
| 2026-07-15T23:30:00Z | 07-16 **08:30** (pre-09:00) | 2026-07-15 ✗ | **2026-07-16** ✓ |
| 2026-07-16T00:30:00Z | 07-16 09:30 | 2026-07-16 | **2026-07-16** ✓ |
| 2026-07-19T23:30:00Z | **Mon** 07-20 08:30 | Sun 07-19 → NonBusinessDay → 스왑 제외 | **2026-07-20** ✓ |

Swap inclusion in the pre-09:00 case: the FE tests pin the resolved date; `test_seoul_resolved_base_date_keeps_swaps_included` (BE) pins that with same-day quotes at that resolved date the swap book prices — `exclusions == []`, `finalSwap != 0`. The Monday-morning case is the one that silently blanked the book before (Sunday → NonBusinessDayError → policy-compliant 스왑 제외).

**Date-authority finding (required by the task):** the repo's only Seoul *business-day* authority is backend-side (`engine/fixings.py` + quant_engine's KR calendar); the FE had **no Seoul date derivation at all** (the top bar's KST clock is display-only and component-local). `todayInSeoul()` is deliberately **timezone conversion only** — no business-day snapping, no holiday calendar port (a weekend run still resolves to the weekend date and gets the honest exclusion). So there are now two *timezone* conversions (FE Intl, BE calendar) but still exactly one *business-day* authority. If the FE ever needs business-day arithmetic, it must resolve via the backend — building a second holiday calendar client-side is the thing to refuse.

## T5 — Full-book measurement (measurement only — nothing optimized)

**The "273 s ~24 minutes" inconsistency resolved:** REPORT_s15 never claimed 273 seconds — it reported "**273 bonds** + 413 swaps" (book composition) and "~24 minutes" (measured 1427.4s on 2026-07-16). "273 s" was a misreading of the bond count. The s18 instrumented re-run confirms the ~24-minute scale.

Instrumentation: `IRS_PRICER_SIM_PROFILE=1` (env-gated, zero cost when off) wraps the engine entry points at the *module attribute* level — `quant_engine.py` stays byte-identical, and internal calls resolve through the wrapper so call counts are true. Phases are wall-clock (`_phase`); function rows are cumulative and nested (they overlap phases). Single-request tool; noted in code. Measurement conditions: shared workstation also running two dev servers — call counts exact, wall times carry ambient noise.

**Run:** full live book, 686 positions (273 bonds + 413 swaps), simDays 180 (121 business days), 5 scenarios (base + 4 percentile runs), base date 2026-07-15 (frozen-market fixture request). HTTP 200; `finalMTM`/`finalSwap` byte-identical to s15's un-instrumented run.

**Total wall: 1409.7s (23.5 min)** — vs s15's 1427.4s un-instrumented: instrumentation cost ≈ noise.

| Phase (wall) | Seconds | Share |
|---|---:|---:|
| swap-market-resolve (snapshot + fixings) | 0.05 | ~0% |
| swap-static-pricing (enrich: pvbp/KRD/theta) | 9.0 | 0.6% |
| base run (bond+swap pricing + daily KRD recon) | 278.5 | 19.8% |
| scenario expansion (4 percentile runs, recon skipped) | 1122.1 | 79.6% |
| assembly (pvbpSensitivity + bookDailyPnLs) | 0.00 | ~0% |

| Function (cumulative, nested — overlaps phases) | Calls | Seconds |
|---|---:|---:|
| `qe.bootstrap_zero_curve` | **658,505** | **1,312.9** |
| `qe.simulate_irs_path_fm` (contains most bootstraps) | 2,065 | 1,393.5 |
| `qe.build_bumped_curves` (recon, base run only) | 120 | 3.5 |
| `qe.compute_irs_krd_map` | 413 | 6.1 |
| `qe.portfolio_krd_day` | 120 | 0.9 |
| `svc.calculate_daily_mtm` (all bond MTM, 5 runs) | 600 | 0.9 |
| `svc.calculate_daily_carry` | 600 | 0.6 |

**The specific answer:** the curve bootstrap runs **per business day × per scenario × per INSTRUMENT**. 2,065 FM calls = 413 swaps × 5 scenarios; 658,505 bootstraps ≈ 319 per FM call (≈ the per-day revaluation curves inside `simulate_irs_path_fm`). On any given (scenario, day) the shocked par curve is **identical for all 413 swaps** — the engine rebuilds it 413 times over. Curve bootstrapping is ~93% of total wall time; bond pricing is 1.5s in total.

**Recommendation (not implemented):** this is a **caching problem, not a batching problem** — the same conclusion the Home dashboard reached in July (178× `bootstrap_zero_curve` redundancy → `curve_cache` wrapper). A per-(scenario, day) zero-curve cache shared across instruments would collapse ~658k bootstraps to ≈ 5 × ~360 ≈ 1.8k (−99.7%), putting the full book at roughly the cost of today's bond work plus ~1.8k bootstraps — order of a minute, not 24. Batching instruments per curve would be a larger refactor for the same win; parallelism attacks the symptom. Constraint for whoever implements: `quant_engine.py` is byte-frozen, so the cache must wrap at the glue/module-attribute layer (the profiler in this pass demonstrates the interception pattern), and the FM path's internal curve variants (theta's fixed-curve trajectory) must key into the cache correctly — sizing that is the follow-up scope.

## T6 — Chart-host inheritance: the verdict

**Was s15's attribution ("raw-float badge = s14's shared default arriving at integration") correct? No.** Two independent errors:

1. **Nothing arrives passively.** s14's `series-defaults.ts` (read from their unmerged branch, commit 6b3d091 — absent from this baseline as expected) is **opt-in per def**: `valueKind: "krw"` resolves the signed 억/만 formatter, `primary: true` + the badge-collision policy governs badges, and **an explicit `formatter` key wins over the valueKind default** — so the `formatter: formatKrwAxis` s15 was passing would have *suppressed* the signed formatter at integration, not received it.
2. **The raw floats never came from a missing default anyway.** Root cause, from the lightweight-charts 5.2 source (`PriceScale._updateFormatter`: *"choose source with the lowest zorder"*): the price scale formats ticks **and every badge on it** using the formatter of the **lowest-z-order series on the scale**. s15's `FanBandSeries` was pushed behind the lines via `setSeriesOrder(-1)` **without a priceFormat**, making it the scale's formatter source — so the scale rendered raw no matter what the line defs declared. Proven live in three steps on the s18 rate fan: band-first raw (`s18-results-A-…png`), formatted-line-first **still raw** (`s18-results-B-…png` — killing the creation-order and `minMove` hypotheses), `priceFormat` added to the band series → formatted `+30.0bp` badge and `+80.0bp/+40.0bp/…` ticks (`s18-results-final.png`). The funding strip always formatted correctly because it is the only series on its pane's scale.

**Actions taken (files absent → no vendoring, remove local overrides, precise TODO):**
- Removed the slice-local vertical grid from `lw-line-chart.tsx` (feedback ① now visibly fixed on the curve preview — `s18-configure.png`); the new `rate-fan-chart.tsx` never draws one. The SeriesChart-hosted return chart never drew a local grid; its vertical gridlines disappear when s14's `BASE_CHART_OPTIONS` lands.
- Removed the local `formatter: formatKrwAxis` from every Simulation series def (fan mode and fallback view). Interim cost, stated plainly: the return panel's axis/badge/tooltip show raw floats in this lane until integration (visible in `s18-results-final.png`). DOM readouts (chips, ReturnReadout, TR card) keep the mainline signed 억/만 util — feedback ④ concerns chart axes/badges; blanking DOM text would be pure regression.
- **Integration TODO (verbatim, also in the panel header comment):**
  > INTEGRATION TODO (s14 6b3d091 → `src/features/simulation/components/panels/distribution-chart-panel.tsx`, helper `line()` in the `series` useMemo): add `valueKind: "krw"` to every def the helper returns, and `primary: true` on the center ("base") def — series-defaults.ts then resolves the SIGNED 억/만 formatter (feedback ④) and the badge collision policy keeps exactly the primary badge. Do NOT re-add a `formatter:` key: an explicit formatter overrides the valueKind default and would suppress the signed variant.
  > INTEGRATION RULE (root cause of the s15 raw floats): LWC formats a price scale from its LOWEST-Z-ORDER series — any series pushed below the lines via `setSeriesOrder` MUST carry the same `priceFormat` as the lines (see `rate-fan-chart.tsx`), or the scale reverts to raw regardless of valueKind wiring.

## Ambiguities resolved without asking (each is a finding)

1. **"Rate path" definition (T3):** chosen as the 국채 3Y section of the engine's own consumed shock (matrix: KTB-curve 3Y interp × multiplier; parallel: baseShockBp × multiplier), collected inside the existing engine loop — not a new formula. Other tenors would tell a different (also true) story; 3Y is the scenario's anchor tenor everywhere else in the UI.
2. **Return lines are panel-added series, not SeriesChart defs (T3):** keeps s15's single-center-badge acceptance (no per-def badge knob exists in this baseline) at the cost of scenario lines not appearing in the shared crosshair tooltip/pills — their values read via the header ReturnReadout. At integration, s14's badge-collision policy would allow promoting them to defs; left as a follow-up choice for the integrator.
3. **Two stacked chart hosts instead of one 3-pane chart (T3):** SeriesChart defs can't target panes, and re-paning its series from outside would fight the shared layer. Consequence: rate/return crosshairs are not synchronized and right-scale widths can differ by a few px between the panels.
4. **No business-day snapping in `todayInSeoul()` (T4):** timezone conversion only, per the one-authority rule above; weekend runs keep the honest exclusion behavior.
5. **Helper placement (T4):** in `position-bridge.ts` (Simulation-owned) rather than shared `src/lib` — s14/s16/s17 own non-Simulation surfaces.
6. **"The two observations" (T2):** interpreted as owner screenshot vs s15 capture; determined they differ by book as well as date, which is itself the answer.
7. **KRW-formatter removal scope (T6):** chart series defs only; DOM readouts keep `formatKrwAxisSigned`.
8. **FE flow-test fixture values updated 0.026→0.0285 (T1):** synthetic response fixture aligned to the new constant so evidence stays coherent; it tests rendering, not the constant (the constant is pinned BE-side).
9. **T5 wall-times measured on a shared machine** (dev servers up): call counts exact; phase ratios representative; absolute seconds ±noise.

## Gates

- **BE:** pytest **326 passed + 4 xfailed** (s15 baseline 320+4, +6 s18 tests; the T1 re-pins modified existing tests in place) — golden source parity byte-exact (explicit-funding path untouched), NPV identity guard and all landed anchors green.
- **FE:** `tsc --noEmit` clean; vitest **165 passed** (s15 158, +4 T4 clock fakes, +3 label-policy); `next build` clean; eslint **21 errors exactly** (the baseline) / 26 warnings.
- Live verification: `docs/s18/` before/after set (s15 baseline vs s18 final, plus the three-step T6 proof sequence and the Configure gridline evidence).

## Out of scope (untouched, per the brief)

Merging; MPC stepping; any batching/caching/parallelism (T5 recommendation only); non-Simulation directories; Entry Signals backtest.
