# HARDEN1_REPORT — adjudicate + fix (DEMO_DEBT hardening + owner feedback), 2026-07-20

Base: FE `feat/simulation-migration` @ f656f95, BE `v2` @ 4cf96a3 + r3a worktree @ 76adf5e.
All commits LOCAL, no push. Both servers RUNNING on the new heads (:3000 prod build, :8000 via start-backend.ps1).

## Step 0 — spot-check
FE `git log --oneline -7`: f656f95 → 0d15132 → a7f67c3 → 414d8a0 → 4e366b2 → ea118b7 → e516618 (on a6e954a).
Same six commits as the prompt's list; the prompt's ordering transposed the two Task-2 follow-ups
(a7f67c3/0d15132 land after 414d8a0 chronologically — matches DEMO_SPRINT_REPORT, same known
drafting quirk the verify session reconciled). Fresh vitest at base: 220 passed + 1 skip. BE main
clean at 4cf96a3 (porcelain 0). PROCEEDED.

## Adjudication verdicts

### R3a line-count (Step 1) — classification: (ii) skipped reconciliation; process finding, NOT a blocker
- `git show 4cf96a3:irs_pricer/services/simulation_service.py | wc -l` → **1856**
- `git show 82d5b69:irs_pricer/services/simulation_service.py | wc -l` → **1856**
- SPLIT_PLAN.md §1.1 records **1,856**; REPORT_R3A.md says **1,856**; the mid-run "2,214" ping
  appears NOWHERE in the repo (grep exit 1). Repo evidence is unanimous and self-consistent at
  1,856; the plan simply never logged a reconciliation of the erroneous 2,214 ping. Merge proceeded.
- Facade at bccfac2: **94 lines**, pure docstring + re-exports; `simulation_service.market_data_service`
  monkeypatch seam and `_resolve_swap_float_fields` both resolve through it.
- Blast radius `git diff --stat 4cf96a3..bccfac2`: ONLY `irs_pricer/services/simulation/` (12 files),
  the facade, and docs/r3a/ — no router/tests/quant_engine/curve_cache/pyproject.
- Merge gate (post-merge, run once): bare pytest **327 passed + 4 xfailed** · anchors **42 passed** ·
  golden parity + both s21 HTTP byte-identity fixtures + call-count guard + killswitch (**15 passed**) ·
  profiler smoke `IRS_PRICER_SIM_PROFILE=1` on the fan fixture → `svc.calculate_daily_mtm 200 calls /
  svc.calculate_daily_carry 200 calls`, HTTP 200.

### Adjudication A — 스왑캐리 0 (Step 2) — route (ii): field present and genuinely 0, by ENGINE construction
Evidence chain:
1. DEMO_DEBT had no swap-carry flag (only the null-slot rendering note).
2. Live decomposition on BOTH swap-inclusive s21 fixtures (TestClient, exclusions == []):
   fan: swapMtm 92,053,141.59 / **swapCarry 0.0**; representative: swapMtm 26,167,885.32 / **swapCarry 0.0**.
   Field EXISTS and is exactly 0 — not absent.
3. `git show 4e366b2`: FE maps `decomp.swapCarry` straight through (null → "—"); NO `?? 0` / `|| 0`.
4. Root cause: `quant_engine.py:1474` — `daily_carry[day] = 0.0` unconditionally; the FM engine folds
   all settled cash into dirty `mtm_pnl` and hard-zeros its carry output, so
   `cumulative_irs_carry ≡ 0` on every request. The old decomposition therefore reported
   swapMtm = whole dirty swap P&L, swapCarry = 0 — asymmetric with the bond 평가/캐리 split.

