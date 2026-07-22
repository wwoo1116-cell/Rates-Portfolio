# DIAG_PNL_TRACE — PnL Trace First-Reset Valuation Cliff

**Mode: diagnosis only. No production code was modified.**
Reproduction script: `scripts/diag_pnl_trace.py` (full dump: `scripts/diag_pnl_trace_out.txt`).
All runs were executed headlessly against `Data/True Data.xlsx` with the MySQL path force-disabled
(`market_data_service._db_market_data_unavailable = True`); MySQL was never touched.

---

## 1. Root cause (one paragraph)

`value_booked_trade()` expects its `current_float_rate` argument **in percent** (e.g. `2.51`) — it
divides by 100 internally (`engine/mtm_valuation.py:57`) and its own `None`-fallback produces percent
(`forward_rate_simple(...) * 100.0`, line 54). But `compute_npv_trace()` feeds it the raw value from
`market_data_service.load_fixings()` (`services/npv_trace_service.py:90-92`), and the fixing history
is stored **in decimal** — `load_fixing_history_xlsx()` explicitly divides the workbook's percent
value by 100 (`loaders/true_data.py:145`, docstring says "decimal"). The fixing is therefore divided
by 100 **twice**: the current-stub floating rate becomes `0.025099/100 = 0.000251` instead of
`0.025099`. The current-period floating cashflow — the only cashflow priced off the fixing — is
effectively erased (₩625,781 instead of ₩62,578,082 on a ₩10bn quarter). Everything observed in the
UI (cliff at first reset, post-cliff flatline, inflated DV01, "healthy-looking" 7Y) follows
arithmetically from this one wrong number plus the trace loop's settlement-crediting logic. This is
the same *decimal-vs-percent contract violation* class already documented for the par-curve inputs
(quant_engine unit conventions header, lines 18-21).

There are two **secondary defects** confirmed along the way (§8): the stub is re-fixed daily off the
*valuation-date* CD instead of the reset-date fixing, and the tooltip "DV01" is a fixed-leg annuity
proxy, not a swap DV01.

---

## 2. Pricing path map (Task 1)

| Layer | File / function |
|---|---|
| Endpoint | `api/routers/npv_trace.py` → `npv_trace_endpoint()` (POST `/api/mtm/npv-trace`) |
| UI caller | `UIUX_test/src/features/home/pnl-trace-panel.tsx` (note: **one input field feeds both `trade_date` and trace `start_date`**; sends `fixed_rate = pct/100` → decimal, correct) |
| Trace loop | `services/npv_trace_service.py` → `compute_npv_trace()` — per-date: snapshot → curve → fixing selection → `value_booked_trade` → cashflow crediting → `daily_pnl` |
| Date enumeration | `services/market_data_service.py` → `list_available_dates()` (workbook row dates) |
| Snapshot | `market_data_service.load_snapshot()` → `loaders/true_data.py::load_market_snapshot_xlsx()` (rates ÷100 → **decimal**) |
| Fixings | `market_data_service.load_fixings()` → `load_fixing_history_xlsx()` (CD91 ÷100 → **decimal**) |
| Curve | `engine/curve.py::build_curve()` → `engine/quant_engine.py::bootstrap_zero_curve()` (expects decimal par rates — consistent) |
| Schedule | `engine/instruments.py::VanillaSwap.to_irs_trade()` (effective = `next_kr_business_day(trade_date)`, i.e. **T+1**) → `quant_engine.IRS_Trade._build_schedule()` (forward generation + EOM + **ModFol with KR holidays** + 10-day maturity snap) |
| Valuation | `engine/mtm_valuation.py::value_booked_trade()` — fixed leg Σ N·F·αᵢ·DF; float stub at `float_rate0` (**the defect site**), later periods at `forward_rate_simple` (decimal, correct); `df_linear_rate` discounting |
| PnL accumulation | `compute_npv_trace()` lines 102-115: `total = dirty_npv + cumulative_cashflows`; `daily_pnl = total(t) − total(t−1)`; cashflows credited from the *previous* result when `payment_date <= valuation_date` |
| Tooltip DV01 | `npv_trace_service.py:100`: `delta = pv_fixed_leg / (fixed_rate · 10⁴)` |

