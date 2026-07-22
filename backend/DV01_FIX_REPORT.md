# DV01_FIX_REPORT — reval DV01 everywhere the stale blotter feeds (Phases A+B, BE-only)

2026-07-21. Branch `dv01/fix` @ (this report's commit) on top of e022ccc, worktree
`wt-dv01-be`. Owner ruling executed: option A + FRN carve-out + as-of detection +
simulate-side (Phase B) on the SAME derivation. No build, no push, no server contact
(TestClient/module calls only); Data/ read-only; `quant_engine.py` untouched; FE
untouched (@ acb395f, clean — verified). Landing deferred to the joint pass with FB4.

Step 0: dual-dispatch guard PASS (head e022ccc, no pre-existing `dv01/fix`, zero
uncommitted changes, stray sweep clean both repos).

## Phase A — commit aa35d48 (Home/recon)

`services/bond_risk.py` is the single derivation point (Phase B consumes it too):
fixed-coupon schedulable → ±0.5bp central bump-reval at the request valuation date,
FRESH remaining-maturity bucketing; **FRN carve-out**; sheet fallback for
non-revaluable rows; per-row `dv01_sources`, 합계-row `blotter_as_of` + `frn_positions`
(all additive — FE dead-man switch unaffected, verified against its numeric-total
logic).

**FRN enumeration (6 rows, source=`sheet_frn`, sheet values kept verbatim):**
중소기업은행(변) 2603이1A-06 · -09 · -19 · -19 · -23 · -23 (two 19/23 lots each).

**[CHANGED, DV01-A] real-data ledger** (scripts/dv01_fix_ledger.py):

| Sector | old → new @07-14 | Δ% | sources (07-14) |
|---|---|---|---|
| 국고채 | 29,278,030 → 26,915,272 | −8.1% | reval 9 |
| 통안채 | 1,007,324 → 701,957 | −30.3% | reval 1 |
| 공사채 | 50,605,321 → 34,220,931 | −32.4% | reval 47 · fallback 6 |
| 특은채 | 74,952,365 → 48,623,842 | −35.1% | reval 57 · fallback 15 · FRN 6 |
| 시은채 | 82,747,088 → 55,171,982 | −33.3% | reval 56 · fallback 1 |
| 여전채 | 25,650,817 → 14,613,525 | −43.0% | reval 36 · fallback 9 |
| 회사채 | 15,275,636 → 9,324,797 | −39.0% | reval 18 · fallback 12 |
| **BOND TOTAL** | **279,516,580 → 189,572,305 (×0.678)** | | |

07-16 variant: total → 188,274,825 (×0.674); same shape. Swap/IRS rows byte-identical
(never touch this data). The pre-existing SUITE fixtures did not move — they carry no
static params (= the sheet_fallback path), now pinned explicitly as such.

**as-of detection**: `blotter_as_of = 2026-03-23` detected from the uniform 잔존일수
fingerprint on the live workbook; on a fresh export the same computation yields
≈ today (pinned: stale rows → 2026-03-23, fresh rows → the valuation date, empty →
None). **Refresh-independence pinned**: reval outputs read only the static schedule +
curve — changing every sheet column changes nothing on the reval path.

**Acceptance (like-for-like with the diagnosis):** recon bond 잔차 07-14→07-15 with
the NEW service M1 = **−71.8M** (was −242.3M; diagnosis target −72.9M — the ~1M gap is
FRN/fallback rows riding at sheet values inside the service M1, exactly as designed).
**New Home footer ladder at D−1=07-14 (service-level derivation):** Assumed(bond leg)
+459.4M → **+288.9M**; with the unchanged swap leg the panel's Assumed and 잔차 move
by the same −170.5M — the bond-side residual now sits at the ledger-② basis grain.
(Exact on-screen ladder to be captured at the landing pass's smoke; theta and funding
chips are untouched by this fix.)

## Phase B — commit 582ed8a (simulate)

`enrichment.enrich_bond_dv01` (the enrich_irs_pvbp idiom, hooked in the orchestrator
right after it): every simulate bond's wire pvbp is replaced by `bond_risk` reval at
the run's base date — bump base = the position's own 민평수익율 (the wire carries no
rating), maturity-anchored synthetic schedule (no 발행일자 on the wire; pinned ≤2% vs
the true-issue anchor). FRN/non-revaluable keep the wire figure; swaps pass through
untouched. `remainingDays` deliberately NOT rewritten — see follow-ups.

**[CHANGED, DV01-B] blast radius (all enumerated, derivations in the commit + test
comments):**
- Golden: `simulate_golden_dv01_response.json` replaces the source capture as the
  pinned golden (source file retained in-repo as the historical record).
  Representative fixture: finalMTM −254,095,011 → **−255,182,266** (+0.43% only — its
  wire pvbp was internally consistent, so re-derivation moves it by the
  schedule/yield-base refinement; this VALIDATES the derivation), finalTotal
  −191,006,631 → −192,093,885; finalCarry/finalSwap **byte-identical**. Extras-set
  pin tightened to `set()`.
- HARDEN-1 fan fixture: bondMtm −75,833,596.487 → **−50,977,444.638** (×0.672 — this
  fixture's pvbp IS stale-blotter-style; the real correction class), total moves by
  exactly the bondMtm delta (+24,856,151.849); bondCarry / fundingCost / swapMtm /
  swapCarry **byte-identical**.
- s21 cache fixtures: **unmoved** (bond enrichment never reaches the curve bootstrap).

**Invariant re-verification (properties on the new values — all HELD, no STOP):**

| Invariant | Result |
|---|---|
| zero-shock ⇒ bond MtM exactly 0 | holds (battery zero-shock pins green) |
| σ half-width linearity | holds (s13/s18 pins green) |
| decomposition components sum to total (±₩1) | holds (harden1 sum test green) |
| s21 cache byte-identity cached-vs-uncached | holds (test_curve_cache 14/14) |
| cache key completeness | unchanged by construction (no curve-path change) |
| only the bond leg moves | proven: carry/swap/funding byte-identical in both re-pinned fixtures |

**Simulate delta, representative full-book scenarios:** the two shipped full-book
fixtures bracket the field behavior — an internally-consistent book moves +0.43%
(refinement only); a stale-blotter book corrects ×0.672 on the bond MtM path with
swap legs byte-identical. The live book is the second class (Phase A ledger ×0.678).

## Gates

| Phase | pytest | battery | notes |
|---|---|---|---|
| A (aa35d48) | 350+4 → **360+4** (+10: 7 bond_risk unit + 3 service pins) | 43/43 | zero pre-existing pins moved |
| B (582ed8a) | **360+4** (0 new; 2 re-pins `[CHANGED, DV01-B]`) | 43/43 | golden regenerated; s21 14/14 |

quant_engine.py untouched (no STOP condition met) · trees clean · NO push · no server
contact · FE untouched proof: `krw-fi-pms` @ acb395f, `git status` clean, zero writes.

## FE follow-ups (recorded, NOT edited — FB4 is live on the FE)

1. **as-of notice display**: surface `blotter_as_of` (합계 row) on the PVBP panel /
   recon caption when it lags the valuation date materially ("블로터 기준
   2026-03-23") — the field is already on the wire.
2. `dv01_sources` / `frn_positions` display (mixed-basis disclosure chip).
3. Recon evidence refresh: the FB3 ladder screenshots pre-date this fix; the landing
   smoke should re-capture the Home/RH footer (expected: bond-side Assumed
   +459.4M → +288.9M at 07-14).

## Follow-ups (BE) + ops restatement

- `remainingDays` on the simulate wire is still the stale column (+113d): the pvbp
  AGING anchor in `calculate_daily_mtm` decays against a too-long base and rolls off
  late. Sensitivity is now correct at t=0; the aging-slope correction is a separate
  enumerated change (goldens move again) — deliberately not smuggled into this lane.
- **Ops (restated, unchanged by this fix): the blotter export is four months stale —
  refresh it upstream regardless.** After this fix a refreshed export must NOT change
  reval-DV01 outputs — pinned (`test_refresh_independence_reval_ignores_sheet_columns`);
  it WILL change the FRN/fallback rows and the detected `blotter_as_of` (by design).
- Ledger ② (credit-Δy Assumed variant, −72.9M remainder) is now unblocked and
  correctly sequenced AFTER this lane.

Worktree left in place for the joint landing pass (with FB4).