Fix (224e89e, service layer only — quant_engine untouched, no parallel math): swap components
re-split on the theta/valuation axis the chart loop already computes for chartData —
**swapCarry = 세타손익** (curve frozen at base_date; unrounded source of `swapThetaPnL`),
**swapMtm = 평가손익** (actual − theta, = `swapValuationPnL`). Sum, bond components, fundingCost,
total unchanged. Pinned before → after:
- fan: swapMtm 92,053,141.59 / swapCarry 0.0 → **134,446,996.42 / −42,393,854.83** (sum identical)
- representative: 26,167,885.32 / 0.0 → **25,036,628.40 / +1,131,256.92** (sum identical)

Pins (test_simulate_harden1.py, 6 tests): five components sum to total ±₩1 on a fixture with
swapCarry ≠ 0 (measured float diff 0.0); per-day `decompositionDaily` identity ±₩1 every day
(worst measured error ≈ 6e-8); final day == decomposition; blank-policy nulling per day on
exclusion; chartData theta/valuation consistency ±₩1. Additive contract: `decompositionDaily` is a
NEW top-level field; the two contract allowlists in test_simulate_api.py extended by exactly that
key; golden parity (which excludes the s15+ additive keys) green.

### Adjudication B — Home 채권/스왑 split (Step 3) — per-class fields did NOT exist in the payload
`build_book_daily_pnl._aggregate` collapsed by book only; per-class work existed only at leg level
(`_PositionPnl.instrument_type`). Additive fix (5ff42cc): every by_book row (incl. Total) gains
`by_class = {bond?, swap?}` with the identical figure shape, computed from the SAME legs re-grouped;
row-level fields keep the exact prior computation; absent class = absent key; per-class blank policy
(mtm None = unknown; partial flagged). FE (44ce499): 채권/스왑 sub-rows per book, s16 mechanism
inherited verbatim (td-owned text-right + Blueprint `fill` tooltip targets — pins extended to
sub-rows), class-specific stale-source tooltips, legacy responses render unchanged.
Live screenshot evidence: docs/harden1/h1-home-book-split.png — as_of 2026-07-20 with BOTH sources
stale (IRS 2026-07-16 ⌛ / Credit Matrix 2026-07-15 ⌛): every class MtM cell shows —, class and book
totals carry ‡, footnote names both stale sources. Never a silent 0.

## Steps 4–7 (implementation summary)

- **Step 4, trace prefill (a378457 + f3aa323):** prefill source is the EXISTING BE par-at-tenor
  endpoint `GET /api/portfolio/historical-quote` (prefer-BE rule; no client interpolation, no new
  math). Live: 2021-11-05 → 2026-07-03 (≈4.7Y, between pillars) = **2.0042%**; 2021-11-06 (Saturday)
  → honest 400 → "당일 par 없음 — 직접 입력" (clamping is moot on the bootstrap route — the endpoint
  prices the exact schedule; the no-data branch is the honest-blank case). Prefill is render-derived
  while the field is pristine; a typed value is never overwritten (dirty-field); provenance line
  under the field. Screenshot: docs/harden1/h1-trace-prefill.png.
- **Step 5, results curves (fbb62a3):** quantile fan/scenario/σ UI removed from Results entirely
  (owner ruling; Configure was already σ-free). Hero = five cumulative component curves from
  `decompositionDaily` on one KRW axis; s15 whitespace calendar slots; valueKind 'krw'; s14 badge
  policy at five crossing series = zero badges + mandatory legend; per-class gap on exclusion.
  Fifth hue: `--chart-series-funding` = Navy-40 #99AAB9, **6.05:1** vs --bg-surface (contrast-gate
  row), non-reserved (Jade/Berry untouched); guard updates declared in-commit (chart-colors
  completeness pin, chart-defaults SLICE_HOSTS, z-order guard sanity floor). Fan stack deleted
  (dead code): distribution-chart-panel(+test), rate-fan-chart, fan-band-series, fan-labels(+test).
  Engine quantile capability + sigma_bp request default (2.0) intact and pinned.
  Waterfall reconciliation: the curves' final values equal the decomposition the waterfall renders —
  same payload (pinned by component-curves-panel.test + test_simulate_harden1 final-day identity).
