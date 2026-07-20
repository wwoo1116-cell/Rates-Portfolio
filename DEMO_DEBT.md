# DEMO_DEBT — demo sprint 2026-07-20 (trader-feedback UI pass)

Corners cut for the 2-hour demo-first sprint. Each entry: what / where / how to revive.

## Task 3 — Entry Signals hidden

1. **Nav item commented out, route 404s — nothing deleted.**
   `src/lib/constants.ts` (NAV_ITEMS entry + Crosshair icon import parked with DEMO-DEBT comments) and `src/app/(workspace)/entry-signals/page.tsx` (now calls `notFound()`; original two-liner preserved in the comment). The entire `features/entry-signals` slice, `stores/entry-signals-store`, all ES tests, and the chart-registry detach entries are untouched. Restore = uncomment the nav line + icon import, revert the page file.

2. **Cmd+1~6 nav shortcuts shift one slot from position 4 on** while ES is hidden (Simulation is now Cmd+4). Self-heals on restore.

3. **z-score adjustment term: permanently out of scope** (sprint ruling) — no code stub was added anywhere.

## Task 1 — PnL waterfall

1. **Waterfall requires `totalReturnDecomposition` in the response.**
   `src/features/simulation/components/stages/results-stage.tsx` — older/cached responses without the s15 decomposition fall back to the previous 3-line summary card with NO waterfall: the funding component is not separately available in that payload, and per sprint rules it is flagged here rather than derived. A fresh run always carries the decomposition.

2. **Excluded-swap slots render "—" with the running level carried through.**
   `src/features/simulation/components/charts/pnl-waterfall.tsx` — when swapMtm/swapCarry are null the identity shown is the server's bond+funding = total; no client-side re-summing anywhere (Total bar = `decomp.total` verbatim).

## Task 2 — Simulation two-pane live preview

1. **σ input removed from Configure UI only.**
   `src/features/simulation/components/stages/configure-stage.tsx` — the 분포 σ stepper block is deleted from the left pane. `params.sigmaBp` stays in the store and `buildSimulateRequest` still ships `sigma_bp` (sanitized default 2.0), so the engine's σ capability is untouched. Revive = re-add the block (it was section 3, BpStepperField min 0.1 / max 25 / step 0.5).

2. **σ test skipped, not deleted.**
   `src/features/simulation/components/stages/configure-stage.test.tsx` — `it.skip("edits the fan σ …")` with `// DEMO-DEBT` comment. Un-skip when the σ control returns.

3. **Time-path preview no longer rendered.**
   `src/features/simulation/components/panels/curve-view-panel.tsx` was rewritten from the 국채 3Y bp time-path view to the shocked input-curve (term-structure) view. `lib/scenario-preview.ts` (+ its tests) and `charts/lw-line-chart.tsx` are kept intact for revival; nothing else consumes `buildTimePath` right now.

4. **Preview curve = par quotes + interpolated horizon-end shock, not a backend bootstrap output.**
   `src/features/simulation/lib/input-curve-preview.ts` — the right pane draws base par quotes (국고채 credit-curve series + IRS market-data snapshot) plus the scenario's horizon-end shock interpolated at each quote tenor (same `generateShockCurves` nodes the simulate payload carries). It deliberately does NOT call the engine/bootstrap per control change (task requirement: no heavy run per keystroke). If the demo needs true zero-curve shapes, that is a follow-up (light BE endpoint exists: POST /api/curve).

5. **Results-stage fan left intact by design.**
   The σ fan / distribution band removal applies to the live preview surface only; the Configure→Run→Results flow's fan hero (`distribution-chart-panel.tsx`) is the separate "run simulation → result" action the task says to leave.

6. **baseDate stepping is over `/api/market-data/range` available_dates.**
   If that endpoint errors, the ◀/▶ steppers disable and only the raw date field works (no fabricated dates). No Seoul business-day authority was ported to FE (standing rule).

7. **Data edge: the two quote sources end on different dates.**
   As of the sprint, IRS market-data reaches 2026-07-16 but the 국고채 credit-curve series ends 2026-07-15 — on 07-16 the preview honestly draws IRS only (blank policy), and stepping from an unquoted today lands on 07-16 first. Not a code defect; deriving a "common latest" date would fabricate a valuation date, so it was not done. If the demo needs both curves, step to 2026-07-15.
