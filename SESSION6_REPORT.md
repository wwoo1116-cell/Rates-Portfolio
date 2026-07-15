# SESSION6_REPORT — Valuation Unit Fix: CD Fixing Decimal/Percent + Fixing Selection + Bump-Reval DV01

**Executed 2026-07-15, unattended.** Implements the fix spec of `DIAG_PNL_TRACE.md` §10 (F1–F4)
against the diagnosed-and-reconciled root cause; no re-diagnosis. All verification ran headlessly
with MySQL force-disabled, off `Data/` (True Data.xlsx through 2026-07-15).

## 0. Sequencing precondition (Session 2)

**Neither stated precondition held cleanly; proceeded after verifying the intent was satisfied.**
`SESSION2_REPORT.md` does not exist anywhere under `Rates Portfolio/`, but Session 2 *was*
dispatched and its work is merged: commit `951a58c` "fix(portfolio-loader): … (S2)" landed on `v2`
at 13:21 KST today, SESSION4_REPORT §2 records S1/S3 integration on top of it, and at session
start (15:05 KST) the backend tree was clean except the S5 diagnosis artifacts — no concurrent
edits in the shared services layer. Assumption proceeded on: **Session 2 completed without writing
its report file.** Flagged as an open question (§9).

## 1. Verdict and headline numbers

All four defect surfaces are fixed and reconciled to the won:

| Surface | Buggy | Fixed |
|---|---:|---:|
| Run C reset-day daily PnL (2025-07-16) | −61,571,287 | **−1,144** (pure market move + 1-day DF) |
| Run C float settlement credit | +625,781 | **+70,057,534** = N·fix(F(R₁))·α₀, to ₩0.00 |
| Run C final cumulative PnL | −58,322,777 | **+4,176,712** |
| 7Y final cumulative PnL | −1,070,426,370 | **+476,880,352** |
| Trace tooltip DV01, 3M remaining (2026-04-03) | −491,295 (proxy) | **−244,886** (bump-reval) |
| Trace tooltip DV01 post-final-fixing (2026-04-07) | −244,875 | **−108** |
| Dashboard daily PnL total (close 7/14 → as-of 7/15) | −4,219,240,960 | **+67,998** |

Backend suite: **278 passed + 4 xfailed** (was 233 + 4; +45 new tests). **No FE change was needed**
(§8). Commits: `242c98d` (diagnosis artifacts), `d7330f2` (T1), `8305d73` (T2), `a3fe691` (T3),
`219addd` (T5 matrix), plus this report's commit (T4).

## 2. Task 1 — decimal end-to-end at the engine boundary

**Decimal is the single internal unit.** Percent→decimal conversion happens exactly once, at the
loader boundary (`loaders/true_data.py` `load_fixing_history_xlsx` — this was already true); the
engine now consumes it verbatim. `engine/mtm_valuation.py`:

- the internal `/100` on the fixing (old line 57) and the `*100` on the forward fallback (old
  line 54) are **deleted**;
- the parameter was renamed to carry its unit (`current_float_rate_decimal` in T1, then replaced
  by the `fixings` dict in T2 whose decimal contract is documented at the module boundary);
- the convention is documented **where it is enforced**: module docstrings of
  `engine/mtm_valuation.py` and `engine/fixings.py`, not only in this report.

**Audit of every `load_fixings()` caller and every `/100` between loader and engine:**

| Site | Verdict |
|---|---|
| `loaders/true_data.py:145`, `csv_loader.py:91`, `total_data.py:76` | divide exactly once → decimal ✓ |
| `npv_trace_service` (trace loop) | passed decimal into a `/100` engine — **fixed** |
| `mtm_service.value_trade`, `portfolio_service._extract_float_rate` | same unit bug + look-ahead — **fixed** (T2) |
| `historical_pnl_service`, `portfolio_analytics_service`, routers | pass-throughs to `price_portfolio`/`value_trade` — inherit the fix |
| `engine/mtm_valuation.py` `fixed_rate_pct / 100.0` | sanctioned: IRS_Trade carries percent per quant_engine's `_pct` discipline; the single decimal→percent conversion is `VanillaSwap.to_irs_trade` |
| `engine/pricing.py:19–24` `forward*100` then `/100` | internal round-trip on its own forward, self-consistent no-op — untouched (cosmetic; §9) |
| `engine/risk.py:35` `forward*100` | feeds quant_engine's `current_float_rate_pct` arg — correct percent contract |