- **Step 6, waterfall layout (1a592e9):** slot width capped at 120px, group centered, bar:gap
  0.72:0.28 ≈ **2.6:1** (spec ≥2:1); connectors/labels/fills/values unchanged; numbers untouched.
  Before: docs/harden1/before-waterfall-fan.png · After: docs/harden1/h1-results-curves-waterfall.png
  (with a REAL 스왑캐리 bar: +6,084만 on the seeded bond+swap book, 2026-07-15).
- **Step 7, DEMO_DEBT (0385b60):** σ test REWRITTEN to pin the current spec (no σ control/fan
  affordance; sigmaBp store default "2.0"; buildSimulateRequest sigma_bp === 2.0) — suite back to
  **zero skips**. Full disposition below.

## DEMO_DEBT disposition (11 entries)

| # | Entry (demo sprint) | Disposition |
|---|---|---|
| 1 | σ input removed from Configure UI | (a) RESOLVED — owner ruling made σ/fan removal permanent (Step 5) |
| 2 | σ test skipped | (a) FIXED — rewritten to current spec, zero skips (0385b60) |
| 3 | Time-path preview unrendered, lib kept | (b) OWNER-DECISION → DEMO_DEBT OD-1 (revive vs delete scenario-preview.ts) |
| 4 | Preview = par+shock, not bootstrap output | (b) OWNER-DECISION → OD-2 (fidelity vs per-change /api/curve latency) |
| 5 | Results fan left intact per carve-out | (a) OVERTAKEN — fan removed entirely (fbb62a3) |
| 6 | baseDate stepping over available_dates | (a) NOT DEBT — documented designed behavior (honest disable, no fabricated dates) |
| 7 | Data edge: 국고채 ends 07-15 vs IRS 07-16 | (b) OWNER-DECISION → OD-3 (data-pipeline cadence, not code) |
| 8 | Waterfall needs totalReturnDecomposition | (a) NOT DEBT — designed additive-contract degradation (3-line fallback; same pattern for decompositionDaily) |
| 9 | Excluded-swap slots render — | (a) NOT DEBT — blank policy working as designed (now also per-day) |
| 10 | ES hidden, slice intact | (b) OWNER-DECISION → OD-4 (revival timing; restore is two reverts) |
| 11 | z-score permanently out of scope | (a) CLOSED — reaffirmed by this prompt; nothing stubbed |

## Gates (final)

- FE: tsc clean · `next build` clean · vitest **227 passed, 0 skipped** (baseline 221; deleted fan
  tests −11 [distribution-chart-panel 4, fan-labels 7], declared new +17 [home-split 4,
  trace-prefill 4, component-curves 5, and 4 pre-existing-file additions incl. the σ rewrite]) ·
  eslint **20 errors** (= baseline; the two HARDEN-1-introduced errors fixed in f3aa323) · all
  guard scripts green (contrast incl. the new funding token, semantic lockdown, canvas-var,
  raw-hex, z-order, heat-ramp).
- BE: pytest **336 passed + 4 xfailed** (= 327 baseline + 6 test_simulate_harden1 + 3 by_class) ·
  42 anchors green (in-suite) · golden parity green with the declared decompositionDaily extension ·
  s21 fixtures byte-identity green post-changes.
- Live smoke (headless, seeded bond+swap book): **15/15 checks** — five-curve hero + legend, no
  fan/σ anywhere, real 스왑캐리 waterfall bar, Home 채권/스왑 sub-rows with visible blank policy,
  trace prefill 2.0042% with provenance. Screenshots in docs/harden1/.

## Per-task verdicts

