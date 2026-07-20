# SIM2_REPORT — scenario-path redesign, full scope (SIM2-1..7), 2026-07-20

Base: FE `feat/simulation-migration` @ 5d84ffd, BE `v2` @ 5ff42cc (HARDEN-1 finals, verified at T0).
All four pre-adjudicated rulings executed as decided; the mid-session owner addendum (SIM2-7,
historical funding basis) executed in full. All commits LOCAL, no push. Both servers RUNNING on the
final heads (:3000 prod build @ 5f03c74, :8000 @ 72edb61).

## T0 — precondition record

- Heads: FE 5d84ffd (HARDEN1 docs), BE 5ff42cc (home-split); `irs_pricer/services/simulation/`
  EXISTS on v2 (r3a merged at HARDEN-1) — precondition met.
- Shared-surface deltas vs the design's f656f95/4cf96a3 evidence base: SIM-2's core surfaces
  (`curve-view-panel.tsx`, `scenario-preview.ts`, `lw-line-chart.tsx`, `input-curve-preview.ts`,
  `configure-stage.tsx`, `types/simulation-port.ts`, `scenario-curves.ts`, the store) were
  BYTE-IDENTICAL to the design head. Moved files (all HARDEN-1's Results work, as the design's
  rebase block predicted): `api/simulate-dto.ts` (+19, decompositionDaily),
  `simulation-flow.test.tsx` (hero mock), `configure-stage.test.tsx` (σ rewrite),
  `results-stage.tsx` (fan → component curves; the fan stack files the design listed are DELETED).
  BE: the family split + HARDEN-1's decomposition/theta work; `quant_engine.py` untouched at T0.
  The design's σ-removal predictions for simulation-port/scenario-curves did NOT occur (sigmaBp
  deliberately kept — consistent with the σ-contract-intact rule). No contradiction changed a
  ruling's meaning.
- Fresh baselines at the heads: FE vitest 227/0 skips, tsc clean, build clean, eslint 20 errors;
  BE 336 passed + 4 xfailed.

## Per-task summary & verdicts

| Task | Verdict | Commits |
|---|---|---|
| SIM2-1 커브형/시계열형 toggle | **demo-ready** | FE aecf518 |
| SIM2-2 on-line lerp defaults (ruling ①) | **demo-ready** | FE 7acecf7 |
| SIM2-3 waypoint dot drag (ruling ②) | **demo-ready** | FE fbdfadc |
| SIM2-4 path-true swaps (ruling ③) | **demo-ready** | BE 8ae0e78 |
| SIM2-5 fundingStepping opt-in (ruling ④) | **demo-ready** | BE f257feb + FE 3753625 |
| SIM2-6 stage persistence | **demo-ready** | FE 9fc619a |
| SIM2-7 historical funding basis (addendum) | **demo-ready** | BE 72edb61 + FE 84f06b5 + 5f03c74 |

- **SIM2-1**: revival per design T2 — `previewMode` store key (UI-only, payload-blind, pinned),
  toggle on the extracted generic SegmentedButtons, 시계열형 = `buildTimePath` → `LwLineChart`
  (dayToTime slots, waypoint markers, dashed policy series, +X.Xbp axis via the new formatValue
  prop applied to every series). Zero network from the path branch (hooks gated; no-fetch pin).
- **SIM2-2**: untouched intermediates lerp onto the line (0.1bp-rounded); touched = EXPLICIT
  per-day flags (`touchedWaypointDays`), byte-preserved across horizon/target changes, pruned off
  the grid. **DECLARED: default-run MID-HORIZON trajectories move** — 180D/+30bp now ships
  D+30..150 = 5/10/15/20/25 instead of 0/0/0/0/0; terminal P&L identical. Re-pinned fixtures
  (each marked `[CHANGED, SIM2-2 ruling]`): configure-stage.test "steps a waypoint…" and
  "payload parity…". `baseShockBp == 0` no-op documented, not fixed (per prompt).
