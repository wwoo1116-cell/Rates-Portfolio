# REPORT s11 — Simulation Redesign & Valuation Engine Pass

Session: s11 (parallel to s10). Branches: BE `s11/npv-identity` off `v2` (worktree `wt-s11-be`), FE `s11/simulation-redesign` off `feat/simulation-migration` (worktree `wt-s11-fe`).

**Status: COMPLETE.** All four tasks done, gates green, live click-path verified (screenshots in `docs/s11/`). Single-writer check: Session A was active only in `wt-s10-fe` on `s10/ui-chart-visibility`; no file overlap occurred. Session-A surfaces (`SeriesChart`, `chart-colors.ts`, tokens, shell) were consumed strictly read-only — the one integration seam used is SeriesChart's public `onChartReady` prop.

## Commits

| Branch | Commit | Content |
|---|---|---|
| BE `s11/npv-identity` | `a47ee3f` | T1 — dirty-basis decomposition + `realized_cash` + guard test |
| BE `s11/npv-identity` | `d88a931` | T3+T4 BE — additive `distribution` + `fundingCurve` on /api/simulate |
| FE `s11/simulation-redesign` | `86d8584` | T2 — sliders → segmented buttons + steppers |
| FE `s11/simulation-redesign` | `eff82ac` | T3+T4 FE — percentile fan + funding strip |
| FE `s11/simulation-redesign` | (this commit) | REPORT_s11.md + evidence screenshots |

## Gates

- **BE:** `pytest` — **297 passed + 4 xfailed** (baseline at session start: 290 + 4; +3 simulate tests, +4 identity-guard tests, −0 removed). Unit-guard anchor 62,578,082.19 and the Run C / 7Y PnL-trace regressions untouched and green.
- **FE:** `tsc --noEmit` clean · `vitest` **125/125** (16 files) · `next build` clean (all 11 routes prerender) · `eslint` **21 errors = the documented pre-existing baseline** (changed files lint clean).
- **Live:** Playwright click-path against the two s11 worktrees (BE :8100, FE :3100, seeded localStorage): run executes, fan + strip render, **0 console/page errors**. Numbers cross-check on screen: median badge −292,192,925 == Results Total Return −29,219만; hover readout 운용 3.39% == eval-weighted mtmYield 3.09% + 30bp terminal shock; Carry −80.8bp == 3.39% − 4.20% funding.

---

## Task 1 (BE) — NPV = MtM + Theta identity

### 1.1 Reproduction (before any code change)

Tool: `scripts/s11_identity_diag.py` (committed), full dump `scripts/s11_identity_diag_out.txt` / `.json`.
Pair: **close = 2026-07-14 → T = 2026-07-15** (the IRS store now extends to 7/15; Credit Matrix latest = 7/14, so `has_as_of(7/15) = False` for bonds).
Book: all 273 workbook bonds (payment_frequency hydrated by the blotter-parser rule: 국고/통안 2, credit 4) + all workbook IRS + synthetic 5M/6M/9M/1Y/7Y receive-fixed matrix + one forward-start (pre-fixing) IRS.

Measured residuals, per instrument, `resid = ΔNPV + settled_cash − (mtm + theta)` on the service's own basis (clean NPV for swaps, dirty for bonds):

| group | result |
|---|---|
| every IRS (live-fixed, pre-fixing, matured, synthetic matrix, fwd-start) | **0.0000 exactly** |
| IRS with a payment inside (close, T] (`00000/KRW/260114-290115/3.0`, cash −5,983,561.64) | **0.0000 exactly** (raw `ΔNPV − (mtm+theta)` = +5,983,561.64 = −cash, i.e. the settled-cash term is required) |
| bonds, real revaluation (273/273, 0 degraded) | mtm = None (matrix has no 7/15 row); residual vs a silently-ffilled y_T equals the would-be MtM — consistent with the blank-not-zero policy |
| aggregate | reported total 11,173,016.76 = theta 285,470,303.14 + known mtm −274,297,286.38, `mtm_complete=false` — internally consistent partial sum |

### 1.2 Classification of the break (written before the fix)

The decomposition **telescopes exactly** inside `_swap_pnl`/`_bond_pnl` — three revaluations, no residual bucket — so options (a) *different curve/as-of*, and (b) *blank leaking as 0* are **ruled out by measurement** at service level. What actually breaks the owner-visible identity is a **basis inconsistency** — a variant of (c) *accrual cashflows dropped*:

1. **Swaps decompose CLEAN NPV** (`_swap_pnl` uses `PositionResult.clean_npv`), so the daily **accrued-interest roll is in neither MtM nor Theta**. Between coupon dates the reported theta carries **no accrual carry at all** (only rolldown), and on a payment date the whole period's net settlement lands in theta as one lump (the `_realized_swap_cash` correction). Daily carry attribution is therefore lumpy and understates between coupons.
2. **Bonds decompose DIRTY NPV** (`bond_valuation.value_bond().npv` is full price), so their theta **does** include the accrued roll. The aggregate "Total" mixes the two bases.
3. Consequently no NPV surface the user can read reconciles with `MtM + Theta` on all days:
   - vs **clean NPV** (`/api/portfolio/price` `clean_npv`, the Positions grid / MtM history figure): fails by the **settled cash** on every payment date;
   - vs **dirty NPV** (`/api/mtm`, PnL-Trace basis): fails by **Δaccrued every single day** for swaps;
   - the PnL-Trace panel's own daily_pnl is `Δ(dirty + cumulative cash)` — a third basis.