**Unit-guard test** (`tests/test_unit_guard.py`): floating settlement asserted against the
hand-computed analytic value 10bn × 0.0251 × 91/365 = **62,578,082.19** at rel 1e-9, on a fixture
whose schedule arithmetic (effective 2025-04-16, pay 2025-07-16, α = 91/365) is written out by
hand. A double division (−100×) and a missing division (+100×) both fail it; the stub rate is also
asserted `== fixing` verbatim, and the loader side is pinned to the decimal range (0.001, 0.2)
over the real 4,000-entry store.

## 3. Task 2 — reset-date fixing selection

**One shared implementation: `engine/fixings.py`.** All three former service-local selections
(npv_trace's valuation-date ffill; mtm/portfolio's `max(fixings.keys())` look-ahead) are gone —
services now pass the whole store to `value_booked_trade`, which resolves every floating period
through `select_fixing`.

- **Convention (owner-confirmed, encoded as `CD_FIXING_LAG_SEOUL_BDAYS = 1`, switchable):**
  F(R) = R − 1 Seoul business day, business-day arithmetic. Pinned by tests: normal reset
  (Wed 07-16 → Tue 07-15), weekend (Mon 07-14 → Fri 07-11), holiday (Tue 2023-05-30 → Fri
  2023-05-26 across the 05-29 substitute holiday — explicitly ≠ calendar-minus-one).
- **Immutable thereafter**: the period's rate is fix(F(R)) on every later valuation date
  (pinned across three advancing dates against newer prints).
- **No look-ahead**: a future-dated print in the store is never selected; F(R) > valuation date
  ⇒ curve forward (pinned at both `select_fixing` and `mtm_service` levels).
- **Uniform across periods**, not stub-only: one Seoul business day before a reset, the *next*
  period's print is already set and is used (pinned). This is why the corrected DV01 collapses on
  2026-04-06 rather than 04-07 (§4).
- **ffill = data-availability fallback, not the convention**: F(R) is a business day by
  construction, so a non-exact hit is a data-quality event — logged (deduplicated) and surfaced
  in payloads where the freshness machinery already lives: `NpvTraceResponse.fixing_warnings`,
  `PortfolioResult.fixing_warnings`, and the book-daily-pnl envelope's `fixing_warnings` next to
  `quote_sources`. All additive fields. On the real store all matrix runs produce **zero**
  warnings (asserted).
- Consequential contract change: `CashFlowDetail.is_known` now means *a genuine fixing* — a
  forward-estimated stub honestly reports `is_known=False` (one assertion in
  `test_engine_regression` updated accordingly).

## 4. Task 3 — bump-reval DV01

`npv_trace_service` replaces `pv_fixed_leg/(fixed_rate·10⁴)` with: every par node (O/N, CD91, all
IRS quotes) **+1bp single-sided**, full re-bootstrap, revalue with fixings held constant
(automatic — selection is date-based and curve-independent), **DV01 = −(NPV_up − NPV_base)** —
the identical definition, shift, sidedness and sign convention as `engine/risk.py` /
`quant_engine.compute_irs_pvbp`, so the system has one DV01 meaning. The `fixed_rate == 0` 0/0
special case disappears with the proxy.

Both diagnosed failure modes verified gone on the real Run-B dates:
pre-reset **−244,886** on 2026-04-03 (diagnosis expectation ≈ −245k; proxy showed −491,295);
post-final-fixing **−108/bp** (diagnosis measured −108; proxy kept −244,875). |DV01| decays across
every trace: strictly at reset granularity, with a ≤1%/day allowance for genuine market-level
dependence (a rate rally raises DFs and the annuity — measured +0.33%/day on the 7Y), terminal ≈ 0.
Note the corrected series collapses on **2026-04-06**, one business day before the diagnosis
table's 04-07: F(04-07) = 04-06, so the final period is already fixed that day — the convention,
not a bug.

## 5. The won-level reconciliation (verification §2)

The spec's targets were stated under the diagnosis's *valuation-date* stub selection (CD ≈ 2.51%
on both sides of the reset). Under the owner-confirmed **reset-date** convention the stub's true
fixing is CD(2025-04-15) = **2.81%**, which moves the individual terms while landing on the same
conclusion — reset-day PnL is the pure market move:

- daily PnL(2025-07-16): **−61,571,287 → −1,144**. The service's own loop and the independent
  `dirty(v) + credits − dirty(u)` recomputation agree exactly (dump). The residual −1,144 vs the
  spec's ≈ −56 is the same market-move term evaluated with the 2.81% stub (a fixed coupon's
  1-day discounting differs slightly from the 2.51% counterfactual's).
- The missing float settlement credit now appears in the float leg: credited float =
  **70,057,534** = 10bn × 0.0281 × 91/365, identity closed to **₩0.00** (dump: `diff = 0.00`).
  The spec's −61,952,301 was the missing credit *at the valuation-date fixing* (62,578,082 −
  625,781); at the correct reset-date fixing the previously-missing credit is 70,057,534 −
  625,781 = **69,431,753**.
- Run C net settlement, period 1: N·(2.81% − 3%)·α = **−4,736,986** (was −12,216,438 under the
  2.51% assumption — the trade was less underwater in its first quarter than the diagnosis's
  counterfactual implied).

**7Y anchored to the won.** Measured corrected final **+476,880,352** vs the diagnosis's
corrected-units rerun **+500,828,297**: difference **−23,947,945**, which equals the analytic
start-vs-end-print settlement delta Σ N·(fix(F(R_k)) − fix(F(pay_k)))·α_k = **−23,947,945**
exactly (0 residual) — the diagnosis's counterfactual fixed the units but kept daily re-fixing,
so each quarter it credited ~the period-*end* print; the desk convention credits the period-*start*
print. The −1.57bn unit-bug quantification stands; the remaining −24m is the selection convention.

## 6. Task 4 — dashboard impact and re-baselining

Method: `scripts/session6_dashboard_impact.py` run pre-fix (`before`) and post-fix (`after`) on
identical inputs — the standard workbook seed (686 positions = **413 IRS + 273 bonds** through
`loaders/portfolio.py`, the S4 seed definition), close = **2026-07-14**, as-of = **2026-07-15**
(latest adjacent business-day pair, so the MtM leg is computable). Artifacts:
`scripts/session6_dashboard_{before,after}.{json,txt}`.

### Before/after (all KRW)

| Figure | Before (buggy) | After (fixed) | Δ |
|---|---:|---:|---:|
| IRS book MtM — clean NPV (RP Fund, 413 lots) | +6,866,192,054 | +5,738,732,364 | **−1,127,459,690** |
| IRS book MtM — dirty NPV | +3,402,724,345 | +5,818,702,907 | **+2,415,978,562** |
| Daily PnL — total | −4,219,240,960 | +67,998 | **+4,219,308,958** |
| Daily PnL — MtM leg | −297,520,599 | −297,566,897 | −46,298 |
| Daily PnL — Theta leg | −3,921,720,361 | +297,634,896 | **+4,219,355,257** |
| Funding (bond-only) | −10,300,998 | −10,300,998 | 0 ✓ |
| 평가금액 / 액면금액 / 평균 YTM | 3.760조 / (bond-static) / 3.0110 | identical | 0 ✓ |
| 헷지 듀레이션 (RP Fund) | 0.4604 | 0.4604 | 0 ✓ |
| PVBP table — IRS row (all 16 buckets, total −106,400,549) | identical | identical | 0 ✓ |
| PVBP table — every bond sector row | identical | identical | 0 ✓ |

Reading the deltas:

- **The buggy dashboard was showing a −4.22bn daily loss on a normal day.** 2026-07-15 is a
  quarterly-reset-heavy date across the 413-lot book, and every crossing leaked ≈ −N·CD·α into
  **theta** (settlements credited at the ~100×-crushed float rate). Corrected, theta is +297.6m
  and nearly cancels the −297.6m MtM leg: total **+68k**. The MtM leg itself barely moved (−46k)
  — it differences two same-fixing valuations, which is also why the corruption hid there so well.
- **IRS book level**: dirty NPV was understated by **2.42bn** (the erased current-period float
  PVs); clean NPV was *overstated* by 1.13bn because the crushed float side also corrupted net
  accrued by ≈ +3.5bn. Level corrections of this size are the book-level counterpart of the 7Y
  trace's −1.57bn.
- **Negative controls hold exactly**: every bond-only figure (funding, eval, YTM, bond PVBP rows)
  is byte-identical, and so are 헷지 듀레이션 and the IRS PVBP row — quantified confirmation that
  the KRD/PVBP path (`price_portfolio_delta`) never consumed fixings (its stub is the curve
  forward; see §9 for the residual inconsistency this leaves).