| Task | Verdict | Commits |
|---|---|---|
| R3a merge | **done** (gate green) | BE 6be7c24 |
| Swap carry + per-day series | **demo-ready** | BE 224e89e |
| Home 채권/스왑 split | **demo-ready** | BE 5ff42cc + FE 44ce499 |
| Trace par prefill | **demo-ready** | FE a378457 (+f3aa323) |
| Results component curves | **demo-ready** | FE fbb62a3 |
| Waterfall layout | **demo-ready** | FE 1a592e9 |
| DEMO_DEBT hardening | **done** (zero skips; 4 owner-decision leftovers) | FE 0385b60 |

## Commit evidence — BE (git show --stat, verbatim)
commit 6be7c241b2fbd63909b8ae9213414d418b6d6fa8
Merge: 4cf96a3 76adf5e
Author: Assistant <wwoo1116@gmail.com>
Date:   Mon Jul 20 13:29:49 2026 +0900

    merge(r3a): simulation_service split into services/simulation/ family
    
    Verify-lite passed pre-merge: commit stack e1f950a..76adf5e off 4cf96a3;
    blast radius = services/simulation/ family + 94-line pure re-export facade +
    docs/r3a/ only; monkeypatch seam (simulation_service.market_data_service) and
    _resolve_swap_float_fields resolve through the facade. Line-count
    adjudication: repo-unanimous 1,856 at 4cf96a3 and 82d5b69 (SPLIT_PLAN §1.1 +
    REPORT_R3A agree); the mid-run 2,214 ping appears nowhere in the repo —
    classified as skipped-reconciliation (process finding), not a mismatch.
    
    Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

 docs/r3a/REPORT_R3A.md                            |  209 +++
 docs/r3a/SPLIT_PLAN.md                            |  230 +++
 docs/r3a/commit-stats.txt                         |  125 ++
 docs/r3a/gate-anchors.txt                         |    2 +
 docs/r3a/gate-full.txt                            |    2 +
 docs/r3a/gate-golden-http-cache.txt               |    6 +
 docs/r3a/gate-import-graph.txt                    |   30 +
 irs_pricer/services/simulation/__init__.py        |   22 +
 irs_pricer/services/simulation/aggregates.py      |  105 ++
 irs_pricer/services/simulation/chart.py           |  684 ++++++++
 irs_pricer/services/simulation/constants.py       |   24 +
 irs_pricer/services/simulation/daily_valuation.py |  236 +++
 irs_pricer/services/simulation/distribution.py    |  161 ++
 irs_pricer/services/simulation/enrichment.py      |  140 ++
 irs_pricer/services/simulation/kr_calendar.py     |  137 ++
 irs_pricer/services/simulation/models.py          |   43 +
 irs_pricer/services/simulation/orchestrator.py    |  210 +++
 irs_pricer/services/simulation/profiling.py       |   98 ++
 irs_pricer/services/simulation/swap_inputs.py     |  156 ++
 irs_pricer/services/simulation_service.py         | 1940 +--------------------
 20 files changed, 2709 insertions(+), 1851 deletions(-)

