# REPORT s15 — Simulation Engine Correctness & Staged UX Flow

Branches: FE `s15/sim-flow` (off `feat/simulation-migration` @ 3aa8e79), BE `s15/sim-engine` (off `v2` @ 69bd9a7). Not merged.

Live evidence in `docs/s15/` — BEFORE captured against the owner's running mainline instance (:3000/:8000, integration-v3 heads), AFTER against the s15 worktrees (:3100/:8100), same real-book localStorage seed (24 bonds + 6 IRS from Portfolio Data.xlsx via the BE loader).

| | BEFORE (mainline live) | AFTER (s15) |
|---|---|---|
| Layout | `before-1-initial.png` — 4-panel dockview, every control visible at once | `after2-1-initial.png` — Configure stage |
| Run | (no interstitial) | `after2-2-running.png` — Running interstitial |
| Results | `before-3-results.png` — Funding 4.20%, 스왑손익 +0만, 5 stacked badges, staircase fan, broken glyph | `after2-3-results.png` — chips, exclusion notice, blank swap lines, single badge, smooth fan |
| Cancel | (n/a) | `after2-4-cancelled.png` — back on Configure, inputs intact |

---

## T1 (BE) — Funding rate: the 4.20% diagnosis and the base+10bp spec

**Finding (diagnose-first).** The 4.20% is a hardcoded stub, not a mispriced curve node. Two copies of it existed:

1. `UIUX_test src/app/(workspace)/simulation/position-bridge.ts:54` — `fundingRate: 0.042`, with the s6 comment admitting it: *"fundingRate defaults to the source's 4.20%; wire a real settings source later."* Every live click sent 0.042.
2. `IRS Pricer_Mock irs_pricer/api/routers/simulate.py` — `fundingRate: float = 0.042` as the request default (same stub, inherited from rates-simulator-main).

It matches no plausible base rate; the codebase's actual policy-rate source (`Data/BOK Base Rate.xlsx`, loaded by `loaders/base_rate.py`) reads **2.50%** on its latest row (2026-07-08). On top of the wrong level, the funding-cost side also *stepped* with 금통위 events (`calc_dynamic_funding_rate`), which the owner has now ruled out.

**Fix.** Single named constant pair in `simulation_service.py`:

```python
POLICY_BASE_RATE_KRW = 0.025   # matches Data/BOK Base Rate.xlsx latest row (2026-07-08)
FUNDING_SPREAD_BP = 10
FUNDING_RATE_KRW = POLICY_BASE_RATE_KRW + FUNDING_SPREAD_BP / 10000.0  # 0.026
```

- ⚠ **Owner confirmation requested:** `POLICY_BASE_RATE_KRW = 2.50%` was taken from the repo's own BOK Base Rate data (latest row 2026-07-08). If the desk's current 기준금리 differs, this one constant is the only thing to change.
- Wiring: the live bridge **omits** `fundingRate` from the payload; `fundingRate: float | None = None` on the route; `None` → the constant, **fixed for the whole horizon, no event stepping** (`_cost_events = []` on the funding-cost side only — the 금통위 events still drive the rate-path shocks exactly as before). The constants are the single source consumed by the funding strip (`fundingCurve`), the header carry chip, and the Total Return carry math — all three read the same resolved value inside `build_chart_data`.
- Back-compat: an *explicit* `fundingRate` keeps the source semantics (value + event stepping). That is deliberate — the source-backend golden capture (`fundingRate: 0.042` explicit) still verifies port parity byte-for-byte, and no test was weakened.

**Regression (pinned in `tests/test_simulate_s15.py`).** With `fundingRate` omitted and a −25bp 금통위 event configured: every `fundingCurve` row == 0.026 exactly; `carryBp == (positionRate − fundingRate) × 1e4` to 0.1bp; cumulative carry accrues at the constant (analytic pin). Explicit-value stepping pinned separately.

**Live.** Header now reads **Funding 2.60% · 운용 3.42% · Carry +82.1bp** (`after2-3-results.png`).

> **[CORRECTED, s18 T2]** This report originally claimed the owner's −93.8bp carry "was purely an artifact of the fake 4.20%." That claim was **unverified**: the two observations do not share a base date **or a book** (owner screenshot: full uploaded book, pre-s15 session date with the then-UTC baseDate derivation, 운용 3.26%; s15 capture: 24-bond seed subset, baseDate 2026-07-16, 운용 3.42%). Funding explains exactly 160.0bp of the 175.9bp move; the residual 15.9bp is the 운용 difference between two different books/dates and says nothing about funding. The same-book/same-date A/B is pinned in s18 (`tests/test_simulate_s18.py::test_carry_ab_only_funding_moves`): at a fixed base date the carry delta equals the funding delta exactly and 운용 is byte-identical — residual 0. See REPORT_s18 §T2.