- **SIM2-3**: drag handles over the 시계열형 dots via the LwLineChart onSeriesRebuilt coordinate
  seam; commits through the ONE lib write path (`lib/waypoints.ts` — snap 5bp, clamp
  ±max(|baseShock|+50,100), touched flag) shared with the steppers; drag-vs-stepper payload
  identity pinned; D+0/terminal have no handles. Live drag verified (+15 → +20bp snapped).
- **SIM2-4**: `path_factor` added to `simulate_irs_path_fm` (the AUTHORIZED additive
  quant_engine edit — validated length D+1/finite, None = byte-identical). **Activation rule**:
  the array (sampled from the same `_factor`) passes only for NON-TRIVIAL paths (deviating from
  the calendar-linear ramp) — the golden representative fixture is exactly the trivial lerp, so
  golden parity holds structurally; swap-side byte-identity of trivial-vs-absent pinned
  (full-body identity never held pre-change: bond `_factor` ulp rounding, documented).
  `_cum_shock_r` + the BOK-day KRD diagnostic aligned. Consequences (the point, all
  `[CHANGED, SIM2-4]`): fan swapMtm 134,446,996.42 → 125,508,190.66, total 37,128,110.35 →
  28,189,304.59 (refixings crystallize path effects); the fan fixture became MONOTONE — the
  s15/s18 non-monotone coverage now rides an overshoot-path variant (0→+60@D30→+30@D60), fixture
  file byte-stable. Flat-window pins: swapValuationPnL ≡ 0, recon dailyDbp/totalEstPnl ≡ 0.
  **Timing observation (record only)**: fan fixture path-active cold 2.51s / warm 0.19s, 1,180
  distinct curve keys (per-(scenario,day) ramp-regime signature; s21's full-book ~120s/11,661-key
  reference needs the live book — not reproducible from committed artifacts).
- **SIM2-5**: additive `fundingStepping: bool = false`; ON + omitted fundingRate steps the
  fixed-mode funding cost via the existing calc_dynamic mechanism; OFF byte-identical (A/B pin:
  flag inert without events, content-equal). With events, ONLY funding-side fields move
  (enumerated + pinned: fundingCurve rates/carry, chartData cumulativeCarry/totalPnL, summary
  finalCarry/finalTotal, decomposition fundingCost/total + daily paths, distribution return
  bands; valuation/ratePaths/PVBP/book/recon byte-identical). Test churn per the memo: the s15
  constant pin split into stepping-off/stepping-on; s18's A/B keeps default-off untouched;
  legacy 0.042 golden path untouched. FE: 금통위 accordion switch (default OFF) + staircase-aware
  chip.
- **SIM2-6**: adjudicated — `view` was component state dying on unmount while lastRun persisted.
  Stage moved into the store (s17 precedent); ingestResult lands Results (a run finishing while
  unmounted still lands — the mutation writes the module store, request outlives the component);
  markCancelled → Configure with inputs intact; abort controller moved to MODULE scope so a
  remounted tab can cancel a previous mount's request (no zombie Running). Round-trip pinned
  (same lastRun object, byte-equal params, no refetch) and verified live.
- **SIM2-7 (owner addendum)**: `services/funding_basis.py` — series-covered dates fund at the
  ACTUAL BOK base rate + 10bp stepped at real change dates; join at the series end; constant
  beyond; SIM2-5 events stack on top. **Staleness adjudication (measured)**: coverage
  2016-01-01 → 2026-07-16 (3,850 rows), latest 0.0275 == the policy constant → **NOT stale**;
  the join is value-continuous (the 07-16 hike row is present). Pre-coverage dates flat-extend
  the earliest value (documented; the constant would be absurd in 2010). Surfaces: fixed-mode
  strip/carry/decomposition (legacy explicit-fundingRate/golden untouched); additive
  `fundingBasis` provenance field (contract allowlists extended); PnL Trace gains an additive
  funding leg (2021-11-05 accrues at **0.85%**, stepping to 1.10% at the real 2021-11-25 hike —
  measured cumulative −15,575,342 over 56 days vs ≈−43.7M at the wrong constant). Home period
  P&L adjudicated: NO funding term exists (pure revaluation) — nothing to migrate; Home's daily
  funding is a spot metric at as_of ≥ join → constant, unchanged by design. Moved pins, each
  `[CHANGED, SIM2-7]`: s15 stepping-off/on (historical staircase 2.60% ≤07-15 / 2.85% from the
  hike; strip-integral finalCarry identities), s18 A/B (per-row funding delta varies by segment;
  the isolation identity itself survives). FE: strip-based staircase chip showing **min~max**
  (5f03c74 — first→last hid a non-monotone staircase, caught live), provenance line
  "조달 기준: ~join 실적(BOK)+10bp · 이후 정책상수 2.85% [· 금통위 이벤트 반영]", trace
  Funding tooltip row + provenance.

