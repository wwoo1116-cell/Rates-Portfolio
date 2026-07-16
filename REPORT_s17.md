# REPORT — s17: Entry Signals Staged Flow

- **Branch / worktree:** `s17/entry-signals-flow` in `wt-s14-fe`, off s16 head `2a52654` (serial FE order s14 → s16 → s17). NOT merged.
- **Scope kept:** Entry Signals feature directory + its store slice only. Zero Simulation files, zero backend changes, shared chart layer consumed only (one s14 guard-test *harness* updated to the new seam — see Gates note).
- **Restructuring pass:** no valuation/signal/backtest math touched (`lib/math/*` untouched by `git diff`). Number preservation is pinned by test and shown live.

## Gates (all green at HEAD)

| Gate | Result |
|---|---|
| vitest | **181/181** (s16 baseline 172 + 9: 8 staged-flow + 1 KPI pin), incl. all guards (no-raw-hex, lockdown, canvas no-var, chart-defaults, krw-format-guard) |
| tsc --noEmit / next build | clean / clean (13/13) |
| eslint | exit 0 on every touched file; repo baseline unchanged |

Note on `krw-format-guard.test.tsx` (s14, shared layer): its Entry-Signals *fixture mocks* fed the equity chart through the deleted live-params hook; they now feed the identical result through the pinned seam. Same fixture values, same assertions, no shared component touched.

## Number preservation (Task 5)

- **Fixture-first:** commit `975ab7d` landed `backtest-kpi-fixture.test.tsx` green against the PRE-restructure `BacktestPanel` — deterministic LCG spread series through the real store → scaling → `lib/math/backtest` → tile formatting: `Total P&L -3,580,000 · Max DD 18,800,000 · Win 33% · Sharpe -0.16 · Trades 3`. Post-restructure the same params flow through `store.lastRun` (the pinned seam) and the expected literals are untouched — the test passes unchanged in substance.
- **Live confirmation:** for the same seeded inputs (IRS 3Y, defaults), the Results equity header reads `69 trades · net -4.3억` — byte-identical to the pre-restructure rendering of the same inputs (`docs/session-s14/06-entry-signals-equity-krw.png` vs `docs/session-s17/03-results.png`), and the KPI block shows the same run at full precision (`-432,400,000`).

## The design tension — resolution taken and why

Backtest = snapshot; monitoring = live. Implementation:
- `startRun()` snapshots every parameter + the focused instrument into `pendingRun`; `completeRun()` promotes it to `lastRun`. The Results backtest block (KPIs, trades, Cumulative P&L) computes from `lastRun` via the new `usePinnedBacktest()` — never from live params. Z-Score and the Signals grid stay live.
- **Stale handling: marker, not bounce-to-Configure.** If the live config drifts from the pin (the realistic path: clicking a Signals row refocuses the live z-score), a banner marks the backtest block as belonging to the chipped parameters until 다시 실행 replaces it. Chosen over returning to Configure because the drift usually *is* the monitoring workflow — kicking the user out of Results would make live monitoring depend on the run, which is exactly what the directive forbids. Evidence: `04-results-stale.png` (live surfaces on IRS 10Y, pinned block still IRS 3Y, banner on).
- `lastRun` is persisted (additive key) so the detached `/chart/es-equity` window — which shares localStorage but not memory — reproduces the same pinned run.

## What was built