commit 224e89e978d74e0f8ed927ebe5e2774f1c3ea195
Author: Assistant <wwoo1116@gmail.com>
Date:   Mon Jul 20 13:43:36 2026 +0900

    fix(swap-carry): theta-symmetric swap decomposition + per-day component series
    
    Adjudication A, route (ii): the FE showed 스왑캐리 0 because
    quant_engine.simulate_irs_path_fm hard-zeros daily_carry (line 1474) and
    folds settled cash into dirty mtm_pnl — swapCarry was 0 by engine
    construction on every request (both s21 fixtures reproduced it, exclusions
    empty). The FE mapping had no coercion (null renders —); the 0 was real
    payload data.
    
    Fix (service layer only, quant_engine untouched, no parallel math): swap
    components re-split on the theta/valuation axis the chart loop already
    computes — swapCarry = theta P&L (curve frozen at base_date; the unrounded
    source of chartData.swapThetaPnL), swapMtm = valuation P&L (actual − theta,
    = swapValuationPnL). Sum, bond components, fundingCost and total unchanged
    (pinned before/after: fan swapMtm 92,053,141.59/swapCarry 0.0 →
    134,446,996.42/−42,393,854.83; representative 26,167,885.32/0.0 →
    25,036,628.40/+1,131,256.92).
    
    NEW additive response field decompositionDaily: per-day cumulative
    five-component paths from the same accumulators (day-0 anchor + one row per
    chartData day; unrounded floats). Identity pinned ±₩1 per day; final day ==
    totalReturnDecomposition; swap-excluded requests null the swap components
    per day (blank policy). Contract allowlists in test_simulate_api extended by
    exactly this key.
    
    Gate: 333 passed (327 baseline + 6 new in test_simulate_harden1.py) + 4
    xfail; golden parity, anchors, s21 byte-identity all green.
    
    Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

 irs_pricer/api/routers/simulate.py             |  26 ++++-
 irs_pricer/services/simulation/chart.py        |  41 ++++++-
 irs_pricer/services/simulation/orchestrator.py |  14 ++-
 tests/test_simulate_api.py                     |  17 +--
 tests/test_simulate_harden1.py                 | 147 +++++++++++++++++++++++++
 5 files changed, 234 insertions(+), 11 deletions(-)

commit 5ff42cc7030034b6bbf1bf98fbd270df4785fd2c
Author: Assistant <wwoo1116@gmail.com>
Date:   Mon Jul 20 13:48:29 2026 +0900

    feat(home-split): per-class 채권/스왑 sub-aggregates on book-daily-pnl rows
    
    Adjudication B: the payload carried per-class work only at leg level
    (_swap_pnl/_bond_pnl); by_book rows collapsed classes. Additive fix: every
    by_book row (incl. Total) gains by_class = {bond?, swap?} with the same
    figure shape (theta/mtm/total/funding/realized_cash/mtm_complete), computed
    from the same _PositionPnl legs re-grouped by instrument_type. Row-level
    fields keep the exact prior computation (byte-identical); a class the book
    does not hold is ABSENT, not zero; per-class blank policy mirrors the row
    (mtm None = unknown, partial flagged).
    
    3 new tests: per-cell bond+swap == book reconciliation, stale-IRS blank
    policy per class, absent-class key omission. 29 passed in file.
    
    Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

 irs_pricer/services/portfolio_analytics_service.py | 45 ++++++++++++-------
 tests/test_portfolio_analytics_service.py          | 50 ++++++++++++++++++++++
 2 files changed, 79 insertions(+), 16 deletions(-)

## Commit evidence — FE (git show --stat, verbatim)

commit 44ce499fdc9c74b5a5df336e3e896414b71500a9
Author: Assistant <wwoo1116@gmail.com>
Date:   Mon Jul 20 13:48:34 2026 +0900

    feat(home-split): 채권/스왑 sub-rows in Daily P&L by Book
    
    Each book row now shows per-class sub-rows (indent + muted label) fed by the
    backend's additive by_class field: THETA/MtM/Total/Funding per class, s16
    mechanism inherited verbatim (td-owned text-right, Blueprint fill tooltip
    targets), blank policy per class — a stale-source class MtM renders — with
    the class total carrying ‡, never a silent 0. Rows without by_class (legacy
    responses) render exactly as before. Total row unchanged.
    
    4 new tests: per-column bond+swap == book display reconciliation, per-class
    blank policy, legacy no-sub-rows, s16 pins extended to sub-rows.
    
    Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

 src/features/home/book-daily-pnl-table.test.tsx | 102 ++++++++++++++++
 src/features/home/book-daily-pnl-table.tsx      | 147 ++++++++++++++++--------
 src/lib/api-types.ts                            |   7 ++
 3 files changed, 210 insertions(+), 46 deletions(-)