So the identity holds only under the service's private definition (Δclean + settled cash), which is exposed nowhere — "NPV change = MtM + Theta not correctly reflected" is exactly right from the outside.

### 1.3 Fix (engine/service layer)

Unify the decomposition on **dirty NPV + settled cash** (the PnL-Trace/total-wealth basis, and the basis bonds already use):

- `_swap_pnl` switches its three legs from `clean_npv` to `dirty_npv`. Theta gains the deterministic accrued roll (true daily carry, smooth across coupon dates); MtM gains the fixing-repricing of the current-period accrued when T's quotes arrive. The telescoping construction is unchanged, so the identity stays exact by construction — now on a basis the API actually reports.
- The identity ingredients are exposed additively: per-row and portfolio `realized_cash` (the settled cash included in theta), so `ΔNPV_dirty = total − realized_cash` is reconcilable by a consumer without private knowledge.
- Blank-MtM policy untouched: missing quotes still yield `mtm=None` (never 0), partial aggregates still flag `mtm_complete=false`.
- Existing tests that pinned the clean basis (`test_swap_total_matches_an_independent_revaluation`, coupon-crossing tests) updated to the dirty basis; engine (`mtm_valuation`, `fixings`, `quant_engine`) untouched — the 62,578,082.19 unit-guard and Run C anchors are not in the changed path.

Owner note (open decision, see §Open): `historical_pnl_service` / trade-trace cumulative PnL remain clean-basis series; aligning them to dirty+cash is a separate decision with its own display consequences.

### 1.4 Guard test

`tests/test_npv_identity_guard.py` (added): per instrument and aggregate, `|ΔNPV_dirty + settled_cash − (mtm + theta)| ≤ ₩1` for the 5M/6M/9M/1Y/7Y matrix, a coupon-crossing swap, a forward-start (pre-fixing) swap, and a schedulable bond; plus a missing-quotes case asserting the identity holds on the theta leg alone with `mtm is None` (blank ≠ 0 distinguishable in the API payload).

(verification numbers: post-fix rerun below, §1.5)

### 1.5 Post-fix verification

Commit: `a47ee3f` on `s11/npv-identity`. Rerun of the same diagnosis (`scripts/s11_identity_diag_postfix.txt`), pair 7/14 → 7/15:

- Every swap (workbook + 5M/6M/9M/1Y/7Y matrix + fwd-start): `ΔNPV(dirty) + settled_cash − (mtm + theta)` = **0.0000**, including the coupon-crossing rows (settled cash −5,983,561.64 / −12,465,753.42 / +2,493,150.68).
- The accrued roll the clean basis dropped measures **+4,312,212.80/day** on the current book (theta 285,470,303.14 → 289,782,515.94).
- Bonds: unchanged (already dirty); mtm=None per policy on this pair (matrix has no 7/15 row), aggregate flagged `mtm_complete=false`; the 43.82M aggregate gap is exactly the sum of the not-yet-known bond MtM — a partial sum by policy, not a residual.
- Suite: **294 passed + 4 xfailed** (baseline 290 + 4 new guard tests). Unit-guard 62,578,082.19, Run C regression, engine untouched.

---

## Task 2 (FE) — Scenario controls: sliders → buttons (`86d8584`)

The scenario config's "slide" controls were the two `<input type="range">` surfaces (horizon slider + per-waypoint bp sliders) — there were no binary on/off switches in the section. Replaced:

- **시뮬레이션 기간** → segmented button group `30D/60D/90D/180D/270D/365D` (all multiples of 30 so the 30-day waypoint regen stays clean; 180D = the store default). Pressed state = the accent-ghost recipe the panel's "+ 추가" button already used (`border-sem-info / bg-sem-info-ghost / text-sem-info`), `aria-pressed`, composed from the Button primitive. A store value outside the presets renders with no segment pressed and is never coerced.
- **경로 설정 waypoints** → per-row `[−5bp] [numeric field] [+5bp]` steppers (Button `icon` variant) with a typing draft (partial input like "-" or "1." doesn't corrupt the store), committed through the slice's own `toNum`, clamped to the sliders' old `±max(|baseShock|+50, 100)` range.

State semantics identical: same store keys (`simDays: number`, `waypoints {day, bp:number}`), same defaults, payload parity pinned by a test that asserts the exact `{simDays, waypoints}` the sliders would have produced. Acceptance pinned: `queryAllByRole("slider").length === 0` and zero `input[type=range]` (test + live check). 7/7 panel tests green.

## Task 3 — Distribution fan chart (`d88a931` BE / `eff82ac` FE)

**Paths did not exist**: `/api/simulate` is a deterministic scenario engine (one path per run; no stochastic mode anywhere in the ported service). Per the task's fallback clause the distribution is generated server-side, with these documented assumptions (also in code at `build_distribution_bands`):

1. Uncertainty is on the **parallel level** of the whole shock-curve family only; tenor/credit/IRS spreads stay at scenario values.
2. Terminal offset Δp = z_p · σ_daily · √(business days), σ_daily = **2.0bp/business day** (constant; ±21.9bp at a 120-business-day horizon).
3. Each band is a **real engine run** of the user's scenario plus a parallel shock ramping linearly to Δp at the horizon (matches the engine's own ramp semantics; interior points are linear interpolations of terminal uncertainty, not a √t bridge).
4. Quantile mapping is comonotonic (P&L quantile ≈ P&L of the rate-quantile path — exact for monotone books); a per-day sort enforces p5≤p25≤p50≤p75≤p95 regardless.
5. **No RNG** — identical requests give identical bands (pinned by `test_distribution_is_deterministic`).
6. z=0 run ≡ base run, so **p50 is byte-equal to the existing totalPnL trace** (pinned per-day by `test_distribution_bands`) — the median line IS the scenario the user configured.