## SIM2-2 re-pinned fixture list

| Test | Change |
|---|---|
| configure-stage.test "steps a waypoint with the ∓/± buttons…" | D+30 starts at lerp 5 (was 0); +5 → 10; touched flags asserted |
| configure-stage.test "keeps waypoint state semantics… (payload parity)" | untouched D+60 = 20 (was 0) at 90D/+30bp |

(SIM2-4/7 re-pins are enumerated in their sections above; every one carries an in-file
`[CHANGED, SIM2-x ruling]` note.)

## Session-end gates

- FE: vitest **251 passed / 0 skipped** (T0 227 + SIM2-1 +6, SIM2-2 +4, SIM2-3 +7, SIM2-5 +3,
  SIM2-6 +2, SIM2-7 +2) · tsc clean · build clean · eslint **20 errors** (= baseline) · all 6
  guard scripts green.
- BE: pytest **347 passed + 4 xfailed** (T0 336 + SIM2-4 +5, SIM2-5 +3 incl. the s15 split,
  SIM2-7 +3) · heavy battery ONCE at end: anchor files **43 passed** (42 baseline + the declared
  stepping-on case) · golden parity green (structural: trivial-path activation + legacy-funding
  golden book) · both s21 fixtures HTTP byte-identity + raw-engine call-count + killswitch
  round-trip (**15 passed**).

## Live evidence (servers on final heads; screenshots in docs/sim2/)

1. `s2-1-path-view-drag.png` — 시계열형: smooth SIM2-2 default ramp (+5/+10/…/+30 dots), dashed
   policy staircase stepping −25bp at the 2026-08-20 event, drag handle live-verified
   (D+90 +15 → **+20bp** snapped commit).
2. `s2-2-results-curves-stepping.png` — five component curves + legend; funding staircase run:
   chip **Funding(범위) 2.60~2.85%**, provenance line naming 실적(BOK)+10bp · 정책상수 · 금통위
   이벤트; waterfall 조달비용 −1.3억 (vs −1.4억 constant-era — the historical basis at work).
3. `s2-3-roundtrip-results.png` — Results → Home → back returns to the SAME Results view
   (stage persisted, no rerun).
4. `s2-4-trace-historical-funding.png` — 2021-11-05 trace: par prefill 2.0042%, funding
   provenance 실적(BOK)+10bp (0.85%-era accrual; the funding strip in the straddling simulation
   window shows the step at the exact 2026-07-16 change date — pinned in s15).

