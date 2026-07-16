# REPORT — s19: Entry Signals Backtest Defect — Diagnosis (no fixes)

- **Branch:** `s19/es-backtest-diagnosis` in own worktree `wt-s19-fe`, off s17 head `706c2d1`. No BE branch — Step 0 establishes the backtest never touches the backend.
- **Nothing repaired.** Product code untouched. Two disclosed non-defect edits: (1) new diagnosis artifacts (helper + xfail tests + harness scripts under `docs/session-s19/`), (2) a one-line **test-typing** cast in `staged-flow.test.tsx` (`getByRole(...) as HTMLButtonElement`) — a pre-existing s17 typing error that a full tsc run surfaces; without it the tsc gate cannot pass. **Gate-record correction: REPORT_s17's "tsc clean" claim was wrong** — the same error reproduces at `706c2d1` in the untouched s17 worktree (tsc 5.9.3); the s17 check appears to have been an incremental-cache false pass.

## Gates

| Gate | Result |
|---|---|
| vitest | **181 passed + 3 expected-fail (184)** — baseline 181/181 unchanged; the 3 new tests are `it.fails` xfails that fail *as designed* (verified: suite would break if they started passing) |
| tsc / build | clean / clean (after the disclosed test-typing cast) |
| eslint repo-wide | **21 errors / 26 warnings — exactly the inherited 21-error baseline**; new files contribute zero |

---

## Step 0 — Where the backtest computes

| Question | Answer |
|---|---|
| Backtest | **100% frontend**: `src/lib/math/backtest.ts` (`simulateMeanReversion`), invoked via `use-pinned-backtest.ts` from `store.lastRun`. The backend `/api/spread-backtest` (`useSpreadBacktest`) has **zero call sites** — orphaned since iv2. No BE branch needed. |
| KPIs (trades/net/win/Sharpe/MDD) | `result.summary` of that one sim → `BacktestPanel` tiles. Full-domain by construction. |
| Cumulative P&L series | `result.points[].cumulativePnl` of the **same** sim → equity chart. Covers **every** input date from index 0; `cumulativePnl` starts at 0 (code + verified on all three configs). |
| Equity chart L/S/× markers | Derived from `result.trades` — **same source** as KPIs. |
| Oscillator SHORT/LONG markers | **DIFFERENT source**: `zscore-oscillator-panel.tsx` re-derives markers as *first crossings of \|z\| ≥ entryZ* from the **live** params — no position state, no exit/stop rules, not the trade list. |

So (2) and (4) share one source; (3) is split. The oscillator-marker split is a real, independent finding (Defect R1 below) — but it is not what produced the captures' morphology; that is Defect R2.

## Reproduction (numbers actually obtained, live data 2010-03-02…2026-07-15)

| Config | Expected | Got (harness ≡ live KPI tiles, screenshots attached) |
|---|---|---|
| A: 국고 10Y−3Y, 60D, 3σ (store defaults otherwise) | 35 trades, net 70.4M | **24 trades, net 10,600,000**, win 54% (series: 2,592 bars, 2016-01-04→2026-07-14 — 국고 history starts 2016). Live tiles identical (`repro-A-ktb-3sigma.png`). **Chart morphology of the capture reproduces exactly**: one `L`, one `LONG`, one rise then flat, left edge non-zero (+230만 = net − last trade +8.3M). |
| B: iv3 diagnostic (IRS 10Y−3Y, defaults — instrument recovered from `docs/integration-v3/t6-trade-rows.json`) | 92 trades, net 71.45M, hold 5/30/104 | **92 trades, net 71,450,000 — exact.** Holding (full domain): min 1 / med 11 / max 81. iv3's 5/30/104 was computed over `n_visible: 13` virtualized grid rows (their own artifact says so) — a measurement artifact, not a sim discrepancy. |
| C: s17 live check (IRS 3Y, defaults) | 69 trades, net −4.3억, dense 2022–23 labels | **69 trades, net −432,400,000, win 43%, Sharpe −0.59 — exact.** |