---

## 3. Run C reproduced headlessly (Tasks 2–4)

Fixture: trade 2025-04-15, maturity 2025-10-15, pay-fixed 3%, ₩10bn.
Engine schedule: effective **2025-04-16** (T+1), pay dates **[2025-07-16, 2025-10-15]**, both α = 91/365 = 0.249315.
Whole-trace result: **final cum = −58,322,777**, which the UI formatter (`formatPnlKrw`, round-to-₩10k)
renders as exactly the observed **−58,320,000**. Reproduction is exact.

Valuation breakdowns (side-by-side; full cashflow tables in `diag_pnl_trace_out.txt` lines 20-98):

| | 2025-07-15 (T−1 of pay) | 2025-07-16 (pay date) | 2025-07-17 |
|---|---|---|---|
| snapshot lookup | HIT, cd=0.0251 | HIT, cd=0.0251 | HIT, cd=0.0251 |
| fixing lookup (ffill ≤ date) | HIT key=2025-07-15, **0.0251 (decimal)** | HIT key=2025-07-16, 0.0251 | HIT key=2025-07-17, 0.0251 |
| stub rate actually used | **0.000251** | **0.000251** | **0.000251** |
| float stub cashflow | ₩625,781 (should be ₩62,578,082) | ₩625,781 | ₩625,781 |
| forward-period float rate | 0.025099 (correct, `is_known=False`) | — (no forward period left) | — |
| dirty NPV | **−86,304,945** | **−73,707,492** | −73,712,550 |
| dirty NPV if fixing passed as percent | −24,356,849 | −12,140,466 | −12,141,299 |
| **unit-mismatch impact on dirty** | **−61,948,096** | **−61,567,027** | −61,571,251 |
| tooltip DV01 | −497,046 | −247,765 | −247,782 |

Every schedule date is a KR business day; every snapshot and fixing lookup on these dates **HIT**
(ffill, no NaN/0/None substitution anywhere — Task 4). The only "zero-like" substitution in the whole
path is the double `/100` itself.

---

## 4. Closed-form reconciliation of the jump (Task 5)

The service's own worst day is **daily_pnl(2025-07-16) = −61,571,287** (not −63.3m; see below).
The trace loop computes it as:

```
daily_pnl(7/16) = dirty(7/16) + credits − dirty(7/15)
                = −73,707,492 + (−74,168,740) − (−86,304,945) = −61,571,287   ✓ matches service output exactly
credits = fixed −74,794,521 (N·3%·0.249315)  +  float +625,781 (N·0.000251·0.249315)
```

Decomposition into cause terms (all from the dumps, closes to ₩1):

| Term | Amount |
|---|---|
| (a) Missing float settlement credit: `625,781 − 62,578,082` (float coupon credited at rate 0.000251 instead of 0.0251) | **−61,952,301** |
| (b) Stub-error handoff: old stub's mispricing leaves `dirty` (+61,948,096) while the new (final) stub's mispricing enters it (−61,567,027) | **+381,069** |
| (c) Genuine market/carry move (unit-corrected daily PnL: −12,140,466 − 12,216,439 + 24,356,849) | **−56** |
| **Sum** | **−61,571,288** (actual −61,571,287; ₩1 float rounding) |

So on the reset day the swap should have shown a daily PnL of **≈ ₩0** (true net settlement
−12,216,438 replaced its own PV); instead it showed **−61.57m ≈ −N·CD·α·DF**.

**About the user's −63.3m figure:** that was computed from the chart as (pre-cliff cum ≈ +5m) −
(post-cliff plateau ≈ −58.3m). Reproduced precisely: cum(7/15) = **+3,694,798**, cum(7/16) =
−57,876,489 (single-day jump −61,571,287), then −0.45m of post-cliff drift to −58,322,777. The
−63.3m estimate bundled the drift and an eyeballed pre-cliff level; the actual single-day jump is
−61.57m. No second mechanism is needed.