### Decomposition identity — re-verified post-fix

`total = mtm + theta` holds with **gap 0.0** on every book row (before *and* after — the identity
held with wrong levels, as predicted), and the telescoping check against a fully independent
revaluation (`theta + mtm == V(T,c_T) − V(close,c_close) + realized cash`, per position, 413
positions) closes at **max |gap| = 0.0 KRW** post-fix (2.4e-7 pre-fix — float noise).

### Superseding baseline declaration

**The `after` column above and the §7 anchors are the baseline from this commit onward.**
Obsolete: every IRS-MtM-derived number captured before `8305d73` — in particular the Home Daily
PnL figures and any PnL-trace/trade-detail values in SESSION4's screenshots (`s4_home.png`
evidence set), and the diagnosis's buggy fixtures (−58,320,000 / −44,410,000 / +4,360,000 /
−490,000 tooltip). **Not obsolete** (re-verified identical here): SESSION4 §3.2 ribbon KPIs
(평가금액 3.76조 / YTM 3.011 / 헷지 듀레이션), §3.3 allocation, §3.8 PVBP matrix including the IRS
row and its hidden-column arithmetic — those never depended on the fixing path. Note the running
`:8000` uvicorn (PID 14264) predates the fix and must be restarted to serve corrected values.

## 7. Task 5 — regression matrix

`tests/test_pnl_trace_regression.py`, real-workbook, 21 tests, all passing. Per tenor
(pay-fixed ₩10bn @3%): no reset-day cliff (crossing-day PnL inside the ordinary-day envelope;
short tenors also ≤ N×5bp absolute), settlement identity to ₩1 (final cum == independently
recomputed Σ N·(fix(F(R_k)) − K)·α_k + terminal dirty − entry dirty), DV01 decay (daily with 1%
market allowance + strict at resets + terminal ≈ 0), pinned anchors, zero fixing warnings.

| Tenor | Fixture | Final cum (pinned) | Entry mark | Inception DV01 |
|---|---|---:|---:|---:|
| 5M | 2025-05-15 → 2025-10-15 | +189,335 | −15,603,034 | −157,299 |
| 6M (Run C) | 2025-04-15 → 2025-10-15 | +4,176,712 | −21,130,136 | −246,900 |
| 9M | 2025-01-15 → 2025-10-15 | +437,205 | −13,445,424 | −490,493 |
| 1Y | 2024-10-15 → 2025-10-15 | −10,164,556 | +10,515,241 | −726,967 |
| 7Y | 2019-05-28 → 2026-05-28 | +476,880,352 | −968,362,544 | −6,711,440 |

The 6M anchor is the faithful-fixture arithmetic: settlements 10bn×[(2.81%−3%) + (2.51%−3%)]×91/365
= −16,952,904, minus the −21,130,136 entry mark → +4,176,712 (asserted to ₩1). The 7Y anchor's
relation to the diagnosis's +500.8m is closed to the won in §5.

**Dump diff** (`scripts/diag_pnl_trace_out.txt` pre-fix vs `diag_pnl_trace_out_postfix.txt`,
same sections): Run C final −58,322,777 → +4,176,712, worst daily −61,571,287 (reset day) →
−1,048,383 (an ordinary June market day); Run A final −44,408,701 → −1,305,045; Run B −64,572,436
→ +4,740,057; 7Y −1,070,426,370 → +476,880,352, worst crossing now −87.9m against a ±102.8m
genuine-move envelope; DV01 table per §4. The post-cliff "freeze" is gone — post-reset days show
live discount/accrual PnL and the tooltip decays instead of freezing.

## 8. Verification gates

- **BE pytest: 278 passed, 4 xfailed** (baseline 233 + 4; +45: unit guard 4, fixing selection 12,
  DV01 6, matrix 21, updated regressions 2). Suite runtime 17.6s (matrix adds ~13s of real-data
  revaluation).
- **No FE change needed**: the trace panel reads `point.delta` (name unchanged, now bump-reval)
  and `formatPnlKrw` renders it; new response fields (`fixing_warnings`) are additive and ignored
  by the current UI. The DV01 tooltip required no rewiring.
- Both dashboard captures ran the production service path (`build_book_daily_pnl`,
  `build_book_summary`, `build_pvbp_sensitivity`, `price_portfolio`) headlessly with curve_cache
  installed, DB latch off, identical seed and dates.