- **Store (`entry-signals-store.ts`, additive only):** `stage` (not persisted — every session starts at Configure), `lastRun` (persisted), `pendingRun` (transient), `startRun/completeRun/cancelRun/editConfig`. All pre-s17 keys, actions, persist version (1) and migration untouched; pre-s17 storage rehydrates `lastRun` to its null default.
- **Configure (`configure-stage.tsx`):** three groups in run order — 1· Pair/Watchlist (InstrumentSelector + 백테스트 대상 focus picker), 2· Signal params (lookback 20/60/120 segmented + custom, entry/watch ±σ steppers), 3· Backtest params (exit/stop/cost/notional steppers) — one full-width 백테스트 실행 CTA (disabled until a target is focused, reason in tooltip), and the live price/spread preview beside the controls (the cached-series chart; costs nothing). Controls are local copies of the s11 Simulation recipe (`config-controls.tsx` — segmented ghost buttons, −/+ steppers + typed field; the sim slice is import-isolated, so the recipe is reproduced, not imported). **Nothing was collapsed into an accordion**: every param here materially changes the run; the one display-only setting (± bands) was relocated into the preview header of the chart it configures instead.
- **Running (`running-stage.tsx`):** indeterminate spinner, run target, elapsed (250ms tick), 취소. Honesty rule kept: no fabricated stages — the only phases surfaced are genuinely observable client states (market-data queries in flight → series assembly → synchronous compute), and with a warm cache the interstitial is a single frame, which is honest too. Cancel falls back to the previous Results if a pin exists, else Configure. Query-error state renders in place with 돌아가기.
- **Results (`results-stage.tsx`):** header = pinned-run chips (pair · lookback · entry/watch ±σ · exit/stop ±σ · cost · notional · ranAt) + 다시 실행 + 조건 수정; body = 2×2: Z-Score (live) / Signals grid (live, selector hidden — watchlist editing lives in Configure) / Cumulative P&L (pinned) / KPI + trades (pinned). Re-run replaces outright — the old pin stays visible until the new one completes (pinned by test). All charts stay in their `ChartFrame`s; maximize/detach work from Results (registry entries for es-price/es-zscore/es-equity unchanged).
- **Workspace:** `entry-signals-workspace.tsx` is now the 3-way stage switch. The five-panel dockview is gone; the old `dockview-layout:entry-signals-v1` key is orphaned (harmless), and the tab no longer registers with the sidebar panel accordion — there are no rearrangeable panels to list. `use-backtest.ts` (live-params sim hook) deleted; `use-pinned-backtest.ts` replaces it with identical scaling/math.

## Task 4 — inherit, don't reimplement

- No Entry-Signals-local vertical-gridline or grid overrides existed or were added; every chart inherits the s14 `BASE_CHART_OPTIONS` default. The equity curve keeps its s14 KRW treatment (`formatKrwAxisSigned` axis + 억 net readout — visible in `03/04-results*.png`).
- Colors: token routing only (`--sem-info` ghost for pressed segments, `--sem-risk` for the stale banner text, `--sem-danger` for fetch errors — all existing semantics). **No signal-color decisions taken**; no new ambiguous mappings surfaced — the z-score SHORT/LONG marker colors remain `CHART_COLORS.negative/positive` from the pre-existing ES chart-theme, untouched and still on the owner's pending calibration list.
- Badge policy: untouched. The ES charts are raw `LwChartBase` hosts whose explicit `lastValueVisible` flags (SMA/bands off) predate and don't conflict with the SeriesChart-level policy.

## Known defect (explicitly out of scope) — rendered as-is, extra evidence

The Results stage renders the backtest exactly as before: cumulative P&L starts near the first trade's level rather than 0, moves only in trade-sized steps (no daily revaluation between position flips is *visible* — note `dailyPnl` IS computed per day in `lib/math/backtest.ts`, so the flat segments between markers suggest the position is 0 most of the time or the step rendering hides intra-trade drift; left for the diagnosis lane), and oscillator markers under-render for dense breach clusters (many overlapping SHORT labels around 2022–2023 in `04-results-stale.png` — marker text overlap, not missing data, may be part of the "only one LONG" observation). Numbers for the seeded fixture: 69 trades · net -4.3억 · Win 43% · Sharpe -0.59, identical pre/post.

## Evidence (`docs/session-s17/`)

`00-before-dockview-layout.png` (pre-restructure five-panel tab, from s14 evidence — same code state) · `01-configure.png` · `02-running.png` (real delayed fetch: spinner, phase line, 경과 0.5s, 취소) · `03-results.png` · `04-results-stale.png` (refocus → banner; pinned block unchanged) · `05-results-repinned.png` (다시 실행 → chips now IRS 10Y) · `06-configure-roundtrip.png` (조건 수정 → every input preserved, preview live).

## Files

New: `configure-stage.tsx`, `running-stage.tsx`, `results-stage.tsx`, `config-controls.tsx`, `use-pinned-backtest.ts`, `staged-flow.test.tsx`, `backtest-kpi-fixture.test.tsx`.
Modified: `entry-signals-workspace.tsx` (stage switch), `price-panel.tsx` (ControlBar → Configure; bands toggle stays with its chart), `backtest-panel.tsx` + `equity-curve-panel.tsx` (pinned seam), `signal-grid-panel.tsx` (`showSelector`), `use-entry-signals-data.ts` (pinned instrument joins the fetch union), `stores/entry-signals-store.ts` (additive), `components/charts/krw-format-guard.test.tsx` (harness only).
Deleted: `use-backtest.ts`.