**The A-capture's KPI pair (35, 70.4M) is not reproducible**: swept 4 instruments × lookback {20,40,60,90,120} × entry {1.5…3.5} × exit {0.25…1.5} × stop {3,3.5,4,5,∞} ≈ 2,000 configs — **0 hits** (`sweep3-output.txt`). The pair as recorded is internally inconsistent with any single full-domain run on today's data (which is the same dataset as the capture date). The capture's *chart description*, however, is fully explained (below) — best numeric match: IRS 10Y−3Y @ 2σ, whose window-edge cumulative is 65.3M (~"64.5M" read off an axis) with the last trade +6.15M LONG 2026-03-24→05-07 ("single ~6M step around 2026-03", net 71.45M ≈ "70.4M"). Suggestive, unprovable: at a 640px pane the same run has exactly **35** trade entries inside the clamped window. **Per the standing rule: the prompt's framing of capture A's numbers is wrong** — they cannot all have come from the KPI tiles of one run.

## T1 — Marker correspondence (bijection over tuples, all three configs)

**Equity chart (markers from trades):**

| Check | A | B | C |
|---|---|---|---|
| Injective (no orphans) | PASS | PASS | PASS |
| Surjective (no missing) | PASS | PASS | PASS |
| Aligned / on-bar (exact time ∈ bar array) | PASS | PASS | PASS |

Trade dates are members of the master date array *by construction* (`dates[entryIdx]`/`dates[i]`), and the equity series' bars are those same dates — the data handed to the chart is complete and correct. The "missing" L/× markers are **rendered off-window**, not absent (see `repro-B-irs-spread-2sigma-maximized.png`: the same run, maximized, shows all of them).

**Oscillator (crossing markers vs trade entries):**

| Config | Trade entries | Crossing markers | Orphans (marker, no trade) | Missing (trade, no marker) | On-bar | First break |
|---|---|---|---|---|---|---|
| A | 24 | 29 | 9 | 4 | PASS | missing `2016-11-11 SHORT` entry; orphan `2016-06-24 LONG` |
| B | 92 | 154 | 80 | 18 | PASS | missing `2015-01-15 LONG`; orphan `2010-06-25 LONG` |
| C | 69 | 171 | 116 | 14 | PASS | missing `2011-08-10 LONG`; orphan `2010-09-09 LONG` |

Not injective, not surjective, in every config. Orphans = crossings while a position is already open (no new trade); missing = re-entries after a stop-exit while \|z\| stayed above entry (no fresh crossing). **The oscillator's markers were never trade markers.**

## T2 — Hypothesis verdicts (none left "possible")