Cost: 4 extra engine runs with `skip_recon=True` (the per-business-day KRD reconciliation loop — the dominant cost — is skipped; on the live bridge irsCurves is empty so those runs are bond-linear and cheap).

FE: the Distribution panel renders median (bold, `--chart-series-total` aggregate emphasis) + thin P5/P25/P75/P95 edge lines as ordinary SeriesChart defs — so pills, last-value badges, crosshair reticle and the tooltip (percentile readings at the hovered time) all come from the canonical component unmodified. The 5–95 / 25–75 fills are a slice-local lightweight-charts v5 custom series (`fan-band-series.ts`, translucency via `ctx.globalAlpha` — existing tokens only), added through `onChartReady` and pushed behind the lines with `setSeriesOrder(-1)`. Spaghetti layer: N/A — individual sample paths genuinely don't exist. Responses without `distribution` (older cached runs) fall back to the S5/S7 five-series view unchanged.

Contract: the response was extended, never mutated — golden parity now asserts full-depth equality over every source-emitted key **and** that the only root-level additions are exactly `{fundingCurve, distribution}`.

## Task 4 — Funding rate on the time axis (`d88a931` BE / `eff82ac` FE)

BE: additive `fundingCurve` — per chartData timestep `{day, date, fundingRate, positionRate, carryBp}`. `fundingRate` is `calc_dynamic_funding_rate` (the engine's own funding assumption, fundingEvents steps included); `positionRate` is the evaluation-weighted `mtmYield + path-shock` over live bonds — the same definition `calculate_daily_carry` prices, so the displayed carry can never disagree with the engine's carry; `carryBp = (position − funding)·1e4`; both null (not 0) when no live bonds remain. Consistency pinned by `test_funding_curve`.

FE: the fan chart gains a slim second pane sharing the time axis — a step line of the funding rate with its last-value badge, so the figure is visible **without hovering**; the panel header carries a persistent readout (`현재/D+n · Funding · 운용 · Carry ±bp`) that follows the crosshair (hovered step) and falls back to the latest step when idle. Carry colored by sign; null renders as em-dash.

## Live evidence (`docs/s11/`)

- `s11_before_run.png` — T2 control surface (segmented horizon, steppers, no sliders).
- `s11_after_run.png` — fan + bands + funding strip + idle readout after a real run.
- `s11_fan_tooltip.png` — crosshair tooltip reading all five percentiles at 2026-12-08 (D+146) with the hovered-time carry readout (−110.8bp).

## Open owner decisions

1. **T1 basis unification.** book-daily-pnl now decomposes dirty NPV + settled cash (identity exact, ≤₩1). `historical_pnl_service` and the trade-trace cumulative series remain **clean-basis**; the PnL Trace panel's own daily_pnl is dirty+cash. Aligning all three to one basis is an owner call (it moves displayed cumulative levels by the accrued component).
2. **realized_cash surfacing.** The API now exposes the settled cash inside theta per row/portfolio; nothing renders it yet (the Home table is Session A's surface — additive only, no FE change made here).
3. **σ_daily configurability.** Fixed at 2.0bp/business day. Options: request field, Settings entry, or estimation from rate history. Also: whether the fan's parallel-only uncertainty should someday include spread scenarios.
4. **Component-series view.** The 5-series decomposition (MTM/캐리/스왑세타/스왑평가/합계) is now only the fallback when `distribution` is absent. If both views should be user-switchable, that's a new control (button group per T2 conventions would fit).
5. **Bridge funding rate.** The sim bridge still hard-codes the source's 4.2% (S6 known gap). The strip displays it faithfully; wiring Settings' BOK+spread into `buildSimulationInputs` is a separate change with owner-visible effect on every carry figure.
6. **TradingView attribution logo** now visible in the funding-strip pane (the library places it in the bottom pane; `LwChartBase` never disables it). Turning it off via `layout.attributionLogo` has license implications — integration/owner call.
7. **ChartFrame adoption** for the Simulation charts stays deferred to the integration pass per scope (s10 built it on its unmerged branch).
