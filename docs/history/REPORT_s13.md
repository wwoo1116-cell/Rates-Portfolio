# REPORT s13 — Dirty+Cash Basis for Historical Series & Configurable σ

Mini-pass stacked on s11 for a serial merge: BE `s13/dirty-basis` off `d88a931` (worktree `wt-s13-be`), FE `s13/sigma-input` off `eeb94bf` (worktree `wt-s13-fe`). Single-writer check: the s10→s12 lane was quiescent in its own worktrees (`wt-s10-fe`, `wt-s12-fe`); nothing outside the Simulation slice / owned BE services was touched. **No FE changes were needed for T1** — response shapes are unchanged, values only.

## Commits

| Branch | Commit | Content |
|---|---|---|
| BE `s13/dirty-basis` | `58e5a72` | T1 — historical PnL/trace series on dirty+cash; `settled_cash_between`; guards + matrix |
| BE `s13/dirty-basis` | `008ab2f` | T2 BE — `sigma_bp` request field (0<σ≤25, default 2.0) + invariants |
| FE `s13/sigma-input` | `af47eca` | T2 FE — σ stepper/typed field in scenario config, payload wiring |
| FE `s13/sigma-input` | (this commit) | REPORT_s13.md + σ live evidence |

## Gates

- **BE:** pytest **309 passed + 4 xfailed** (baseline 297+4; +5 basis guards, +1 sharpened cache assertion, +6 σ tests). Anchors green: 62,578,082.19 unit guard, Run C / 7Y trace regressions (the ad-hoc trace was already dirty+cash — endpoints byte-unchanged), Home daily +67,998-era decomposition tests.
- **FE:** tsc clean · vitest **127/127** · `next build` clean · eslint **21 errors = pre-existing baseline** (s13-changed files lint clean).
- **Live:** σ=2 vs σ=4 click-path on the stacked worktrees, 0 console errors (`docs/s13/`).

---

## Task 1 — historical PnL / trace series → dirty+cash

### What changed (values, not shapes)

| Surface | Before (clean basis) | After |
|---|---|---|
| `compute_npv_trace` (ad-hoc, PnL Trace panel) | already dirty+cash | **unchanged** — conformance now pinned by guard tests |
| `compute_npv_trace_for_trade` (DB cache-aside) | `daily = Δclean`, `cum = clean − entry_clean` | `daily = Δdirty + settled_cash`, `cum = Σ daily`, `entry_npv` = first dirty (matching ad-hoc) |
| `compute_historical_pnl` (+`_for_trades`) | `cumulative = net_npv − baseline_net` | running `Σ [Δdirty + settled_cash]`, re-zeroed at baseline; `net_npv`/`payer`/`receiver` keep their clean-LEVEL meaning |
| persisted `npv_pnl_trace` daily/cumulative columns | clean-based | dirty+cash (no mixed-basis rows) |
| `spread_backtest_service` | — | **not applicable**: par-spread engine, no NPV path (verified; also UI-orphaned). Untouched, numbers unchanged. |

Mechanism: new `engine/mtm_valuation.settled_cash_between(swap, fixings, start, end]` — settled flows resolved from the schedule + fixing store alone (a flow paying by `end` has its reset strictly earlier, so F(R) has always passed; no curve build), which keeps the DB fast path curve-free. Both historical variants share `_fill_cumulative_dirty_cash`, and its cash term deliberately sums over **all** positions, not the active set — a swap maturing mid-window pays its final settlement even though it has left the active set (the old series cliffed by exactly that final NPV at maturity).

### 5M/6M/9M/1Y/7Y matrix — old vs new endpoints (`scripts/s13_basis_matrix_out.txt`)

Window 2026-04-23 → 2026-07-15 (60 dates), fixtures seasoned so a quarterly settlement falls inside the window. Identical rows for the trace and historical services (bases unified):