**Cliff-date off-by-one resolved (part of Task 9):** the engine's first pay date is
2025-07-16, not 2025-07-15 — the schedule starts at T+1 (`to_irs_trade`), so pay = trade+3M**+1d**.
The drop lands *at the 2025-07-16 data point*; 2025-07-15 is the last good point, i.e. the **left
vertex of the drop segment** on the line chart. `trade_date + 3M` (the user's "reset date") and
"pay date − 1" coincide exactly, which is why the observed cliff dates matched the start+3M
hypothesis to the day. The chart introduces no shift of its own — `pnl-trace-panel.tsx:87` feeds
lightweight-charts plain `YYYY-MM-DD` strings. Same pattern in Run B: drop at 2026-04-07 (pay
date), left vertex 2026-04-06 = trade+3M.

---

## 5. The "freeze" (Task 6)

**There is no swallowed exception, no cached value, no loop break, no early return.** After
2025-07-16 the trace keeps revaluing every day; `rem` is non-empty until maturity and
`value_booked_trade` returns fresh numbers. The flatline is arithmetic: with the final period's
fixing crushed to 0.000251, the position degenerates into essentially **a single already-known fixed
cashflow discounted over ≤3M**. Its only remaining P&L is discount drift:

```
2025-07-17  daily −5,058      2025-07-22  daily −817       ...
2025-07-21  daily −15,116     2025-10-14  daily −2,700     2025-10-15 (maturity) daily −5,111
max |daily_pnl| between first pay date and maturity = ₩41,450
```

Daily PnL is not *exactly* zero — it is −₩0.8k…−₩41k of theta/DF drift on a ~₩74.5m discounted
flow, i.e. three orders of magnitude below pre-cliff daily moves (±₩2m). The tooltip rounds to
₩10,000 (`formatPnlKrw`), so most days display literally "0"; at chart scale (~₩90m range) the line
is one flat pixel. Invariant #4 ("exactly 0") is thus *approximately* rather than exactly true —
consistent, not contradictory. A correctly priced final period would keep a live ~₩62m floating PV
marked daily; a correctly-fixed one would still show small but visible accrual/discount PnL.

At maturity the loop behaves consistently: `rem` empties → `MTMResult(0,…)`, the final coupons are
credited (fixed −74,794,521, float +625,781), and net daily is −5,111 — the frozen value "settles
into" realized cash with no second jump, which is why the plateau runs clean to maturity.

---

## 6. DV01 finding (Task 7)

`delta = pv_fixed_leg / (fixed_rate·10⁴)` is the **fixed-leg annuity PVBP** (Σ N·αᵢ·DFᵢ / 10⁴), not a
swap DV01. It **is recomputed every day and does decay** — but stepwise at payments, and it is wrong
in both regimes. Measured on Run B (trade 2026-01-06, maturity 2026-07-06), against a true
+1bp-parallel bump-and-reval of the same position:

| Date | Tooltip delta | Bump-reval DV01 (buggy stub) | Bump-reval DV01 (percent stub) |
|---|---|---|---|
| 2026-04-03 | −491,295 | −244,962 | −244,887 |
| 2026-04-06 (pre-cliff) | **−491,412** → UI "−490,000" ✓ | **−244,939** | −244,920 |
| 2026-04-07 (post-reset) | −244,875 | −1,782 | **−108** |
| 2026-04-08 | −244,896 | −1,762 | −107 |

- **Pre-reset** the tooltip reads ~2× the true DV01 (−491k vs −245k): the proxy counts the imminent
  coupon's full annuity weight although that flow has essentially zero rate risk (t = 1 day). The
  user's expectation "≈250k for 3M/₩10bn" matches the true bump-reval number, not the tooltip.
- **Post-final-reset** the true DV01 of a swap whose last fixing is set is near zero (both legs are
  known cashflows; only discount risk, ~−₩108/bp). The tooltip still reports −245k — three orders of
  magnitude off.

So: not "computed once at inception", but a structurally wrong proxy at every point in the lifecycle.

---

## 7. Why the 7Y run "survives" (Task 8) — and why invariant #2 is substantively wrong

**There is no branch that spares the 7Y swap.** It hits the identical defect at **every one of its
28 quarterly resets**. Crossing-day daily PnL (excerpt; full list in the dump, lines 234-262):

```
pay 2019-08-29 → daily −37,514,970        pay 2024-11-29 → daily −86,929,059
pay 2020-02-28 → daily −122,902,161       pay 2025-08-29 → daily −60,954,119
pay 2022-11-29 → daily −78,534,577        pay 2026-02-27 → daily −67,461,969
```

Each crossing leaks ≈ −N·CD·α (CD 0.7%→4% over the period → −₩17m…−₩100m per quarter), superimposed
on genuine settlement steps of −N·(3%−CD)·α and genuine daily MtM of ±₩100m. Counterfactual rerun of
the same window with the fixing passed in percent:

> **7Y corrected-units final cum = +500,828,297** vs buggy **−1,070,426,370**
> → **−1,571,254,667 of the 7Y trace is the unit bug** (28 resets × ≈ −N·CD·α).

The 7Y run is the *most* damaged trace in absolute terms — its true lifetime PnL is **positive
half a billion won**, not negative one billion. It merely *looks* healthy because (a) each leak is
the same order of magnitude as a legitimate quarterly settlement step for a pay-3% swap, and (b) it
is embedded in large genuine MtM swings, whereas the short swaps have exactly one crossing followed
by a dead stub — one naked step plus a flatline, which reads as a cliff. **This finding contradicts
invariant #2 as stated**: the 7Y does not cliff *visibly*, but it is not immune; "7Y survival" is an
illusion of scale, and it is precisely why the bug was discriminable only on short swaps.

---

## 8. H3 evidence table (Task 9) and the two secondary defects

Rolling/fill behavior per layer — **no layer disagrees with another, and no lookup ever misses**:

| Layer | Convention | Miss behavior |
|---|---|---|
| Schedule (`IRS_Trade._build_schedule`) | Forward generation + EOM + **ModFol incl. KR holidays** (`_modfol_bd`, `holidays.KR` confirmed importable in this env); ≤10-day tail snapped to maturity | n/a — dates are *generated*, always land on business days |
| Effective date (`to_irs_trade`) | T+1 via `next_kr_business_day` | n/a |
| Valuation dates (`list_available_dates`) | Only dates present in the workbook | dates absent from data are simply never valued |
| Snapshot (`load_snapshot`) | exact-date row lookup | `NonBusinessDayError` → date appended to `skipped_dates`, **skipped, not zero-filled** (Run A/B skipped 4 dates, 7Y skipped 5 — holiday rows present in the workbook; benign) |
| Fixings (`compute_npv_trace` lines 88-90) | **ffill**: `max(k ≤ valuation_date)` over 4,046 entries (2010-03-11…2026-07-15) | returns `None` only if no earlier fixing exists → engine falls back to its own forward (percent, correct) |

Schedule dates for all four runs, with raw (unadjusted) dates and rolls:

| Run | Effective | Raw dates → adjusted | Weekend/holiday handling |
|---|---|---|---|
| A (2026-02-06→07-06) | 2026-02-09 (Mon; T+1 of Fri rolls over weekend) | 2026-05-09 **Sat → 2026-05-11 Mon**; 2026-08-09 snapped → maturity 2026-07-06 (Mon) | rolled correctly; cliff observed on the rolled date 05-11 ✓ |
| B (2026-01-06→07-06) | 2026-01-07 (Wed) | 2026-04-07 (Tue, no roll); 2026-07-07 snapped → 2026-07-06 | no roll needed |
| C (2025-04-15→10-15) | 2025-04-16 (Wed) | 2025-07-16 (Wed, no roll); 2025-10-16 snapped → 2025-10-15 | no roll needed |
| 7Y (2019-05-28→2026-05-28) | 2019-05-29 | 9 of 28 raw dates fall on weekends/holidays, incl. 2020-08-29 Sat→08-31, 2020-11-29 Sun→11-30, 2021-02-28 Sun→02-26 (ModFol month-end back-roll), 2023-05-29 **KR holiday**→05-30, 2026-02-28 Sat→02-27 | all rolled to business days; crossings on those dates leak exactly like weekday crossings (e.g. 2020-11-30: −1.50m; 2020-08-31: +5.78m net of a favorable market day) — weekends change nothing |

**H3 verdict: falsified.** Every schedule date is business-day-adjusted before any lookup; snapshot
lookups on those dates HIT; fixing lookup is ffill and cannot miss. The "cliff dates are business
days" tension dissolves via §4 (left-vertex reading + T+1), and weekend resets in the 7Y run
behaved identically to weekday resets.

Two real secondary defects surfaced by the instrumentation (both *independent* of the cliff):

1. **Wrong fixing date**: the current stub uses the *valuation-date* CD (ffill `≤ val_date`), so the
   "fixed" period re-fixes daily. Correct behavior: fix once at the stub's reset date
   (`pay_dates[first_i−1]`, or the effective date for the first period; per desk convention likely
   the prior business day's CD). Pre-cliff this mis-marks the stub by N·ΔCD·α·DF and mis-sizes the
   settlement credit whenever CD moved intra-quarter.
2. **Look-ahead in sibling services**: `mtm_service.value_trade` (`max(fixings.keys())` — global
   latest regardless of valuation date) and `portfolio_service._extract_float_rate` (same) inject
   *today's* CD into *historical* revaluations — and both also pass it in decimal, so
   `/api/mtm/npv-trace/{trade_id}` (cached variant), `compute_historical_pnl`, and
   `price_portfolio`/`price_portfolio_delta` all share the unit bug and add look-ahead on top.

---

## 9. Hypothesis verdicts

| Hypothesis | Verdict | Basis |
|---|---|---|
| **H1** — final-period branch defect (empty schedule / period treated as matured) | **Falsified as mechanized** (partially right on locus) | Schedule regeneration is correct on every date (§3 tables: both periods present on 7/15, final period present with correct α and DF through maturity). No branch mishandles the last period. The wrong number *does* enter through the current-stub branch (`idx == 0 → float_rate0`) — but the branch is sound; its **input unit** is wrong, and it is wrong from day one, not only in the final period. |
| **H2** — sub-node curve interpolation returns 0/NaN below 3M | **Falsified** | Curve has 1D (O/N) and 91D nodes on all inspected dates; `df_linear_rate` and `forward_rate_simple` are smooth with no 0/NaN for t ∈ {1D…0.4Y} (dump lines 271-284: DF 0.99993…0.99011, fwd ≈ 0.0250 throughout). |
| **H3** — weekend/holiday date-convention mismatch | **Falsified** | §8: single consistent ModFol layer, ffill fixings, no lookup ever misses; weekend-rolled resets leak identically to weekday resets. The business-day cliff dates are fully explained by T+1 + left-vertex chart reading. |
| **Actual root cause** — decimal/percent double-division of the CD fixing at the service→engine boundary | **Confirmed** | §3-§7: reconciliation closes to ₩1; unit-corrected counterfactuals restore ≈0 reset-day PnL and a sane 7Y trace; all four UI-observed numbers reproduced to the displayed digit (−58,320,000 / −44,410,000 / +4,360,000 / −490,000). |

**Contradictions with the stated invariants** (reported, per instructions, rather than force-fit):

- Invariant 2: the 7Y **is** affected — −1.57bn of its trace is bug (§7). "No cliff" is true only visually.
- Invariant 4: post-cliff daily PnL is −₩0.8k…−₩41k, not exactly 0; it displays as 0 after ₩10k rounding (§5).
- Run B's reported final (−44,410,000): **not reproduced**. The faithful Run B fixture (trade
  2026-01-06, maturity 2026-07-06 — pinned by three exact matches: cliff 04-06/04-07, pre-cliff cum
  +4,361,500 → "+4,360,000", tooltip −491,412 → "−490,000") ends at **−64,572,436**. The reported
  figure equals Run A's final to the won, suggesting the Run B final was read off while the panel
  still showed Run A's trace (the panel auto-retraces on input change; a stale read is easy). Run A's
  final reproduces exactly (−44,408,701 → "−44,410,000").

---

## 10. Minimal fix specification (NOT implemented)

**F1 — unit contract at the engine boundary** (the cliff itself)
- Files: `engine/mtm_valuation.py` (`value_booked_trade`), plus call sites
  `services/npv_trace_service.py:92`, `services/mtm_service.py:42`, `services/portfolio_service.py:97/105`.
- Spec: pick **decimal end-to-end** (matches curve/par-rate convention and the fixings store).
  `value_booked_trade(current_float_rate)` takes a decimal; delete the internal `/100` (line 57) and
  the `*100` on the fallback (line 54). Callers pass `load_fixings()` values unchanged. If instead
  percent is kept, convert at every service call site — but decimal is the smaller, single-point
  change and removes the trap for future callers. Either way, rename the parameter to state the unit
  (`current_float_rate_decimal` / `_pct`), mirroring `quant_engine`'s `_pct` suffix discipline.

**F2 — fixing selection: reset-date, not valuation-date** (secondary; correctness of stub mark & settlement size)
- Files: `services/npv_trace_service.py` (lines 85-90), `services/mtm_service.py` (lines 37-40),
  `services/portfolio_service.py::_extract_float_rate`.
- Spec: the current stub's rate is the CD fixing **as of the stub's reset date** =
  `pay_dates[first_i − 1]` (effective date for the first period), ffilled to the prior business day
  per desk convention — not the latest fixing ≤ valuation date (npv_trace) and never
  `max(fixings.keys())` (mtm/portfolio — this is look-ahead into the future on historical dates).
  Cleanest shape: pass the whole `fixings` dict into `value_booked_trade` and resolve the reset date
  next to the schedule, where `first_i` already exists; that also fixes the crediting loop's coupon
  amount for free since cashflows inherit the stub rate.

**F3 — tooltip DV01** (secondary; independent of F1/F2)
- Files: `services/npv_trace_service.py:100`.
- Spec: replace the annuity proxy with bump-and-reval: rebuild the curve from `snapshot` with all par
  rates +1bp (curve_cache makes this cheap), revalue with the fixing held constant, report
  `−(NPV_up − NPV_base)`. Expected values: ≈ −245k/bp with an unfixed 3M period remaining; ≈ −0.1k/bp
  after the final fixing is set; never ≈ 2× around payment dates.

**F4 — regression tests** (`tests/`), the 5M/6M/9M/1Y/7Y × pay-fixed ₩10bn matrix:
1. *Unit guard*: current-stub `CashFlowDetail.rate` must be within [0.5×, 2×] of the CD fixing
   (decimal) on every valuation date — catches any future double-division immediately.
2. *Reset-crossing continuity*: for each tenor, |daily_pnl on the first traced date ≥ each pay date|
   ≤ N × 5bp (₩5m at ₩10bn) on the real dataset; on a synthetic flat-curve fixture, ≈ ₩0 ± ₩100k.
3. *Settlement identity*: credited float coupon == N × fixing(reset date) × accrual, to ₩1.
4. *Post-final-reset behavior*: daily PnL reflects only accrual/discount (bounded, nonzero) and cum
   at maturity equals the sum of true realized settlements plus the entry mark, to ₩1.
5. *7Y sanity*: lifetime cum within a few ₩m of Σ N·(CD_fix,k − F)·α_k (realized carry) given
   terminal MtM = 0 — this is the test that would have caught the −1.57bn silent leak.
6. *Loader contract*: `load_fixing_history*` values ∈ (0.001, 0.2) (decimal), paired with an
   engine-side assertion/type (e.g. a `DecimalRate` NewType) so the two ends of the contract are
   pinned by the same test module.
