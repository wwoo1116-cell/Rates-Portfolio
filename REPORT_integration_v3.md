# REPORT — Integration Pass v3 (Single Writer)

FE mainline `feat/simulation-migration`: `9f2e547` (v2 baseline) → **this
HEAD**. BE mainline `v2`: `37fee24` → `69bd9a7`. All 6 live lanes landed;
zero merge conflicts on either repo; guards extended repo-wide; anchors
verified on the merged code; evidence in `docs/integration-v3/`.
Branches not pushed (owner pushes per their remote habits).

## T0 — Lane dispositions

| Lane | Endpoint verified | Report | Disposition |
|---|---|---|---|
| s10 FE | `fc233e2` ✓ | REPORT_s10.md | **landed** (`a11ba74`) |
| s12 FE | `0e373bb` ✓ stacked | REPORT_s12.md | **landed** (`3c0945e`) |
| s11 FE | `eeb94bf` ✓ | REPORT_s11.md (COMPLETE) | **landed** (`4c8376c`) |
| s13 FE | `4d37794` ✓ stacked | REPORT_s13.md | **landed** (`abeaf48`) |
| s11 BE | `d88a931` ✓ | REPORT_s11.md | **landed** (`2aa0d60`) |
| s13 BE | `008ab2f` ✓ stacked | REPORT_s13.md | **landed** (`69bd9a7`) |
| s9 | — | SESSION_PNL_RUN_REPORT.md | **no-op**: `mainline..s9/pnl-trace-run` is empty — fully merged in v2 (`e963d8a`). Worktree `wt-s9-fe` removable. |