| fixture | old cum (cleanΔ) | new cum (dirty+cash) | Δ = new−old | = Δaccrued | + settled cash | residual |
|---|---|---|---|---|---|---|
| 5M | 999,305.84 | 6,728,072.96 | 5,728,767.12 | −1,076,712.33 | 6,805,479.45 | 0.0000 |
| 6M | 1,263,265.20 | 6,992,032.32 | 5,728,767.12 | −1,076,712.33 | 6,805,479.45 | 0.0000 |
| 9M | 519,954.96 | 6,248,722.08 | 5,728,767.12 | −1,076,712.33 | 6,805,479.45 | 0.0000 |
| 1Y | −2,003,022.92 | 3,227,114.06 | 5,728,767.12 | −1,076,712.33 | 6,805,479.45 | 0.0000 |
| 7Y | −222,521,346.91 | −217,291,209.92 | 5,728,767.12 | −1,076,712.33 | 6,805,479.45 | 0.0000 |

Every shift decomposes **exactly** into Δaccrued + settled cash — zero residual beyond the basis effects. (The shared Δ across tenors is expected: all fixtures share the same current-period schedule/notional/rates, so the accrued roll and the crossed settlement are identical; only the level series differ.)

### Identity guard on the historical path (`tests/test_historical_basis_guard.py`)

- per-day `daily == ΔNPV(dirty) + settled_cash` ± ₩1, on a window bracketing a payment; the crossing day's P&L is carry-sized, not coupon-sized (no sawtooth);
- cumulative endpoint == Σ daily; first point 0;
- ad-hoc and DB-cached variants produce the same series ± ₩1;
- portfolio cumulative telescopes to an independent two-endpoint revaluation + cash;
- no cliff when a swap matures mid-window (flat after maturity);
- **real data:** trace daily == Home `_swap_pnl` MtM+Theta ± ₩1 on the last 5 adjacent business-day pairs.

### Live-vs-trace reconciliation (task 1.5, real data, 7/14 → 7/15, 1Y fixture)

```
Home daily_pnl.total (theta+mtm) = 1,984,626.56   (theta 281,601.52, mtm 1,703,025.04, complete=True)
trace daily_pnl at 2026-07-15    = 1,984,626.56
|diff|                           = 0.000000
```

## Task 2 — configurable σ

- **BE (`008ab2f`):** `sigma_bp: float = Field(default=2.0, gt=0, le=25)` on `SimulateRequest`, threaded to `build_distribution_bands`; out-of-bounds → 422 naming the field. Response root-additions pin from s11 unchanged (request-side only). Invariants pinned: σ omitted == σ=2.0 **byte-identical**; `chartData` and `p50` identical across σ ∈ {1,2,4} (the z=0 run is the base run, σ-independent); band half-widths scale linearly in σ on the affine bond fixture (tolerance = the engine's per-day int rounding).
- **FE (`af47eca`):** "분포 σ (팬 차트)" row in the scenario config — the s11 stepper control generalized to min/max/step (σ: ±0.5 steps, typed values clamped to (0, 25], commits rounded to 3 decimals against float noise), store key `sigmaBp` (string, default "2.0"), `buildSimulateRequest` ships `sigma_bp` sanitized to the backend contract so no store state can produce a 422 payload. Payload-parity tests updated (default payload carries `sigma_bp: 2.0`).
- **Live (`docs/s13/`):** default run header `σ 2.0bp/일 · 만기 ±21.9bp`; four +0.5 steps → rerun → `σ 4.0bp/일 · 만기 ±43.8bp`, band badges exactly doubling around an unchanged median (P95 +147.0M / P5 −731.4M vs ±≈220M at σ=2). 0 console errors.

## Notes / observations (no action taken)

1. **UTC baseDate quirk (pre-existing, S6 bridge):** `buildSimulationInputs` derives `baseDate` from `new Date().toISOString()` — UTC, so runs before 09:00 KST use the previous calendar day. Observed as a ~4.9k KRW median difference vs the s11 evidence run (08:41 KST = UTC 07-15). Not touched (bridge is outside this pass's FE scope); flagged for the owner.
2. The Entry Signals backtest was inspected only to confirm basis applicability: it consumes par-rate history, has no NPV path, and its numbers are **unchanged** by T1. Its step-function issue remains a separate diagnosis track per scope.
3. s12's color lockdown deprecates `sem-positive/negative` in favor of Jade/Berry with aliases kept for live s11 code — the s13 σ row introduces no new color usage; the s11 funding readout's use of the aliases is an existing integration item for the s10→s12 merge.