## Commit evidence — BE (git show --stat, verbatim)
commit 8ae0e7819c262eb7f4dd8b438db5e472a391fcdf
Author: Assistant <wwoo1116@gmail.com>
Date:   Mon Jul 20 14:53:23 2026 +0900

    feat(sim2-4-path-true-swaps): additive path_factor — swaps ride the designed path (ruling ③)
    
    quant_engine.simulate_irs_path_fm gains the AUTHORIZED additive parameter
    path_factor (per-day factor array, length days_to_simulate+1, validated
    finite; None = step/biz-ramp byte-identical — everything else in the file
    untouched). The daily loop takes factor from the array when present,
    including the BOK-stairs branch's ramp component and the step shock-type
    bypass.
    
    build_chart_data: the custom-path preprocessing (_sorted_cp/_factor) hoisted
    above the FM precompute (behavior-neutral move); ACTIVATION RULE — the array
    (sampled from the SAME _factor the bond side uses; no parallel math) is
    passed only for a NON-TRIVIAL designed path, i.e. waypoints deviating from
    the calendar-linear ramp. Empty/trivial-lerp paths (incl. the golden
    representative fixture, whose customPath is exactly the trivial lerp) stay
    in the legacy regime — the absent-param byte-identity gate is structural and
    golden parity passes untouched. _cum_shock_r's ramp component and the
    BOK-day KRD diagnostic (_fac_irs/_irs_ramp_step) align to the same path so
    추정 == 실제 stays consistent.
    
    Behavior change on SHAPED paths (the point): fan fixture flat-0-then-ramp
    path now prices swaps path-true — flat window swapValuationPnL exactly 0,
    recon dailyDbp/totalEstPnl 0 in the window; refixings crystallize
    mid-horizon path effects, so fan swapMtm 134,446,996.42 → 125,508,190.66
    and total 37,128,110.35 → 28,189,304.59 ([CHANGED, SIM2-4] re-pins in
    test_simulate_harden1). The fan fixture also became MONOTONE under
    path-true swaps — the s15/s18 non-monotone coverage tests now use an
    overshoot-path variant (0→+60@D30→+30@D60) with [CHANGED, SIM2-4] notes;
    the fixture FILE stays byte-stable for cache pins. swapCarry (theta,
    base-curve-driven), bond components and funding unchanged.
    
    Timing observation (record, don't optimize): fan fixture path-active cold
    2.51s / warm 0.19s, 1,180 distinct curve keys (per-(scenario,day) ramp-
    regime signature; s21's full-book ~120s/11,661-key reference needs the live
    book, not reproducible from committed artifacts).
    
    Tests: +5 (test_simulate_sim2.py: swap-side byte-identity on trivial paths,
    engine length/finite validation, None-default equivalence, shaped-path
    consistency, recon alignment). Full suite 341 passed + 4 xfail.
    
    Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

 irs_pricer/engine/quant_engine.py       |  27 +++++-
 irs_pricer/services/simulation/chart.py |  91 ++++++++++++++------
 tests/test_simulate_harden1.py          |  17 ++--
 tests/test_simulate_s15.py              |  18 +++-
 tests/test_simulate_s18.py              |  16 +++-
 tests/test_simulate_sim2.py             | 145 ++++++++++++++++++++++++++++++++
 6 files changed, 275 insertions(+), 39 deletions(-)

commit f257feb4126ef7b9bd28efbdd29497c9f2a178d4
Author: Assistant <wwoo1116@gmail.com>
Date:   Mon Jul 20 15:00:48 2026 +0900

    feat(sim2-5-funding-stepping): opt-in 금통위 funding stepping (ruling ④)
    
    Additive request field fundingStepping: bool = False. True + omitted
    fundingRate → fixed-mode funding cost steps at the request's 금통위 events
    via the EXISTING calc_dynamic_funding_rate mechanism (base = policy constant
    pair); the only code change is the cost-events gate in build_chart_data
    (_cost_events empties only when fixed AND not stepping), threaded through
    run_simulation/_run_simulation_profiled/distribution. False = byte-identical
    (pinned: A/B ± flag with no events is content-equal). Legacy explicit
    fundingRate + golden 0.042 path untouched.
    
    Test churn per the design memo: the s15 'constant everywhere despite events'
    pin split into stepping-off ([CHANGED, SIM2-5] re-spec, assertions
    unchanged) and stepping-on (staircase 0.0285→0.0260 at the event date,
    per-row carry identity survives stepped rows, finalCarry == the strip-
    integral identity); s18's A/B keeps default-off semantics untouched. +2 A/B
    pins in test_simulate_sim2.py: flag inert without events (byte-identity);
    with events only funding-side fields move (valuation/ratePaths/PVBP/book/
    recon byte-identical, per-day decomposition identity closes on the stepped
    side). Full suite 344 passed + 4 xfail (+3).
    
    Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

 irs_pricer/api/routers/simulate.py             |  5 ++
 irs_pricer/services/simulation/chart.py        |  5 +-
 irs_pricer/services/simulation/distribution.py |  2 +
 irs_pricer/services/simulation/orchestrator.py |  8 ++++
 tests/test_simulate_s15.py                     | 57 ++++++++++++++++++++--
 tests/test_simulate_sim2.py                    | 66 ++++++++++++++++++++++++++
 6 files changed, 138 insertions(+), 5 deletions(-)

commit 72edb61d8eeef71b055dfb3d8b9c65fd3277c710
Author: Assistant <wwoo1116@gmail.com>
Date:   Mon Jul 20 15:19:16 2026 +0900

    feat(sim2-7-historical-funding): funding basis = actual BOK stairs for past dates (owner ruling)
    
    New services/funding_basis.py: for series-covered dates the funding BASE is
    the ACTUAL historical BOK base rate (loaders/base_rate.py step-function
    lookup) + FUNDING_SPREAD_BP, stepped at the series' real change dates; from
    the join (last series date) forward the policy constant governs; SIM2-5
    user events stack on top via the existing calc_dynamic_funding_rate — one
    continuous staircase, no double-counting.
    
    Staleness ADJUDICATION (s18 provenance nuance): measured at execution —
    series coverage 2016-01-01 → 2026-07-16 (3,850 rows), latest 0.0275 == the
    policy constant → NOT STALE; the 2026-07-16 hike row is present so the
    staircase is value-continuous at the join. The stale rule (join stays at
    series end, constant beyond) is implemented + provenance-exported either
    way. Pre-coverage dates flat-extend the earliest value (documented; the
    constant would be absurd in 2010).
    
    Surfaces: simulation fixed-mode strip/carry/decomposition route through the
    per-date basis (legacy explicit fundingRate untouched — golden 0.042 path
    byte-identical); NEW additive response field fundingBasis (provenance;
    contract allowlists extended); PnL Trace gains an additive funding leg
    (NpvTracePoint funding_rate + cumulative_funding via shared _fill_funding —
    2021-11-05 accrues at 0.85%-era, stepping to 1.10% at the real 2021-11-25
    hike; cost sign matches Home). Home period P&L adjudicated: it has NO
    funding term (pure revaluation) — nothing to migrate; Home's daily funding
    is a spot metric at as_of (≥ join → constant) — unchanged by design.
    
    Moved pins, each [CHANGED, SIM2-7] (the point of the fix): s15 stepping-off
    (strip now 2.60% ≤07-15 / 2.85% from the hike; strip-integral finalCarry),
    s15 stepping-on (historical base + event stack), s18 A/B (per-row funding
    delta varies by segment; isolation identity itself survives). No other
    anchor moved — fan's accrual window starts ON the hike date and the golden
    book is explicit-funding.
    
    Tests +3 (resolver pins incl. the 2021-11-25 step & pre-coverage rule;
    strictly-future window keeps the constant; trace funding leg straddling the
    hike). Full suite 347 passed + 4 xfail.
    
    Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

 irs_pricer/api/models.py                       |  5 ++
 irs_pricer/api/routers/simulate.py             | 16 +++++
 irs_pricer/services/funding_basis.py           | 88 ++++++++++++++++++++++++
 irs_pricer/services/npv_trace_service.py       | 28 +++++++-
 irs_pricer/services/simulation/chart.py        | 12 +++-
 irs_pricer/services/simulation/orchestrator.py |  5 ++
 tests/test_simulate_api.py                     |  4 +-
 tests/test_simulate_s15.py                     | 36 ++++++----
 tests/test_simulate_s18.py                     | 21 ++++--
 tests/test_simulate_sim2.py                    | 94 ++++++++++++++++++++++++++
 10 files changed, 285 insertions(+), 24 deletions(-)

## Commit evidence — FE (git show --stat, verbatim)

commit aecf51819a2462f04da957ab295c2e03e9bedc2f
Author: Assistant <wwoo1116@gmail.com>
Date:   Mon Jul 20 14:31:06 2026 +0900

    feat(sim2-1-path-toggle): 커브형/시계열형 preview toggle (path-view revival)
    
    Design T2 executed as a revival: the Curve View panel header gains a
    2-segment 커브형|시계열형 control on the extracted SegmentedButtons recipe
    (generic over choice type; configure-stage usage unchanged). New UI-only
    store key previewMode ('curve' default) — survives stage navigation, never
    enters the payload (parity pinned: buildSimulateRequest is previewMode-blind).
    
    시계열형 = lib/scenario-preview.buildTimePath (the SAME lerp as the backend
    _factor) through the kept LwLineChart host via dayToTime calendar slots
    (s15 rule), one marker per store waypoint, dashed cumulative policy-rate
    series when 금통위 events exist, and a +X.Xbp axis via the new LwLineChart
    formatValue prop (applied to EVERY series — z-order formatter rule). Zero
    network/engine: the 커브형-only base-quote hooks take an enabled flag and
    are off on the path branch (no-fetch pin).
    
    커브형 branch logic byte-untouched. Tests +6 (curve-view-panel.test.tsx):
    default mode, path rendering vs buildTimePath, dashed policy series,
    no-fetch, payload parity, previewMode unmount/remount survival. Slice suite
    35 passed; tsc clean.
    
    Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

 .../simulation/components/charts/lw-line-chart.tsx |  10 +-
 .../components/panels/curve-view-panel.test.tsx    | 157 +++++++++++++++++++
 .../components/panels/curve-view-panel.tsx         | 167 ++++++++++++++++-----
 .../simulation/components/segmented-buttons.tsx    |  55 +++++++
 .../components/stages/configure-stage.tsx          |  47 +-----
 src/features/simulation/hooks/use-input-curves.ts  |  12 +-
 .../simulation/store/simulation-data-store.ts      |   8 +
 7 files changed, 364 insertions(+), 92 deletions(-)

commit 7acecf7b2ceb36cafd4abd4be11caf55f8435baa
Author: Assistant <wwoo1116@gmail.com>
Date:   Mon Jul 20 14:36:28 2026 +0900

    feat(sim2-2-lerp-defaults): untouched waypoints default to the on-line lerp (ruling ①)
    
    The Configure regen effect now fills UNTOUCHED intermediate waypoints with
    lerpDefaultBp(target, day, simDays) (0.1bp-rounded on-the-line value) instead
    of the back-loaded 0-pin — the default path is a smooth ramp. 'Touched' is an
    EXPLICIT per-day flag (ScenarioParams.touchedWaypointDays, set by
    stepper/typed commits and by SIM2-3 drag; never value-equality inference):
    touched waypoints are byte-preserved across horizon/target changes; flags for
    days that fall off the grid are pruned. Terminal pin {simDays, baseShockBp}
    and the D+0 zero pin unchanged. buildSimulateRequest does not read the flag —
    payload shape unchanged. The 'N개 조정' census now counts touched days (under
    lerp defaults every intermediate is nonzero, so the old bp!==0 census would
    always read full).
    
    DECLARED LOUDLY: default-run MID-HORIZON trajectories move (the shipped
    customPath is now an even ramp, e.g. 180D/+30bp sends D+30..150 =
    5/10/15/20/25 instead of 0/0/0/0/0); terminal P&L is identical (same terminal
    pin + flat extrapolation). Re-pinned frozen fixtures, each marked
    [CHANGED, SIM2-2 ruling]: configure-stage.test 'steps a waypoint…' (D+30
    starts at 5, +5 → 10) and 'payload parity…' (untouched D+60 = 20, not 0).
    Known limitation kept as-is per the prompt: baseShockBp == 0 still silently
    ignores customPath.
    
    Also rides along (declared): curve-view-panel.test harness hardening from
    SIM2-1 — api-client mock via importOriginal spread (full-suite module graph
    pulls API_BASE) and an async findBy on the default-mode first paint.
    
    Tests: 237 passed / 0 skipped (SIM2-1 +6, SIM2-2 +4 net: 5 new semantics
    tests incl. explicit-flag round-trip and grid-prune, 1 old assertion folded).
    tsc clean.
    
    Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

 .../components/panels/curve-view-panel.test.tsx    | 31 ++++++-----
 .../components/stages/configure-stage.test.tsx     | 63 ++++++++++++++++++++--
 .../components/stages/configure-stage.tsx          | 55 +++++++++++++++----
 src/features/simulation/types/simulation-port.ts   |  7 +++
 4 files changed, 130 insertions(+), 26 deletions(-)

commit fbdfadcf1eea2f445a9a1b95c5d9e66fae463395
Author: Assistant <wwoo1116@gmail.com>
Date:   Mon Jul 20 14:40:44 2026 +0900

    feat(sim2-3-drag): waypoint dot drag on the 시계열형 preview (ruling ②)
    
    Additive affordance; steppers stay canonical. New lib/waypoints.ts is the ONE
    waypoint write path: WAYPOINT_STEP_BP, waypointClampMax (±max(|baseShock|+50,
    100)), snapWaypointBp (5bp grid then clamp), buildWaypointPatch (bp write +
    SIM2-2 touched flag, idempotent), lerpDefaultBp (moved from configure-stage).
    Steppers/typed commits AND drag all commit through buildWaypointPatch, so
    drag-vs-stepper payload identity is structural — pinned anyway
    (waypoints.test.ts: identical buildSimulateRequest for the two routes).
    
    WaypointDragOverlay: DOM handles over the 시계열형 dots positioned via the
    new LwLineChart onSeriesRebuilt coordinate seam (timeToCoordinate/
    priceToCoordinate, guarded against disposed charts; repositions on
    visible-range changes). Vertical pointer drag → coordinateToPrice → snap →
    clamp → shared patch; a dragged day is touched for SIM2-2 regen. Only
    INTERMEDIATE waypoints get handles — D+0 and the terminal pin are not
    editable anywhere, drag included.
    
    Tests +7 (waypoints.test.ts 4: snap/clamp grammar, idempotent flag,
    drag-vs-stepper identity, lerp line; curve-view-panel.test 3: snapped drag
    commit + touched, wild-drag clamp, no handles on pins). Slice suite 52
    passed; tsc clean.
    
    Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

 .../simulation/components/charts/lw-line-chart.tsx |  10 +-
 .../components/charts/waypoint-drag-overlay.tsx    | 138 +++++++++++++++++++++
 .../components/panels/curve-view-panel.test.tsx    |  70 +++++++++++
 .../components/panels/curve-view-panel.tsx         |  46 ++++++-
 .../components/stages/configure-stage.tsx          |  30 ++---
 src/features/simulation/lib/waypoints.test.ts      |  58 +++++++++
 src/features/simulation/lib/waypoints.ts           |  48 +++++++
 7 files changed, 376 insertions(+), 24 deletions(-)

commit 37536254edcc319fbb212b456085a94877ddd14a
Author: Assistant <wwoo1116@gmail.com>
Date:   Mon Jul 20 15:00:48 2026 +0900

    feat(sim2-5-funding-stepping): FE opt-in toggle + staircase-aware funding chip
    
    ScenarioParams.fundingStepping (default false) rides the payload as the
    additive fundingStepping flag (false ≡ omitted backend-side). The 금통위
    accordion gains the 조달비용 스테핑 switch (role=switch, default OFF). The
    Results funding chip becomes staircase-aware: when the run stepped and the
    strip actually moved, it renders 'Funding(만기) 시작%→만기%' — never a bare
    single number hiding the staircase; constant runs keep the old chip
    verbatim. Waterfall 조달비용 and component curves need no FE math (server
    values). Tests +3 (toggle default/payload round-trip ×2, stepped-chip
    rendering). Slice suite 55 passed; tsc clean.
    
    Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

 src/features/simulation/api/simulate-dto.ts        |  4 ++++
 .../simulation/components/simulation-flow.test.tsx | 18 ++++++++++++++++++
 .../components/stages/configure-stage.test.tsx     | 22 ++++++++++++++++++++++
 .../components/stages/configure-stage.tsx          | 20 ++++++++++++++++++++
 .../simulation/components/stages/results-stage.tsx | 15 ++++++++++++++-
 src/features/simulation/lib/scenario-curves.ts     |  3 +++
 src/features/simulation/types/simulation-port.ts   |  4 ++++
 7 files changed, 85 insertions(+), 1 deletion(-)

commit 9fc619a6019ba082b584e3c7255210d2c7ef92c3
Author: Assistant <wwoo1116@gmail.com>
Date:   Mon Jul 20 15:03:28 2026 +0900

    feat(sim2-6-stage-persistence): the staged flow survives tab navigation
    
    Adjudication: SimulationFlow's stage was component state (useState 'view')
    that died on unmount while lastRun/params already persisted in the store —
    returning to the tab always reset to Configure. Fix per the s17 ES
    precedent: stage moves into simulation-data-store; the running→success
    landing moves into ingestResult (a run finishing while the tab is unmounted
    still lands Results — the mutation writes the module-level store, so the
    request already outlived the component); markCancelled returns to Configure
    with inputs intact; 조건 수정 sets stage explicitly. 재실행=대체 unchanged.
    
    In-flight edge (preferred route was available and taken): the abort
    controller moves from a hook-local ref to MODULE scope, so Running rendered
    by a remounted tab can still cancel the request a previous mount started —
    no zombie Running screen.
    
    Tests +2 (mount→run→unmount→remount restores Results from the persisted
    snapshot with the SAME lastRun object and byte-equal params; unmounted-
    during-Running arrival lands Results at remount) + stage reset in the flow
    harness. Full FE suite 249 passed / 0 skipped; tsc clean.
    
    Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

 .../simulation/components/simulation-flow.test.tsx | 37 ++++++++++++++++++++++
 .../simulation/components/simulation-flow.tsx      | 35 ++++++++++----------
 src/features/simulation/hooks/use-simulation.ts    | 24 ++++++++------
 .../simulation/store/simulation-data-store.ts      | 18 +++++++++--
 4 files changed, 84 insertions(+), 30 deletions(-)

commit 84f06b573a4c29544b1d183aac6fc335a2692d7f
Author: Assistant <wwoo1116@gmail.com>
Date:   Mon Jul 20 15:19:16 2026 +0900

    feat(sim2-7-historical-funding): FE provenance — 실적(BOK) vs 상수 vs 이벤트
    
    Results: the funding chip's staircase detection is now on the STRIP itself
    (historical stairs and user-event stairs render identically); a provenance
    micro-line under the chips tells them apart — '조달 기준: ~join 실적(BOK)+
    10bp · 이후 정책상수 2.85% [· 금통위 이벤트 반영] [· ⚠ 시리즈 지연]' from
    the additive fundingBasis field. PnL Trace: additive funding leg surfaced —
    tooltip Funding row (per-date basis rate + cumulative funding cost) and a
    provenance line under Market Rates; the 2021-11-05 case reads 0.85%, never
    2.85%. Types additive (FundingBasis, NpvTracePointOut funding fields).
    
    Tests +2 (provenance line render, trace provenance). Full FE suite 251
    passed / 0 skipped; tsc clean. (Tooltip funding row is hover-gated and the
    hover machinery is mocked in jsdom — covered by the live evidence pass.)
    
    Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

 src/features/home/pnl-trace-panel.test.tsx         |  7 +++++
 src/features/home/pnl-trace-panel.tsx              | 22 +++++++++++++++
 src/features/simulation/api/simulate-dto.ts        | 16 +++++++++++
 .../simulation/components/simulation-flow.test.tsx | 23 ++++++++++++++++
 .../simulation/components/stages/results-stage.tsx | 32 ++++++++++++++++------
 src/lib/api-types.ts                               |  6 ++++
 6 files changed, 98 insertions(+), 8 deletions(-)

commit 5f03c74f0844774d5dc5930e6fa1cc3c35d54c6c
Author: Assistant <wwoo1116@gmail.com>
Date:   Mon Jul 20 15:24:48 2026 +0900

    fix(sim2-7): funding chip shows the min~max range, not first→last
    
    Live evidence caught it: a non-monotone staircase (historical 2.60% → 2.85%
    hike → event back to 2.60%) rendered as 'Funding(만기) 2.60%→2.60%' —
    first→last endpoints hid the mid-window plateau. The stepped chip is now
    'Funding(범위) min~max%' with detection on strip-value distinctness; the
    full staircase remains in the strip and the provenance line. Test re-pinned.
    
    Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

 .../simulation/components/simulation-flow.test.tsx      |  4 ++--
 .../simulation/components/stages/results-stage.tsx      | 17 ++++++++---------
 2 files changed, 10 insertions(+), 11 deletions(-)
