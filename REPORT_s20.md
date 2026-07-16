# REPORT — s20: Entry Signals Render Window & Marker Correspondence Fix

- **Branch:** `s20/es-render-and-markers` in own worktree `wt-s20-fe`, off mainline iv4 head `68f7553`. FE only; BE untouched (`/api/spread-backtest` left as-is per scope fence).
- **Computation byte-identical.** `src/lib/math/backtest.ts` untouched; every anchor reproduced to the won (table below). Only render behavior and marker derivation changed.
- **s19's 3 `it.fails` flipped to `it` with assertions byte-identical**; only the SHIPPED-side derivations in the tests were updated, as the s19 helper's mirror contract requires.

## Root-cause addendum — a third render-side mechanism s19 could not see

s19's two sub-mechanisms (fitContent mount race; `minBarSpacing` 0.5px ceiling) are real and both are fixed here. But fixing them exposed a **third mechanism the diagnosis pass had no way to observe** (it never applied a working fit): on any stage with ≥2 synced charts, the `use-synced-time-scales` lockstep **livelocks a per-chart fit**. lightweight-charts applies range writes through its async invalidation queue, so after one chart is fitted, the sync handler mirrors the *sibling's* stale tail range back over it in the next cycle; each chart keeps re-infecting the other and the tail always wins. Demonstrated live (instrumented event traces, this session): the same engine converged to `{0, 4040}` on the single-chart Configure preview and the detached `/chart/es-equity` window, while livelocking to `{3935, 4040}` on the Results 2×2 grid. The fix is a **group fit**: `syncSetLogicalRange` (new, in `use-synced-time-scales.ts`) writes one logical range to every registered chart in the same tick, leaving no stale range anywhere to echo; re-mirroring an identical range is a no-op, so the group settles.

## T1 — Tail window

