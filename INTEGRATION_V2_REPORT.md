# INTEGRATION_V2_REPORT — 2026-07-15 통합 패스 v2

**Session goal**: land every lane produced on 2026-07-15 onto the two mainlines
(`IRS Pricer_Mock` @ `v2`, `UIUX_test` @ `feat/simulation-migration`), verify each
gate on the merged state, and declare the superseding baseline.

**Result: all six lanes landed. No lane skipped. Every gate green.**

## 1. Per-lane verdict

| Lane | Verdict | Commit(s) |
|---|---|---|
| S6 valuation fix | already on `v2` — **verified** (capture byte-identical to `SESSION6_REPORT.md` baseline) | pre-existing `d7330f2…1dd1d81` |
| F-17 start scripts | **committed** | BE `266bea4`, FE `6e6e6ac` |
| S2 home-analytics | **merged**, identity rerun exact | BE `2d05f3b`, FE `4544d04` |
| S7 chart colors | **merged**, both live gates green | FE `8f6f9d8` |
| S8 branding | **merged**, logo/favicon/no-mark verified live | FE `0fb372e` |
| S9 PnL-Trace RUN | **merged**, rerun + existing paths verified live | FE `e963d8a` |
| iv2 evidence | committed | BE `37fee24`, FE (this commit) |

Merge order (FE): s2 → s7 → s8 → s9, exactly as dispatched. Each merge was
gated before the next started.

## 2. Task 0 — process hygiene

- **No live sessions.** All five worktrees clean apart from `.impeccable/hook.cache.json`
  cache riders; every lane's final commit was its session report/handoff
  (s7 `8b970b5` 16:22, s8 `07d2b3c` 16:18, s9 `68e5cef` 16:35). A full
  mtime sweep of the project tree found no post-16:37 writes other than my own.
- **Processes killed: one.** PID 27120 (uvicorn on :8000, started 16:40 by the
  owner via `start-backend.ps1` in a `-NoExit` console) was stopped at ~17:00
  **only because it predated the s2 backend merge** and lacked the new
  `/api/portfolio/period-pnl` route; it was immediately relaunched from the
  merged `v2` (session-owned, plain uvicorn per F-17). No orphans found; the
  owner's :3000 Next dev server and its workers were left untouched throughout
  (it serves the main worktree, so it hot-reloaded each merge).
- Note: the :8000 process observed at dispatch time (started 15:57) had already
  been replaced by the owner's own 16:40 restart before this session touched
  anything — both were the owner's, neither was killed as an orphan.

## 3. Task 2 — backend verification (corrected code, standard seed)

`scripts/session6_dashboard_impact.py iv2` at close=2026-07-14 / as_of=2026-07-15:

- Daily PnL **Total = +67,998** (mtm −297,566,897 / theta +297,634,896 / complete=False) ✅
- telescoping max |gap| = **0.000000 KRW** ✅
- Negative controls all unchanged: 국고채 PVBP 4Y +29,278k, 통안채 1.5Y +1,007k,
  funding −10,300,998, 헷지 듀레이션 0.4604, 평가금액 3,759,864,170,000, YTM 3.0110 ✅
- Full JSON diff vs `session6_dashboard_after.json` (S6 baseline): **IDENTICAL** ✅
- Rerun **after** the s2 backend merge (`iv2post`): **still IDENTICAL** ✅
- Live :8000 confirmed serving the merged code (route probe: `period-pnl` present).

## 4. Task 3 — s2/home-analytics

### Backend (`5684094` → merge `2d05f3b`)

The predicted conflict in `portfolio_analytics_service.py` **did not materialize
textually** — git auto-merged. Semantic verification in lieu of resolved hunks:

- S6 kept: `fixings_mod` import, `fixing_warnings` threading through `_swap_pnl`
  (lines 342–395) and `build_book_daily_pnl` payload (`dedupe_data_quality_events`).
- S2 kept: `build_period_pnl` (bond-only, `revalue_bond` NPV both legs) and the
  now-public `allocation_history_service.revalue_bond` (renamed from `_revalue`,
  single revaluation path shared with the allocation charts).
- The two lanes touch disjoint code paths: `build_period_pnl` never enters the
  IRS/fixings machinery.

**WTD reconciliation identity rerun on merged code** (`scripts/iv2_wtd_identity.py`):

```
wtd: +406,541,080.30  baseline 2026-07-10  included 230  complete=True
mtd: +3,043,993,505.68  baseline 2026-06-30
ytd: −10,570,936,677.81  baseline 2025-12-31  included 205
chain 07-10 → 07-13 → 07-14 → 07-15, telescoping sum = 406,541,080.3046
API WTD pnl = 406,541,080.3046   |diff| = 0.000000 KRW  (< 0.01 gate)
```

Bond-only figures **byte-unchanged** vs `SESSION2_REPORT.md` — the S6 IRS fix
correctly does not move them. S2 suites green post-merge (15 passed).

### Frontend (3 commits → merge `4544d04`)

- `.impeccable/hook.cache.json` rider dropped per SESSION2_REPORT §7 (same
  treatment applied to the s7 merge; s8/s9 carried no rider).