- **H1 — Windowing: CONFIRMED, as the root mechanism — but render-side (viewport), not a data slice.** The data arrays are full-domain (T1; `points[0].cumulativePnl === 0` everywhere). Two concrete sub-mechanisms, both demonstrated live:
  - **R2a — fitContent mount race.** When the market data is already cached (the owner's normal path — other tabs warm the query cache), `setData` + `fitContent` run in the same mount commit and the fit does not take effect; the chart renders lightweight-charts' default `barSpacing: 6` → last ~`paneWidth/6` ≈ **~95 bars** (Mar–Jul 2026). Today's captures of A, B, C all show this window.
  - **R2b — `minBarSpacing` ceiling.** When data arrives *after* mount (s17's throttled captures), fitContent applies but lightweight-charts clamps `barSpacing ≥ 0.5` (default; dist line 12348) → at 640px at most **1,280 bars** visible → left edge ≈ 2021/2022 for a 4,040-bar history. A full history can never fit a pane narrower than ~2,020px.
  - Discriminators that decided it: (i) same config C shows a ~95-bar window today vs a ~1,280-bar window in s17's throttled capture — the *only* variable is data-arrival timing; (ii) maximizing the ChartFrame (remount at ~1,500px) reveals years more history and dozens of markers from the same arrays; (iii) the cumulative series' first *data* value is 0, while its first *visible* value equals the harness-predicted accrual left of the window edge (A: +2.3M; B@640: +19.75M; C@640: −236M).
- **H2 — UTC/KST marker misalignment: REFUTED.** Every marker time is a member of the bar array (T1 on-bar PASS ×3 configs ×2 charts). No `toISOString`/timezone transform exists in the marker path (dates flow as-is from the master array). The documented `baseDate` bridge instance is the Simulation slice's family (s18), not present here.
- **H3 — Index axis vs date markers: REFUTED for these charts.** All ES series use calendar date-strings via `alignToDates`; markers carry the same strings. The *sync* is index-based, but all synced series share one master array by design. **Flagged for the fix pass (not the captures' cause):** post-s17, the pinned equity chart and the live z-score chart can hold *different* date arrays after a refocus-without-rerun; index lockstep would then align different dates across panels.
- **H4 — Label-collision culling: REFUTED.** lightweight-charts does not cull overlapping labels — the dense captures show overlapping text soup, and in-window marker counts match the arrays. Cosmetic only.
- **H5 — Realized-only P&L mislabeled: REFUTED.** The sim daily-revalues open positions (`dailyPnl = position·notional·Δvalue`): C has 2,056 days with `dailyPnl ≠ 0` against 69 trades; the curve drifts intra-trade and is flat only when the position is 0 — which is *correct* for cumulative P&L. The "step function" reading is the tail-window zoom plus short holdings (median 11–22 days). The 35-capture's "single step" = exactly one trade inside its ~95-bar window. The s17 prompt's "no daily revaluation" framing was wrong.
- **H6 — Non-zero seed: REFUTED.** `cumulative` starts at 0 in code and in all three data dumps. "Starts at ~64.5M" is the value at the window's left edge (H1), matching the harness arithmetic to within axis-reading error.

## Root cause — one mechanism for all three symptoms

**The sim, KPIs, cumulative series, and equity markers are a single, correct, full-domain source. The charts render only a tail window of it — sized by two render-side accidents (fitContent mount race → ~95 bars; `minBarSpacing` 0.5 ceiling → ~1,280 bars at 640px) — while the KPI tiles aggregate everything.** That one mechanism produces: the "64.5M start" (accrual left of the window edge), the "single step" (one trade in a ~95-bar window), the "missing markers" (rendered off-window), and the 35-vs-69 **density inversion** (the two captures sat in different window regimes — ~95-bar race window showing 1 crossing vs ~1,280-bar clamped window showing dozens; demonstrated on a single config, C, across my s17/s19 captures). On top of it sits the **independent second defect**: the oscillator's SHORT/LONG markers derive from raw z-crossings, not trades, so even a fixed window will show markers that don't correspond to the KPI trade list (T1 fails both directions).

## T3 — Executable evidence (all `it.fails`, must not be weakened)

- `src/features/entry-signals/marker-trade-correspondence.ts` — the reusable bijection helper (`checkCorrespondence`: injective / surjective / on-bar over exact tuples) plus mirrors of both shipped marker constructions; this is the fix pass's acceptance criterion.
- `src/features/entry-signals/backtest-defect-s19.test.ts` — 3 expected failures: (R1) oscillator markers biject with trade entries; (R2b) chart options allow fitContent to fit a full history in a 640px pane (`4040 × minBarSpacing ≤ 640`); (R2a) every KPI-reported trade is visible in the default render window. The R2a race itself is not encodable in jsdom (no real layout); its live evidence is the same-config window difference above.

## Evidence index (`docs/session-s19/`)

`harness.mts` + `harness-output.txt` (full T1/window dumps) · `sweep.mts`/`sweep2.mts`/`sweep3.mts` + outputs (the 35/70.4M search, 0 hits) · `repro-A-ktb-3sigma.png` (defect morphology on the stated config, KPIs 24/10.6M) · `repro-B-irs-spread-2sigma.png` + `repro-B-irs-spread-2sigma-maximized.png` (the width/remount discriminator) · `repro-C-irs3y-2sigma.png` (vs s17 `docs/session-s17/04-results-stale.png` — same config, different window regime).

## For the fix pass (scope, not fixes — nothing here was changed)

1. R2: make the full domain renderable and fitted — address both the mount-timing of `fitContent` and the `minBarSpacing` floor (and note ChartFrame maximize/remount re-runs the same race).
2. R1: derive oscillator entry markers from the trade list (helper's `tradeEntryMarkers`) or visibly label the crossings as signals-not-trades — owner wording decision.
3. Flagged secondaries: pinned-vs-live date arrays under index-based sync (post-s17); iv3-style measurements over virtualized grids report `n_visible`, not totals.