1. **Deterministic fit on both mount paths:** new engine `ensureFullDomainFit` (`full-domain-fit.ts`) replaces the one-shot `fitContent` in all three ES chart panels. It writes an explicit logical range `{0, barCount−1}` (`ApplyRange` is pure logical coordinates — immune to the fit-before-data-baked no-op that eats `fitContent` on the cache-hit mount) and keeps re-asserting in response to size/range events until this chart's visible range actually covers the domain, then detaches permanently (user zoom/pan never fought). Event-driven only, no timers; a 2-per-trigger budget guarantees termination on unfittable panes until the next resize. Panels arm it exactly where they called `fitContent` (equity: every pinned-result change; price/z-score: instrument change), so zoom-preservation semantics are unchanged.
2. **`minBarSpacing`:** 0.5px default → **0.05px** so 4,040 bars fit ≥202px panes (~12,800 bars at 640px, 3× headroom over today's longest series).
3. **Defaults-vs-local decision: (a) shared `BASE_CHART_OPTIONS`.** Two independent reasons: (i) the inherited s19 R2b test asserts on `BASE_CHART_OPTIONS` directly — flipping it *unweakened* requires the fix there; (ii) the consumer sweep found every `LwChartBase` host plots full-history daily series through `fitContent` and **none overrides `timeScale`** (`options` prop pass-through is shallow-merged; only `distribution-chart-panel` passes options, `layout` only), so the floor must not silently reappear on any of them. Hosts inheriting the change: ES price/z-score/equity, `series-chart` (Home tiles + distribution panel), `pnl-trace-panel`, `pricer-page`. The two Simulation slice hosts (`lw-line-chart`, `rate-fan-chart`) build options inline and are untouched. Behavioral effect outside ES: the zoom-out floor is lower everywhere (users can compress bars below 0.5px before whitespace), and any host whose domain exceeds paneWidth/0.5 bars can now genuinely fit it — for `pnl-trace-panel` (full daily history) that is a fix of the same defect family, not a regression. Live sweep: Rates History renders identically (its 3M/1Y range selector governs the window, ~200 bars, floor never binds); Home panels are upload-gated empty states in a fresh profile (`after-11`), nothing to regress without data.
4. **Guard tests:** see T4 enumeration — 4,040-bar fixture through the exact event sequences of both mount paths **plus** the sync-livelock path, all against the *shipped* floor (the harness reads `BASE_CHART_OPTIONS`), so either sub-mechanism regressing fails the suite.

## T2 — Marker derivation (single source + pinned-run semantics)

1. The oscillator panel's SHORT/LONG markers are now `pinnedOscillatorMarkers(pinnedResult, stale)` — the **pinned run's trade entries**, i.e. the same `BtResult` object (`usePinnedBacktest`) that feeds the KPI block, trades table and cumulative P&L. The parallel first-|z|≥entry crossing loop was **deleted** from both the panel and the s19 helper; a source-scan test pins that no crossing-based marker derivation returns.
2. The 3 `it.fails` flipped; assertions untouched. R1's "actual" is the shipped builder; "expected" is built **inline** in the test so the bijection can't be tautological. R2a's "default render window" is now derived by driving the shipped fit engine through the worst mount ordering (harness mirror of dist-5.2.0 time-scale semantics), same assertion (`invisibleEntries == []`).
3. **Pinned-vs-live semantic (s19 H3 caveat resolved) — implemented per prompt, ⚠ pending owner sign-off:** when the live config drifts from the pinned run (`useRunIsStale`: instrument + every parameter, warnZ included), oscillator trade markers are **suppressed** — `pinnedOscillatorMarkers` returns `[]` — and the existing Results stale banner explains. Pinned markers are never drawn over a mismatched live series. One addition beyond the prompt: the panel's header micro-line appends `· 체결 마커 숨김(설정 변경)` while suppressed, because the detached `/chart/es-zscore` window renders the panel *without* the Results banner and would otherwise suppress silently — same honesty-over-continuity rationale, owner may strike it.
4. Equity-curve markers pinned as exactly bijective (they were the s19 reference behavior; regression test below). While not stale, the live oscillator series *is* the pinned run's series, so every marker is on-bar by construction — this also closes s19's index-sync/different-date-arrays flag for the marker path.

## T3 — Anchors (live BE data via the s19 harness, this session)

| Anchor | Expected | Got |
|---|---|---|
| Config B (IRS 10Y−3Y, defaults 2σ) | 92 trades / net 71,450,000 | **92 / 71,450,000** — exact (harness + live KPI tiles `after-07`) |
| Config C (IRS 3Y, defaults 2σ) | 69 trades / net −432,400,000 | **69 / −432,400,000** — exact (harness + live KPI tiles `after-02`) |
| s17 KPI fixture | −3,580,000 / 18,800,000 / 33% / −0.16 / 3 trades | unchanged (`backtest-kpi-fixture.test.tsx` green) |
| A-capture 35 / 70.4M | **excluded** per prompt (s19: non-reproducible) | config A reproduces s19's corrected 24 / 10,600,000 |

Post-fix visual assertions (all in `docs/session-s20/`): cumulative P&L starts at 0 with the full 2010–2026 domain on the default Results mount (`after-02`, `after-04`); config B's 2026-03 LONG step sits in the context of the full history, not as an isolated cliff (`after-08`); oscillator markers are the trade entries on B and C (`after-03`, `after-09`; counts pinned by tests, not eyeballs); drift suppression with banner + header note (`after-05`, `after-06`); cache-hit remount keeps the full domain (`after-10`, client-side nav away/back with warm query cache). `before-*` are the same script against mainline `:3000` — the ~95-bar tail window, "−4.2억 start", and orphan SHORT crossings reproduce exactly (`before-02`).

## T4 — Gates (v4 baseline: vitest 205+3xfail, tsc/build clean, eslint exactly 21 errors)

| Gate | Result |
|---|---|
| vitest | **221 passed / 0 expected-fail** = 205 baseline + 3 flipped + 13 new (enumerated below) |
| tsc / build | clean / clean (no reintroduction of the s17 typing false-pass; the s19 cast stands) |
| eslint | **21 errors** — exactly baseline. 27 warnings vs the v4 capture's 26: **environmental, not s20** — controlled by re-linting the pristine base commit `68f7553` in this worktree via stash, which also reports 21/27 (the delta is a react-compiler "Compilation Skipped" warning in untouched `features/simulation/trade-entry.tsx`); s20 files contribute zero errors and zero warnings |
| Existing guards | color lockdown, KRW format guard (its LWC stub extended with the new time-scale members — assertions untouched), chart-defaults pins, dockview inventory (ES stays unregistered) — all green in the 221 |

**New tests (13):**
- `chart-defaults.test.ts` (+1): `minBarSpacing lets a 4,040-bar history fit a 640px pane` (s20 R2b pin, >0 and ≤640/4040).
- `full-domain-fit.test.ts` (+7): cache-hit unsized-pane race; cache-hit dropped/merged fit; cold mount late data; unfittable-pane termination (bounded applications) then convergence on resize; **synced two-chart livelock converges via the group applier**; no fits after convergence (user zoom not fought); dispose detaches pre-convergence. All at the s19 geometry (4,040 bars / 640px) against the shipped floor.
- `marker-pins-s20.test.ts` (+5): equity markers exactly bijective + on-bar (T2.4 regression pin, expected side inline); pinned markers = trade entries while live matches; suppression on drift; empty when no run/unresolved series; oscillator-panel source scan (consumes `pinnedOscillatorMarkers`, no crossing derivation).

## Integrator note — files touched

- **Shared (other lanes could reference):** `src/components/charts/lw-chart-base.tsx` (BASE_CHART_OPTIONS + one option, comment-documented), `src/components/charts/chart-defaults.test.ts` (+1 pin), `src/components/charts/krw-format-guard.test.tsx` (LWC stub/mock extended for the new time-scale calls; assertions untouched).
- **ES slice:** `equity-curve-panel.tsx`, `zscore-oscillator-panel.tsx`, `price-panel.tsx`, `use-synced-time-scales.ts` (adds `syncSetLogicalRange`), `marker-trade-correspondence.ts` (crossing builder deleted, `pinnedOscillatorMarkers` added), `backtest-defect-s19.test.ts` (flips), new: `full-domain-fit.ts`, `fit-harness.ts`, `full-domain-fit.test.ts`, `marker-pins-s20.test.ts`.
- Nothing else. Simulation directory, backend, Optimal tab untouched. `.impeccable/hook.cache.json` churns locally (tool cache) and is deliberately not committed.
- Owner servers: `:3000`/`:8000` never touched (verified up before/after); captures of my branch ran on a temporary `:3100` dev server, killed after evidence.

## Open items for the owner

1. **T2.3 semantic sign-off:** suppress-on-drift markers (incl. the panel-header suppression note for the detached window).
2. The oscillator marker labels on long histories are dense (92 entries over 16 years) — collision policy is cosmetic-only per s19 H4; s14's badge policy does not cover series markers. Flagging, not fixing.
3. eslint 21-error inherited baseline still stands (out of scope since s8).