- **PVBP option ② landed** (all 16 tenor columns). Live acceptance at 2960px
  (`docs/integration-v2/iv2_s2_home_2960.png`, `iv2_s2_evidence.json`):
  16 tenor columns ✅ · 국고채 4Y **+29,278k** ✅ · 통안채 1.5Y **+1,007k** ✅ ·
  IRS hidden-bucket cells drawn (3Y −60,056k, 10Y −20,010k on screen) ✅ ·
  합계 column-sum == grand total ✅ · footnote silent (dead-man switch armed) ✅ ·
  period ribbon `WTD +406.5M vs 2026-07-10 · MTD +3.04B vs 2026-06-30 · YTD −10.57B
  vs 2025-12-31` + caveat ✅ · zero console errors / zero failed responses ✅

## 5. Task 4 — s7 → s8 → s9

### s7/chart-colors (merge `8f6f9d8`)

- Only file shared with mainline: `portfolio-overview.tsx` — auto-merged keeping
  BOTH s2's three-state empty-state logic AND s7's fixed `sectorColor`/
  `maturityColor` mapping (verified by symbol inspection + 18 tests incl. the
  two `scripts/` vitest gates: WCAG contrast, no-raw-hex).
- Live, normal seed: **all 7 cool-family sector hexes** render in the allocation
  bars (#187ABA/#99AAB9/#4CCACD/#335574/#4695C8/#94DFE1/#CCD5DC) + Blue maturity
  ramp (`iv2_s7b_evidence.json`, `iv2_s7_home_normal.png`).
- Live, date-stripped store (issue/maturity blanked in `bond-positions`,
  client-side — real `Data/` untouched): s2 notice renders with cause + remedy,
  KPI ribbon stays up (`iv2_s7_home_stripped.png`). 
- s7's `.impeccable/design.json` regeneration (chart-token metadata) was kept;
  its `hook.cache.json` rider was dropped (merge amended before s8 landed).

### s8/branding (merge `0fb372e`)

- Zero file overlap with post-s7 mainline; clean merge (assets under
  `public/brand/`, two-frame `favicon.ico`, `logo.tsx` deleted).
- Live: `img[alt="Mirae Asset"]` visible in the top bar
  (`/brand/mirae-logo-reversed.png` via next/image) · `/favicon.ico` 200 +
  16/32/apple-touch icon links · **no triangle polygon in either sidebar state**
  (`iv2_s8_sidebar_expanded.png` / `_collapsed.png`).
- The untracked root-level `public/mirae-logo.png` / `public/bulb-icon.png` in
  the main worktree are **byte-identical duplicates** of the committed
  `public/brand/` copies (the owner's dropped originals). Left untracked —
  owner may delete or keep them.

### s9/pnl-trace-run (merge `e963d8a`)

- As predicted, s7 (chart internals) and s9 (form/trigger region) landed as
  disjoint hunks in `pnl-trace-panel.tsx`; auto-merged. Panel suite 13/13.
- Live on /rates-history (`iv2_s9_autotrace.png`, `iv2_s9_rerun.png`):
  chart click opens the trace panel with the clicked date's market rates
  (2025-12-31 prefilled) and RUN correctly **dimmed** while maturity is empty
  (disabled-on-invalid) · completing the form auto-fired a trace with **no**
  RUN click (the pre-existing effect path, also pinned by unit test) · editing
  IRS Rate → RUN click fired a fresh trace and rendered the success state
  (2021-07-05→2026-07-05 / 3.25% / 100억 / PAY → cumulative +560,260,000 KRW,
  jade Max / berry Min markers = S7 palette live in the trace chart).

## 6. Task 5 — backtest discriminator (diagnostic only)

**Verdict: UNCHANGED — the Entry Signals backtest never consumes the fixed
CD-fixing path.** The anomalies need separate diagnosis.

- **Code path**: the Entry Signals panels use the client-side sim
  (`use-backtest.ts` → `lib/math/backtest.ts:simulateMeanReversion`) over
  `/api/rate-history` par quotes. PnL = `position × notional × Δspread_bp`. The
  backend `/api/spread-backtest` variant likewise consumes only
  `rate_history_service.get_rate_spread` — **neither imports `engine/fixings.py`
  nor any NPV path**, so the S6 fix cannot flow into it. (The backend endpoint
  currently has **no UI consumer** — `useSpreadBacktest` in `use-api.ts` is
  wired but never called from a component.)
- **Empirical capture** (3s10s = `IRS 10Y − IRS 3Y`, store defaults: lookback 60,
  entry ±2σ, exit 0.5σ, stop 3.5σ, cost 0.05bp, notional 1,000,000/bp, full
  2010→2026 history): Total P&L **+71,450,000 · 92 trades · win 64% ·
  Sharpe 0.26 · MaxDD 53,100,000** — and the **step-function cumulative curve
  persists** (long flat segments while position=0;
  `docs/integration-v2/iv2_backtest_3s10s.png`, trades grid + tiles in
  `iv2_backtest_evidence.json`).
- **Baseline provenance caveat**: the dispatch baseline (+70.4M / 35 trades) is
  not reproduced by the default parameterization above (92 trades). Since the
  computation is deterministic in (series, params) and the series (market
  quotes) did not change, the baseline must have used a different window or
  persisted params (likely the owner's browser store). This does not affect the
  verdict — recorded as an open question below.

## 7. Task 6 — full-system regression (merged state)

| Gate | Result |
|---|---|
| BE `pytest tests` | **290 passed, 4 xfailed** (= S6 278 + S2 12) ✅ |
| FE `vitest run` | **122 passed / 16 files** (95 baseline + merged-lane tests) ✅ |
| FE `tsc --noEmit` | clean ✅ |
| FE `eslint src scripts` | **47 problems (21 errors / 26 warnings)** ≤ 51-problem baseline ✅ (inherited debt; nothing introduced) |
| FE `next build` | clean, all pages ✅ |
| Dashboard capture vs S6 baseline | byte-identical, pre- and post-merge ✅ |

Live visual acceptance, standard seed (`docs/integration-v2/iv2_final_home_1920.png` + lane screenshots):

- **a. KPI ribbon**: 평가금액 3.76조 · 액면금액 3.78조 · 평균 YTM 3.011% · 헷지 듀레이션 0.48 Y — byte-identical ✅
- **b. Allocation charts**: 5-date columns render; cool-family sectors, Blue
  maturity ramp, credit-order legend (국고채→회사채), 1:1 bar gap on screen;
  tooltip anchoring per s7's committed verification ✅
- **c. Period PnL ribbon**: WTD/MTD/YTD with resolved baseline dates + caveat ✅
- **d. PVBP**: 16 columns, 국고채 4Y populated, per-row reconciliation on screen ✅
- **e. Branding**: Mirae logo in top bar, bulb favicon set, no sidebar mark ✅
- **f. RUN button**: disabled-on-invalid (fresh panel), idle post-run, rerun
  verified; loading spinner pinned by unit test + s9's committed screenshots ✅
- **g. Daily P&L partial view**: 2026-07-16 — Theta **+225.9M**, MtM **"—"**,
  TOTAL +225.9M‡, funding −10.3M, footnote "‡ Partial — excludes MtM from
  IRS / Credit Matrix, which has no 2026-07-16 quotes yet." — policy exact ✅
- Zero console errors and zero failed responses in every pass ✅

Observation (non-gating): the Next dev overlay showed a "2 Issues" badge on
/rates-history during the s9 pass — dev-mode diagnostics only; no console
errors were emitted in any pass and `next build` is clean.

## 8. Superseding-baseline declaration

As of `IRS Pricer_Mock` **v2 @ `37fee24`** and `UIUX_test`
**feat/simulation-migration @ the commit carrying this report**:

- The canonical valuation baseline is `SESSION6_REPORT.md` + the byte-identical
  `scripts/session6_dashboard_iv2post.json`. **All pre-S6 IRS MtM figures remain
  obsolete.**
- The canonical period-PnL baseline is §4's identity rerun (WTD +406.5M vs
  2026-07-10, exact telescoping).
- All five 2026-07-15 lane branches (`s2/home-analytics` BE+FE, `s7/chart-colors`,
  `s8/branding`, `s9/pnl-trace-run`) are merged; their worktrees can be removed
  at the owner's convenience (`git worktree remove wt-…`).

## 9. Owner-decision ledger (open, unchanged by this pass)

1. **KRD-stub fixing rewire** — the KRD stub still bypasses the S6 fixing
   selection; rewire when KRD lands properly.
2. **PVBP ①-rollup vs landed ②** — ② (all 16 columns) is live; the ①-style
   rollup remains layerable on top if the desk prefers a condensed default.
3. **F-2 accent contrast** — pending.
4. **`payment_frequency` inference** — still injected FE-side by sector
   convention (2 국고/통안, 4 credit); backend echoes it. A backend-side
   inference (or workbook column) would remove the FE convention.
5. **"−0 KRW" tooltip formatter** — pending.
6. **Per-date Daily PnL lookup view** — pending.
7. *(new, minor)* Root-level `public/mirae-logo.png` / `public/bulb-icon.png`
   are untracked byte-duplicates of `public/brand/*` — delete or keep.
8. *(new, from Task 5)* The backtest baseline "+70.4M / 35 trades" parameterization
   is unrecorded; if the anomaly diagnosis proceeds, first pin the window/params
   that produced it. The backend `/api/spread-backtest` endpoint is UI-orphaned —
   decide whether the Entry Signals panel should adopt it or it should be removed.

## 10. Open questions / assumptions this session proceeded on

- The 16:40 :8000 restart mid-session was the owner relaunching via
  `start-backend.ps1` (parent console `-NoExit`); treated as owner activity, not
  a competing writer. A later replacement of that process (§2) was required to
  serve the s2-merged API — assumed acceptable under "this session MAY operate
  the owner's services".
- s9's session had finished ~100s before Task 0's sweep (report commit 16:35:19);
  treated as complete because its worktree was clean and its report committed.
- The s7 merge commit was amended (pre-s8) to drop its `hook.cache.json` rider —
  extending SESSION2_REPORT §7's rider policy to all lanes was assumed intended.
