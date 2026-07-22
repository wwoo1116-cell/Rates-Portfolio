# DEMO_SPRINT_REPORT — trader-feedback UI pass (2026-07-20)

Base: FE `feat/simulation-migration` @ e516618 (docs commit atop the stated a6e954a), BE `v2` @ 4cf96a3 (untouched — zero BE commits).
All commits LOCAL, not pushed. Servers left RUNNING for spot-check (:3000 `next start` prod build, :8000 via start-backend.ps1).

## Verdicts

| Task | Verdict | Commits |
|---|---|---|
| Task 2 — Simulation two-pane live preview (centerpiece) | **demo-ready** | ea118b7 + a7f67c3 + 0d15132 |
| Task 1 — PnL waterfall ordered decomposition | **demo-ready** | 4e366b2 |
| Task 3 — Hide Entry Signals | **demo-ready** | 414d8a0 |

## Gates

- `tsc --noEmit` clean; `next build` clean (run after each task and at the end).
- Full vitest: **220 passed | 1 skipped (221)** — the single skip is the deliberate `// DEMO-DEBT` σ-input test skip (baseline was 221/0; no test deleted).
- Manual smoke (Playwright headless against the running prod build + live BE, seeded auth/upload/bond-position localStorage): **16/16 checks**.
  - Two-pane: baseDate control on top; ◀ steps 2026-07-20 → 07-16 → 07-15; 국고채+IRS drawn as exactly two lines with legend on 07-15; curves redraw immediately on 목표 변동 30→150 with no network/engine call; σ input absent; no fan on the surface. On 07-16 the preview honestly shows IRS-only (국고채 series ends 07-15 — data edge, see DEMO_DEBT #7).
  - Waterfall: after a real run, six bars 조달비용 → 채권평가 → 채권캐리 → 스왑평가 → 스왑캐리 → 토탈 with connectors and Jade/Berry fills; the same six rows in order beneath; Total is the server's decomposition total verbatim.
  - Entry Signals: absent from the sidebar (Home, Portfolio Management, Rates History, Simulation, Optimal Portfolio, Settings); /entry-signals renders the 404 page.
  - Screenshots in the session scratchpad: smoke-1-two-pane, smoke-2a-irs-only-edge, smoke-2-basedate-stepped, smoke-3-shock-150, smoke-4-results-waterfall, smoke-5-es-404.

## DEMO_DEBT.md (full list, see file for revive instructions)

1. σ input removed from Configure UI only — sigmaBp store key + payload default 2.0 intact (T2).
2. σ test `it.skip` with DEMO-DEBT marker, not deleted (T2).
3. Time-path preview no longer rendered; `lib/scenario-preview.ts` + tests kept (T2).
4. Preview = par quotes + interpolated horizon-end shock, NOT a backend bootstrap output — no engine call per change by design (T2).
5. Results-stage fan left intact — it belongs to the separate run→result flow per the task carve-out (T2).
6. baseDate stepping over `/api/market-data/range`; steppers disable if it errors, no fabricated dates, no FE business-day authority (T2).
7. Data edge: IRS quotes reach 2026-07-16, 국고채 series ends 2026-07-15 → 07-16 draws IRS-only per blank policy (T2).
8. Waterfall requires `totalReturnDecomposition`; older cached responses fall back to the 3-line card, no waterfall — funding not separately available there, flagged not derived (T1).
9. Excluded swaps render — slots; running level carries through; no client re-summing (T1).
10. ES nav item + Crosshair import commented out; route 404s via notFound(); slice/store/tests untouched; Cmd+1~6 shortcuts shift one slot while hidden (T3).
11. z-score adjustment term permanently out of scope — nothing stubbed (T3).

## Engine/BE

Zero engine or BE edits. All three tasks were FE display/routing over existing payloads and light data endpoints (market-data snapshot/range, credit-curve taxonomy/series). One BE payload quirk was absorbed FE-side (sub-1Y IRS quotes carry tenor_months — 0d15132).

## Commit evidence (git show --stat, verbatim)

commit ea118b703b6fa89cb41990871e5f4e4c3be0ef0d
Author: Assistant <wwoo1116@gmail.com>
Date:   Mon Jul 20 11:21:26 2026 +0900

    demo(sim-two-pane): live shocked input-curve preview + baseDate toggle, sigma input hidden
    
    Left pane: 평가 기준일 control (date field + prev/next over market-data
    available_dates + 오늘 reset) writes userBaseDate; app bridge folds it into
    inputs.baseDate so preview quotes, swap filtering and the simulate payload
    follow one date. 분포 σ input removed from the UI only — sigmaBp store key
    and payload default (2.0) intact; test skipped with DEMO-DEBT marker.
    
    Right pane: CurveViewPanel now draws the shocked INPUT curves — 국고채 par
    yields (credit-curve series) + IRS par quotes (market-data snapshot) plus
    the scenario's horizon-end shock interpolated at each quote tenor — as two
    lines on a new SVG term-structure chart (even pillar spacing, gap + '—'
    notice on missing quotes, no silent +0). Pure display math per change; no
    engine call. Time-path view retired from render, lib kept (DEMO_DEBT.md).
    
    Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

 DEMO_DEBT.md                                       |  23 ++++
 src/app/(workspace)/simulation/position-bridge.ts  |   9 +-
 src/app/(workspace)/simulation/simulation-tab.tsx  |   7 +-
 .../components/charts/term-structure-chart.tsx     | 148 +++++++++++++++++++++
 .../components/panels/curve-view-panel.tsx         | 124 +++++++++++------
 .../components/stages/configure-stage.test.tsx     |   5 +-
 .../components/stages/configure-stage.tsx          |  97 +++++++++++---
 src/features/simulation/hooks/use-input-curves.ts  |  95 +++++++++++++
 src/features/simulation/lib/input-curve-preview.ts | 128 ++++++++++++++++++
 .../simulation/store/simulation-data-store.ts      |   9 ++
 10 files changed, 585 insertions(+), 60 deletions(-)

commit 4e366b25501fe9435d4bdecfe331f831198a8c22
Author: Assistant <wwoo1116@gmail.com>
Date:   Mon Jul 20 11:25:15 2026 +0900

    demo(waterfall): ordered six-part Total Return waterfall in Results
    
    조달비용 → 채권평가 → 채권캐리 → 스왑평가 → 스왑캐리 → 토탈, floating
    bars over the running level with the Total bar from zero, plus the same six
    rows in the card table. Pure display mapping of the server's
    totalReturnDecomposition identity (±₩1 pinned server-side) — nothing
    recomputed. Jade/Berry signed pair via new chart-theme pnl fills (40-step
    bodies, 80-step labels); excluded swaps render — slots, never +0. Responses
    without the decomposition keep the 3-line fallback, no waterfall
    (DEMO_DEBT.md). jsdom ResizeObserver guard added to both SVG charts.
    
    Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

 DEMO_DEBT.md                                       |   8 ++
 .../simulation/components/charts/pnl-waterfall.tsx | 150 +++++++++++++++++++++
 .../components/charts/term-structure-chart.tsx     |   4 +-
 .../simulation/components/stages/results-stage.tsx |  38 ++++--
 src/features/simulation/lib/chart-theme.ts         |   9 ++
 5 files changed, 199 insertions(+), 10 deletions(-)

commit 414d8a01f19ebe724c79b89d15832f2e43d5f4cd
Author: Assistant <wwoo1116@gmail.com>
Date:   Mon Jul 20 11:26:48 2026 +0900

    demo(hide-es): hide Entry Signals from nav and route, slice untouched
    
    NAV_ITEMS entry + Crosshair icon import commented out with DEMO-DEBT
    markers; /entry-signals now renders notFound() (original page body kept in
    a comment for one-line restore). features/entry-signals source, store,
    tests and chart-registry detach entries are all untouched. Cmd+1~6
    shortcuts shift one slot from #4 while hidden. z-score adjustment term
    permanently out of scope — nothing stubbed.
    
    Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

 DEMO_DEBT.md                               |  9 +++++++++
 src/app/(workspace)/entry-signals/page.tsx | 10 ++++++++--
 src/lib/constants.ts                       | 11 +++++++++--
 3 files changed, 26 insertions(+), 4 deletions(-)

commit a7f67c3040cef3dbcddbfda6f00b09de9840bdb5
Author: Assistant <wwoo1116@gmail.com>
Date:   Mon Jul 20 11:29:34 2026 +0900

    demo(sim-two-pane): step-back from an unquoted date lands on latest quoted date
    
    Follow-up to ea118b7: with today unquoted (e.g. 2026-07-20 vs max quote
    2026-07-16) the ◀ stepper now goes to the latest available date first
    instead of skipping past it.
    
    Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

 src/features/simulation/components/stages/configure-stage.tsx | 5 ++++-
 1 file changed, 4 insertions(+), 1 deletion(-)

commit 0d151326b4955db0e99a4be69ff2fe2f8c7abb86
Author: Assistant <wwoo1116@gmail.com>
Date:   Mon Jul 20 11:38:26 2026 +0900

    demo(sim-two-pane): smoke fixes — sub-1Y IRS tenors, connect-through pillars, shock aria-label
    
    Live-smoke findings against the real backend (2026-07-15/16 data):
    - IRS 6M/9M quotes arrive as tenor_years:1 + tenor_months — use the months
      field so they stop stacking on the 1Y pillar.
    - A pillar only the OTHER curve carries no longer breaks the line into
      fragments: undefined (not carried) connects through, null (carried but
      missing on the date) still gaps per the blank-quote policy. 07-15 now
      draws exactly two clean lines; 07-16 honestly shows IRS-only (국고채
      series ends 07-15 at the data edge).
    - 국채 3Y 목표 변동 input gains an aria-label.
    
    Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

 .../components/charts/term-structure-chart.tsx        | 19 ++++++++++++-------
 .../simulation/components/stages/configure-stage.tsx  |  1 +
 src/features/simulation/hooks/use-input-curves.ts     |  5 ++++-
 src/features/simulation/lib/input-curve-preview.ts    | 16 +++++++++++-----
 4 files changed, 28 insertions(+), 13 deletions(-)