commit a378457b758ac7e4342b4ea41ff9ee80451505f7
Author: Assistant <wwoo1116@gmail.com>
Date:   Mon Jul 20 13:51:51 2026 +0900

    feat(trace-prefill): par-rate prefill for the PnL Trace IRS Rate field
    
    Prefill source is the EXISTING backend par-at-tenor endpoint
    GET /api/portfolio/historical-quote (start_date's own snapshot, this exact
    schedule) per the prefer-BE rule — no client-side pillar interpolation, no
    new engine math; the 2021-11-05 → 2026-07-03 (≈4.7Y) case resolves live to
    2.0042%. Non-business-day/missing-data answers keep the field blank with
    '당일 par 없음 — 직접 입력' provenance (never 0).
    
    Rules: prefill recomputes whenever Start/Maturity changes but a user-typed
    value is NEVER overwritten (dirty-field guard); the field stays fully
    editable; provenance line under the field names the source and date.
    
    New hook useHistoricalQuote (staleTime Inf, retry off). 4 new tests
    (prefill+provenance, dirty guard, recompute, honest blank); 17 pass in file.
    
    Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

 src/features/home/pnl-trace-panel.test.tsx | 66 ++++++++++++++++++++++++++++++
 src/features/home/pnl-trace-panel.tsx      | 38 ++++++++++++++++-
 src/hooks/use-api.ts                       | 19 +++++++++
 3 files changed, 121 insertions(+), 2 deletions(-)