Hygiene: no live writers (two `claude.exe` PIDs, one = this session; the only
recent src mtimes were this session's committed s12 files); no port
listeners; all lane worktrees clean (only `.impeccable` hook caches dirty);
`start-backend.ps1` (BE) / `start-frontend.ps1` (FE) tracked, no `--reload`.

## T1 — Merges & conflict log

Order as fixed: FE `s10 → s12 → s11 → s13`, BE `s11 → s13`, all `--no-ff`.
**Conflict log: EMPTY — zero conflicts, zero scope violations.** The designed
disjointness held (s10/s12 outside Simulation; s11/s13 inside it only).
Post-merge token audit: sim resolved every token it consumed — `--chart-berry`
via its own `#E75353` fallback (rewired in T2), `--chart-series-carry` live,
`sem-*` via the s12 aliases (deleted in T2 after migration). Merged-tree
gates immediately after T1: vitest 143/143 (exact union of both lines'
additions), tsc clean.

## T2 — Guard extensions (this pass's commits)

| Commit | Content |
|---|---|
| `0bc9c50` | Lockdown guard repo-wide (sim exclusion removed); 9 sim sites migrated to semantic tokens (Bid/Ask→Jade/Berry, signed results/carry/breakeven→`chart-pnl`, destructive hovers + sim-error→`sem-danger`, `--chart-berry`→`--chart-scarlet` rewire); **sem aliases deleted** from tokens.css + tailwind (s12 TODO fulfilled); guard's alias-pin → extinction assertion. 7/7 green. |
| `e380722` | **Owner ruling: Pay = Berry everywhere.** Details DIR badge flipped off its legacy Pay=Jade; rule single-sourced in `lib/direction-color.ts`; pin test asserts values AND that grid + badge import the module. Success states confirmed staying accent/neutral — no success token. |
| `07fe23a` | Canvas resolved-hex sweep: found + fixed the live defect in sim pricer (`color/crosshairMarkerBorderColor: "var(--accent)"` → `CHART_CHROME_COLORS.accentLine`). New gate `scripts/check_canvas_var_colors.test.ts` (call-span scan + canvas-only-key scan; DOM `var()` styles stay legal). |

## T3 — Backend restart & anchors (merged code, live)

- `:8000` restarted plain-uvicorn on merged `v2`; orphan-free before/after.
- **NPV identity**: `scripts/s11_identity_diag.py` fresh run **byte-identical
  to the committed post-fix evidence** — all 419 swap legs worst |resid| = 0;
  the 43,819,771.88 "aggregate resid" is the documented partial-view artifact
  (273 bonds mtm=None: no 7/15 Credit Matrix row, blank-not-zero policy).
- **Trace regression matrix**: `s13_basis_matrix.py` regenerated
  **byte-identical** to committed evidence — every fixture shift decomposes
  as Δaccrued **−1,076,712.33** + settled cash **+6,805,479.45**, residual
  0.0000 on both endpoints.
- **Home-vs-trace reconciliation (7/14→7/15)**: closed **over live HTTP** —
  trace side captured from the UI's own `/api/mtm/npv-trace` call
  (`1,984,626.564647`), Home side by replaying the UI's captured
  `book-daily-pnl` request at `valuation_date=2026-07-14` with that date's
  own quotes (`1,984,626.564647`; theta 281,601.52 + mtm 1,703,025.04,
  complete=True). **|diff| = 0.000000.** Artifacts: `g-*.json`.
- **62.5M unit guard + Run C**: pinned in pytest (20 anchor-named tests
  selected & passed; full suite below).
- **Daily anchor +67,998 — SUPERSEDED BY DESIGN**: fresh capture
  (`session6_dashboard_impact.py`, same close=7/14→as_of=7/15 pair) gives
  total **+4,188,430** = 67,998 + **4,120,432** of theta accrued-roll — the
  s11 dirty-basis change, mtm leg byte-identical (−297,566,897). The same
  script's "telescoping gap" line (12,328,767.12) is the **stale clean-based
  diagnostic reference**, not a regression: 12,328,767.12 × 365 = exactly
  ₩4.5B of coupon×notional (largest leg's daily accrued); the real identity
  is enforced by `test_npv_identity_guard.py`. Script left untouched to keep
  its committed before/after dumps comparable — flagged for the ledger.

## T4 — Regression gates

- **BE pytest: 309 passed + 4 xfailed** — exactly the s11+s13 landed
  baseline, zero regressions.
- **FE: vitest 148/148** (v2 122 + s10 9 + s12 7 + s11 3 + s13 2 + iv3 pin 2
  + iv3 canvas 3), **tsc clean**, **next build clean** (12 routes incl.
  `ƒ /chart/[chartId]`), **eslint 21 errors / 26 warnings = the inherited
  baseline exactly**.
- **Negative controls**: dashboard capture vs iv2 — bond/IRS MtM levels,
  all PVBP sector×tenor rows, and book summary **byte-identical**
  (ASCII-normalized diff; only daily_pnl/theta/telescoping moved, all
  s11-explained).

## T5 — Visual acceptance (evidence: `docs/integration-v3/`)

| Item | Verdict | Evidence |
|---|---|---|
| a. Logo above Home (expanded + swoosh rail); top bar clean | PASS | `a-home-expanded/collapsed.png` |
| b. Heatmaps Jade/Berry, white text, 0.70 clamp | PASS (gate + visual) | `a-home-expanded.png` (PVBP), heat-ramp gate green |
| c. MtM chart legible + 억/만 axis/tooltip/badge | PASS | `c-e-portfolio-mtm-dir-pay-berry.png` (tooltip `+3.6억`, badge `+4.4억`) |
| d. ChartFrame maximize + detach, both paths | PASS | maximize `d-maximize-home-allocation.png`; snapshot detach `d-detach-snapshot-home-allocation.png` + `…-portfolio-mtm.png`; self-fetch detach `d-detach-selffetch-es-equity.png` |
| e. Zero green/red incl. Simulation; Pay=Berry unified | PASS | lockdown guard 7/7 repo-wide; `c-e-…png` (grid Pay=Berry AND badge PAY=Berry, agreeing); Daily P&L Jade/Berry in `a-home-expanded.png` |
| f. Sim buttons/steppers, fan, funding strip, σ live | PASS with one **deferred defect** (below) | `f-sim-config-buttons.png`, `f-sim-fan-sigma2/4.png` (header `만기 ±21.9bp` → `±43.8bp`, `sigmaTerminalBp` 21.9089→43.8178 exact ×2, base Total Return +207만 unchanged), `f-simulate-resp-*.json` |
| g. NPV=MtM+Theta on-screen/HTTP reconciliation | PASS | `g-pnl-trace-fixture.png` + `g-*.json` (1,984,626.564647 both sides, diff 0) |

0 console errors across every exercised route (`console-errors.txt`).

### Deferred defect (NEW, captured not fixed): fan median ≠ base under per-day sort
On the live seeded book the base (z=0) run lands at the **p25** rank
(terminal p25 = 2,071,233 = Results Total Return at BOTH σ), while the
on-screen 중앙값 badge reads a shocked run (7,020,695 at σ2 → 14,984,979 at
σ4) and p95 explodes 18.9M → 1,201.7M. The s11 "p50 ≡ base" and s13
"p50 σ-independent" invariants hold on the monotone/affine test fixtures
(all green) but the **comonotonic per-day sort migrates runs across
percentile ranks when book PnL is non-monotone in the shock**. Needs an
owner decision (pin p50 to the base run vs keep rank semantics) + a real-book
repro — synthetic 2-bond seed may exaggerate the tails. Evidence:
`f-simulate-resp-0/1.json`, both fan screenshots.

## T6 — Entry Signals 3s10s diagnostics (capture only)

`t6-entry-signals-overview.png`: step-function cumulative P&L (flat
in-position plateaus), overlapping entry/exit marker clusters (S/S and
L/× around 2026-03), **92 trades · net 71,450,000** (vs the never-pinned
dispatch baseline "+70.4M / 35 trades" — window/params still unrecorded, per
the v2 note). `t6-trades-summary-panel.png` + `t6-trade-rows.json` +
`t6-holding-distribution.json`: visible-row holding periods min 5d / median
30d / max 104d, buckets {4-7d: 1, 8-14d: 1, 15d+: 11} (AG Grid virtualizes;
rows beyond the viewport not dumped). Console/dev-overlay: **no issue badge
rendered, 0 console errors** on the merged build — the "3 Issues" state did
not reproduce. Repair remains a separate lane.

## Owner-decision ledger (carried forward + new)

Inherited, untouched: KRD-stub rewiring · PVBP 9-col rollup vs 16-col ·
F-2 accent contrast · payment_frequency inference (its 273-bond warning
prints on every capture run) · −0 KRW formatter · per-date Daily PnL lookup
(the Home UI cannot select a close date — today's as_of gives theta-only
until data lands; made visible again by T5.g) · F-1 fg-dim · S6-bridge UTC
baseDate (pre-09:00 KST → previous-day baseDate, ~4.9k KRW median drift,
untouched) · s7 residual 5 (incl. RV_SERIES_COLORS Blueprint hues — now the
only greens in the app) · s10 residuals (rounding-vs-절삭 만원, zero-cell
em-dash, lw-chart stale #161c26 canvas + scrim mirrors, TradingView
attribution in the added funding pane) · s11/s13 residuals per their reports.
NEW this pass: fan median/per-day-sort defect (above) ·
`session6_dashboard_impact.py` telescoping reference still clean-based
(stale diagnostic; +67,998 anchor superseded by +4,188,430) · dead
`features/portfolio/columns.tsx` + dead tailwind `heat.pos/neg-*` mappings
still deletable · wt-s9-fe (and other merged-lane worktrees) removable.