## 9. Open questions and adjacent defects (observed, deliberately not fixed)

1. **Session 2's report is missing** while its commit (`951a58c`) is merged — proceeded assuming
   S2 completed; if S2 is in fact still open somewhere, its scope (portfolio loader) is disjoint
   from this session's diff except `portfolio_analytics_service.py`, which was clean before I
   touched it.
2. **KRD/PVBP stub ignores the fixing** (`engine/risk.py::_krd_args` derives
   `current_float_rate_pct` from the forward; `price_portfolio_delta` ignores `fixings` by design,
   pinned by `test_delta_is_independent_of_fixings`). Sensitivities are barely affected (a fixed
   stub has ~no rate risk beyond discounting), but the KRD *base NPV* now differs from the reported
   NPV whenever fix(F(R)) ≠ forward — the "KRD base == reported NPV" invariant from the 2026-07-14
   consolidation is no longer exact on trades with a live fixing. Deciding whether risk should
   price the fixed stub (and the PVBP-table/`_shared_delta` cache-key consequences) is an owner
   call.
3. **Fair-rate path ignores the live fixing** (`position_fair_rate` prices a zero-fixed probe off
   the curve alone; pre-existing, noted in `test_portfolio_service`'s docstring). A mid-life
   trade's par-rate hint is therefore slightly off whenever fixing ≠ forward.
4. **`VanillaSwap.float_spread` is accepted but never enters `value_booked_trade`'s float leg**
   (no spread term in the cashflow loop). All current seeds carry spread 0.0; documented, not fixed.
5. **`_KR_HOLIDAYS` covers 2020–2034 only** — schedule rolls and F(R) stepping on pre-2020 dates
   (the 7Y's 2019 head) treat KR holidays as business days. The store had prints for every such
   F(R) (zero warnings), so no observed impact.
6. **`compute_npv_trace_for_trade`** (cached DB variant) inherits corrected valuations via
   `mtm_service` but keeps its own simpler daily-PnL semantics (clean-NPV diff, no settlement
   crediting) — its series is not comparable to the ad-hoc trace across pay dates; pre-existing
   design, out of scope.
7. **`engine/pricing.py`'s internal `*100` → `/100` round-trip** on its own forward is a no-op
   but perpetuates the percent/decimal trap pattern; cosmetic cleanup candidate.
8. **QuantLib-era scripts are dead relics** (`scripts/extract_floating_leg.py`,
   `generate_40_coupons.py`, `test_ccp_target*.py`, `test_interpolators.py`,
   `debug_npv_residual.py`, `debug_par_vs_npv_schedule.py` import a removed `_build_periods` and
   fail at import). Coincidentally their `fixings={date: decimal}` call shape matches the new API;
   left untouched.
9. **Backend-parsed bonds have `payment_frequency=None`** (S1/S2 known gap, owner decision
   pending), so all 273 bonds took `_bond_pnl`'s analytic fallback in both captures — identical
   on both sides, hence still a valid negative control; the FE blotter path is unaffected.
10. **Stale server**: the `:8000` uvicorn running since before this session serves pre-fix code
    until restarted (`start-backend.ps1`).
11. The spec's verification constants (≈ −56 daily, −61,952,301 credit) were written under
    valuation-date stub selection; under the owner-confirmed F(R) convention the measured
    equivalents are −1,144 and 69,431,753, each reconciled exactly in §5. Proceeded on the
    convention as specified in the session order (owner-confirmed F(R) = R − 1 Seoul BD).

## 10. Commits (this session, branch `v2`)

| Commit | Content |
|---|---|
| `242c98d` | docs: S5 diagnosis report + repro script + buggy baseline dump committed |
| `d7330f2` | T1 — decimal contract at the engine boundary + unit-guard tests |
| `8305d73` | T2 — engine/fixings.py reset-date selection, warnings surfaced, services rewired |
| `a3fe691` | T3 — bump-reval DV01 replacing the annuity proxy |
| `149ac1b` | T4 capture script + before/after artifacts (committed concurrently by the owner while this session ran — the repo's known concurrent-session pattern; contents match this session's captures) |
| `219addd` | T5 — regression matrix + adapted repro script + post-fix dump |
| `a6aa1b7` | T4 — impact quantification + SESSION6_REPORT.md |