## T2 (BE+FE) — Swaps into the simulation; honest exclusion; decomposition

**Finding.** Two independent gaps produced 스왑손익 +0만: the bridge sent `irsParRates: []` **and** never bridged swap positions at all (S6 known-gap comment; `useManualPositionsStore` untouched). A numeric zero for an unpriced asset class violated the blank-MtM policy.

**Fix (BE).**
- `_resolve_swap_inputs`: swaps present + empty `irsCurves` → par quotes resolved from the backend's own IRS snapshot store (`market_data_service.load_snapshot(base_date)`, decimal rates, tenor labels → real Modified-Following maturity dates via `resolve_curve_maturity_dates`). No quotes for the base date (missing snapshot **or** zero IRS quotes) → swaps **excluded**: positions dropped from the run, additive `exclusions: [{assetClass:"swap", reason:"당일 IRS 호가 없음", asOf}]` in the response. No fallback snapshot, no silent zeros; the documented empty-par-curve no-500 branch is preserved and now reached only in genuine absence.
- `_resolve_swap_float_fields`: the bridge's swap rows carry contract terms only; the backend fills `currentFloatRate` (reset-date rule F(R)=R−1 Seoul BD via `engine/fixings.select_fixing` — the same selector the identity-guarded real-book MtM path uses), `nextFixingDate` and `remainingDays` from the `qe.IRS_Trade` ISDA schedule. Already-populated payloads (goldens, frozen fixtures) are untouched and skip the store entirely.
- **Total Return decomposition** (additive `totalReturnDecomposition`): line set **bondMtm + bondCarry(조달 차감 전, incl. 만기 재투자) + fundingCost + swapMtm + swapCarry = total**. No parallel math: `calculate_daily_funding_cost` is the funding term of `calculate_daily_carry` factored out (same loop shape, same maturity rule), accumulated beside the untouched original accumulators — the identity holds at float level, pinned ±₩1 against `finalTotal` on the representative golden book and the bridge-shaped swap request. When swaps are excluded, `swapMtm`/`swapCarry` are `null` (undefined, not zero).

**Fix (FE).** `position-bridge.ts` maps `ManualPosition` → swap `Position` (direction −1 = pay-fixed; notional 억→원; contract dates; market fields left for the BE). Results surface renders the exclusion notice verbatim + `—` blanks (`simulation-flow.test.tsx` pins "never +0만"). KRW figures go through the mainline `formatKrwAxisSigned` (the local `fmtSigned` override was deleted with the old Results panel).

**Live.** Full live book (273 bonds + 413 swaps, base 2026-07-15): swaps priced end-to-end — `finalSwap = −671,985,789`, exclusions `[]`, decomposition sums exactly (capture in §T4 fixture provenance). Today's base date (2026-07-16, no quotes yet) exercises the exclusion path honestly: notice + blank lines in `after2-3-results.png`.

⚠ Runtime note for the owner: the full 413-swap book at 180d took **~24 minutes** on this machine (FM path per swap × per-day KRD recon). The staged flow makes the wait visible (elapsed clock + cancel), but if the desk runs the whole book routinely, engine-side batching is a follow-up worth scoping (out of s15 scope).

## T3 (FE) — Staged flow

`SimulationTab`'s 4-panel dockview replaced by the slice's `SimulationFlow`: **Configure** (horizon segments / target move / σ on top; waypoints, curve spreads, 금통위 collapsed into three 고급 설정 accordions; live curve preview beside; full-width CTA) → **Running** (interstitial listing the engine pipeline 커브 부트스트랩 → 시나리오 프라이싱 → 분위수 구성 with a live elapsed clock and 취소; honest states — the endpoint is a single request/response with no progress channel, so no stage is ever ticked off a timer; the subtitle says exactly that, and the elapsed clock + cancel are the real signals) → **Results** (chips 기간 · 목표 변동 · σ · Funding · Carry + 조건 수정; fan hero with funding strip; Total Return card with decomposition + exclusion notice).