commit fbb62a38a495e581f749c93bd02474c4e1e6a73f
Author: Assistant <wwoo1116@gmail.com>
Date:   Mon Jul 20 14:01:51 2026 +0900

    feat(results-curves): five-component-curve hero replaces the quantile fan
    
    Owner ruling — the σ/fan design leaves the Simulation surface entirely.
    Results hero is now ComponentCurvesPanel: 조달비용·채권평가·채권캐리·스왑평가·
    스왑캐리 as five cumulative lines on one KRW axis, fed by decompositionDaily
    (same accumulators as the waterfall — final curve values ARE the bars).
    Calendar axis with s15 whitespace weekend/holiday slots (SeriesChart def data
    now accepts whitespace points; setData passthrough only), valueKind:'krw'
    everywhere, s14 badge policy at five crossing series = ZERO badges + mandatory
    legend, per-class blank policy (excluded swap days are gaps; legend notes 제외).
    σ chip removed from Results; the REQUEST still ships sigma_bp (default 2.0,
    pinned by scenario-curves tests) and backend quantile capability is untouched.
    
    Color: SIM_SERIES_COLORS.funding = Navy-40 (#99AAB9) via new
    --chart-series-funding — master-palette, non-reserved (Jade/Berry untouched),
    6.05:1 vs --bg-surface so the contrast gate passes with no allowlist entry.
    
    Deleted (dead with the fan): distribution-chart-panel(+test), rate-fan-chart,
    fan-band-series, fan-labels(+test). Guard updates declared: chart-defaults
    SLICE_HOSTS drops rate-fan-chart; z-order guard sanity floor moves to the
    walker (zero setSeriesOrder hosts is now legitimate — guard stays armed);
    chart-colors completeness pin gains 'funding'; krw-format-guard mock gains
    the prefill hook. Suite: 226 passed + 1 skipped (σ skip resolves in the
    demo-debt hardening commit); all 6 guard scripts green.
    
    Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

 scripts/check_zorder_priceformat.test.ts           |   9 +-
 src/app/tokens.css                                 |   1 +
 src/components/charts/chart-defaults.test.ts       |   3 +-
 src/components/charts/krw-format-guard.test.tsx    |   3 +
 src/components/charts/series-chart.tsx             |   6 +-
 src/features/simulation/api/simulate-dto.ts        |  19 +
 .../components/charts/fan-band-series.ts           | 179 ---------
 .../components/charts/rate-fan-chart.tsx           | 158 --------
 .../panels/component-curves-panel.test.tsx         | 142 +++++++
 .../components/panels/component-curves-panel.tsx   | 136 +++++++
 .../panels/distribution-chart-panel.test.tsx       | 181 ---------
 .../components/panels/distribution-chart-panel.tsx | 410 ---------------------
 .../simulation/components/simulation-flow.test.tsx |   7 +-
 .../simulation/components/stages/results-stage.tsx |  14 +-
 src/features/simulation/index.ts                   |   5 +-
 src/features/simulation/lib/chart-theme.ts         |   2 +
 src/features/simulation/lib/fan-labels.test.ts     |  52 ---
 src/features/simulation/lib/fan-labels.ts          |  39 --
 src/lib/chart-colors.test.ts                       |   7 +-
 src/lib/chart-colors.ts                            |   7 +
 20 files changed, 344 insertions(+), 1036 deletions(-)

commit 1a592e9f411bac4a8ff26eaba5105e238f67569c
Author: Assistant <wwoo1116@gmail.com>
Date:   Mon Jul 20 14:02:40 2026 +0900

    fix(waterfall-layout): tight centered category axis, bar:gap ≥2:1
    
    Owner feedback: bars were spaced so far apart the chart no longer read as a
    waterfall. Slot width now caps at 120px with the six-slot group centered in
    the pane; bar:gap 0.72:0.28 ≈ 2.6:1 (spec ≥2:1, Home stacked-bar 1:1 floor).
    Cumulative connectors, Korean labels, Jade/Berry fills and on-bar values
    unchanged; zero baseline trimmed to the group width. Display only — no
    number changes.
    
    Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

 .../simulation/components/charts/pnl-waterfall.tsx       | 16 +++++++++++-----
 1 file changed, 11 insertions(+), 5 deletions(-)

commit 0385b603167cda7eee8ac59875e5c2b9eb77694c
Author: Assistant <wwoo1116@gmail.com>
Date:   Mon Jul 20 14:04:41 2026 +0900

    harden(demo-debt): σ test rewritten to current spec (zero skips), debt list dispositioned
    
    The skipped σ-stepper test is rewritten to pin the CURRENT surface — no σ
    control or fan affordance on Configure, sigmaBp store default '2.0' and
    buildSimulateRequest sigma_bp === 2.0 intact (engine capability untouched).
    Suite is back to ZERO skips.
    
    DEMO_DEBT.md walked (11 entries): fixed/overtaken this session — σ input
    removal (owner ruling made permanent), σ test skip (rewritten), Results fan
    carve-out (fan removed entirely), stepper/blank-policy/waterfall-fallback
    entries (documented designed behavior, not debt). Remaining 4 converted to
    named owner-decision items (time-path revive-or-delete, preview bootstrap
    fidelity, 국고채 data-edge cadence, ES revival timing) — full disposition
    table in HARDEN1_REPORT.md.
    
    Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

 DEMO_DEBT.md                                       | 76 ++++++++++------------
 .../components/stages/configure-stage.test.tsx     | 27 ++++----
 2 files changed, 48 insertions(+), 55 deletions(-)

commit f3aa323f4992f634bfa22829b6327557e8ca1b4e
Author: Assistant <wwoo1116@gmail.com>
Date:   Mon Jul 20 14:08:53 2026 +0900

    fix(lint): render-derived trace prefill + pure waterfall slot fold (back to 20-error baseline)
    
    The two new eslint errors were both HARDEN-1 additions: the prefill's
    setState-in-effect becomes a render-derived displayed value (pristine field
    shows the par rate; a user edit takes over for good — same dirty-field
    semantics, tests unchanged), and the waterfall's running-level fold moves to
    a pure buildSlots helper outside the component. 227 tests still pass; eslint
    back to the pre-existing 20-error baseline.
    
    Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

 src/features/home/pnl-trace-panel.tsx              | 22 ++++++++++++----------
 .../simulation/components/charts/pnl-waterfall.tsx | 20 +++++++++++++-------
 2 files changed, 25 insertions(+), 17 deletions(-)