- Re-run **replaces** the previous result outright when the new one arrives; no history, no overlay. Cancel (AbortController through the port's new `cancelRun`) returns to Configure, previous result untouched.
- Store keys and payload semantics: additive only. Same `ScenarioParams` keys/defaults; `SimulationInputs.fundingRate` became optional (omitted by default — T1); `markCancelled`/`cancelRun` added; the s13 σ sanitizer untouched (`sanitizeSigmaBp` still in force, pinned by tests).
- The superseded `scenario-config-panel` (+ its test) and `results-grid-panel` were deleted; the config panel's full interaction coverage migrated test-for-test to `configure-stage.test.tsx` (plus new accordion-collapsed and preview-present assertions).

## T4 (FE+BE) — Fan semantics and rendering

**Scenario identity (BE).** `build_distribution_bands` no longer re-sorts per day: band *p* is always the run of its generating rate-quantile scenario (z_p parallel offset), center pinned to the base run (`p50 == chartData.totalPnL` byte-equal, σ-independent — pinned at σ 2.0/5.0/7.5 across tests). Percentile labels therefore denote **rate-level quantiles** (P95 = 금리 +1.645σ 경로); on a rates-up-loses book p95 sits below p50 — the FE caption states this. Crossings render honestly (chart caption: "비단조 북에서는 밴드가 교차할 수 있음").

**Real-book fixture.** `tests/data/fan_non_monotone_request.json`: live-book capture (2026-07-15) minimized to one real bond + one real pay-fixed IRS with roughly offsetting DV01s, all market inputs frozen into the request (Data-independent, ~3s). On the *full* live book the identity semantics show label-order crossings on **76 of 121 days** — e.g. day 49: p5 +3.52B, p25 −213.1M, **p50 −211.8M (base)**, p75 −498.4M, p95 −1.03B — exactly the family of distortions the per-day sort used to hide by migrating runs across ranks (iv3 observed: base run at p25, shocked run as on-screen median). The fixture test asserts (a) center == base byte-equal on every day, (b) crossings survive into the response (impossible under sorting — regression-proof), closing the affine-only blind spot.

**Rendering (FE), all verified live:**
- *(a) Staircase* — diagnosed as **time-axis rendering, not data**: rows are business days carrying calendar-day accrual (weekday step ~−2.5M, weekend row ~3×), but lightweight-charts spaces points equidistantly, compressing each 3-calendar-day move into a 1-day slot → a sharp riser every five points. Fix: whitespace time slots for the calendar gaps in the fan band series (no fabricated values — whitespace rows carry no data; fills/lines span the gap at true calendar width). Before/after: `before-3-results.png` vs `after2-3-results.png`. Residual kinks are genuine data (maturity roll-offs in percentile paths).
- *(b) Broken glyph at the funding strip's lower-left* — the lightweight-charts **TradingView attribution logo**, painted at the chart's bottom-left corner = the bottom (funding) pane's lower-left in the two-pane layout. The slice's own `LwLineChart` already disables it; the fan chart (shared `SeriesChart`/`LwChartBase`) didn't. Disabled panel-locally via the public `chartOptions` seam. Gone in the after capture.
- *(c) Badge stacking* — the four percentile edges were full `SeriesChart` line series, each minting a price-scale badge (five stacked raw-float badges in `before-3-results.png`). The edges now draw inside the slice-local `FanBandSeries` (1px strokes + fills), so the price scale carries exactly **one** badge on the center (base-run) line — the center is the sole/primary line series, which is precisely what s14's shared center-badge default will key on; no local badge-policy override was added, and none remains to fight s14's defaults (the badge's raw-float formatting visible in the capture is s14's shared KRW-badge work arriving at integration). Percentile values stay readable via the new header hover readout (억/만 formatted).
- Also fixed while verifying: the hero fit race (fit-content ran before the stage layout settled, stranding data on the right half) — refit deferred two frames after each new run's data lands.

## Scope hygiene (s14 boundary)

No changes to the shared chart layer (`SeriesChart`, `ChartFrame`, `LwChartBase`, chart-colors/tokens) or any non-Simulation tab. No local overrides added for vertical gridlines, KRW axis formatting, or badge policy — the Simulation charts will pick up s14's shared defaults at integration; the one local formatting helper the old Results panel carried (`fmtSigned`) was deleted in favor of the mainline `formatKrwAxisSigned`.

## Gates

- **BE**: `pytest` **320 passed + 4 xfailed** (baseline 309+4, +11 s15 tests), 27s. Golden source parity intact (explicit-funding path); contract-shape test's sanctioned-extras set extended to `exclusions`/`totalReturnDecomposition` (still fails on any unlisted key). Landed anchors untouched and green: NPV identity guard, dirty-basis matrix, Home-vs-trace, engine regression suite.
- **FE**: `tsc --noEmit` clean; `vitest` **158 passed** (22 files); `next build` clean; eslint **21 errors** (= baseline) / 26 warnings.
- Worktree note: FE deps installed with `pnpm install --frozen-lockfile` (the repo is pnpm; a stray npm install produces a drifted tree that breaks typecheck).

## Deferred / out of scope (unchanged)

Vertical gridlines + KRW axis/badge formatting (s14 at integration); 금통위-linked funding path; run comparison/history; Entry Signals backtest; merging. Follow-up worth scoping: full-book simulate runtime (~24min, see T2 note).
