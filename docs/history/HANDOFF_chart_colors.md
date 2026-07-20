# HANDOFF — S7: Chart Color System (MS Palette) + Simulation Chart Re-skin

Branch: `s7/chart-colors` (worktree `wt-s7-fe`, off `feat/simulation-migration` @ 777fd00).
Frontend only; `irs_pricer` untouched. Screenshots in `HANDOFF_chart_colors_assets/`
(before = base branch on :3000, after = this branch on :3001, same backend, same
uploaded Data/*.xlsx set).

## Commits (one per task)

| Commit | Task | Summary |
|---|---|---|
| `43c74ec` | 1 | `--ms-*` raw layer + semantic `--chart-*` tokens in tokens.css; DESIGN.md §2 "Chart Palette" section; `chart-pnl-*` Tailwind utilities |
| `7dd9c0f` | 2 | `src/lib/chart-colors.ts`: `SECTOR_COLORS`/`SECTOR_ORDER`/`MATURITY_RAMP`/`PNL_COLORS`/`SIM_SERIES_COLORS` + loud-fallback lookups + vitest |
| `0c34816` | 3 | Jade/Berry replaces green/red on chart surfaces (Entry Signals theme, PnL Trace markers/tooltip/final-value, CrosshairReticle tones) |
| `a033c5b` | 4 | Canonical `SeriesChart` extracted from Rate History; `formatKrwAxis`; Rate History migrated with parity defaults |
| `461b8c7` | 5 | Simulation Total Return chart on SeriesChart (pills, badges, tooltip, 억/만 axis); slice eslint allowlist gains `@/components/charts` |
| `55d8f69` | 6 | Home allocation charts: fixed sector/maturity mapping, canonical order, 1:1 bar gap, slice seams, cursor-anchored tooltip |
| `df70686` | 5fix | Curve View path pinned to ocean (it had been riding `series.carry`, which S7 moved onto P&L-reserved Jade) |
| (final) | 7 | Contrast gate + no-raw-hex gate wired into vitest; chart-chrome hex hoisting; this report |

## Contrast-check output (`pnpm check:contrast`, vs `--bg-surface` #202B33)

```
token                     | hex     | ratio  | status
--chart-sector-specbank   | #335574 | 1.85:1 | ALLOWLISTED (large-fill-only)
--chart-sector-ktb        | #187ABA | 3.12:1 | pass
--chart-maturity-short    | #187ABA | 3.12:1 | pass
--chart-pnl-neg           | #DC398C | 3.44:1 | pass
--chart-berry (legacy)    | #E75353 | 3.96:1 | pass
--chart-ocean (legacy)    | #2B95D6 | 4.38:1 | pass
--chart-sector-combank    | #4695C8 | 4.39:1 | pass
--chart-maturity-mid      | #4695C8 | 4.39:1 | pass
--chart-series-mtm        | #4695C8 | 4.39:1 | pass
--chart-tangerine (legacy)| #D9822B | 4.93:1 | pass
--chart-purple (legacy)   | #8A9BA8 | 5.04:1 | pass
--chart-sector-msb        | #99AAB9 | 6.05:1 | pass
--chart-pnl-pos           | #65C581 | 6.78:1 | pass
--chart-series-carry      | #65C581 | 6.78:1 | pass
--chart-series-swapmtm    | #FB9B63 | 6.85:1 | pass
--chart-pnl-neg-fill      | #ED9CC5 | 6.99:1 | pass
--chart-series-swaptheta  | #C2ADEB | 7.20:1 | pass
--chart-sector-agency     | #4CCACD | 7.31:1 | pass
--chart-aqua (legacy)     | #91CCF1 | 8.33:1 | pass
--chart-maturity-long     | #A3CAE3 | 8.33:1 | pass
--chart-sector-cardcap    | #94DFE1 | 9.56:1 | pass
--chart-sector-corp       | #CCD5DC | 9.71:1 | pass
--chart-pnl-pos-fill      | #B2E2C0 | 9.99:1 | pass
--chart-series-total      | #D1E4F1 | 11.05:1| pass
```

Note: Navy-80 measures **1.85:1**, not the ≈2.2:1 the work order estimated — the
large-fill-only restriction is even more load-bearing than assumed. All three
mitigations shipped: (a) 1px `--border-subtle` seams between stack slices,
(b) bordered legend swatches (and SeriesChart pill swatches), (c) the gate's
allowlist entry with rationale (`scripts/check_chart_contrast.ts`). The gate also
asserts the allowlist stays honest: if an allowlisted token ever clears 3.0, the
test fails so the stale exemption gets removed.

## Verification gates

1. **Contrast**: `scripts/check_chart_contrast.ts` + `.test.ts`, in the vitest
   suite (config now includes `scripts/**/*.test.ts`); also `pnpm check:contrast`.
2. **Mapping vitest**: `src/lib/chart-colors.test.ts` — 7 sector keys resolve
   distinctly, unknown key → dev-warn + neutral `#5C7080` (warn-once), maturity
   buckets map, PNL/sim-series completeness.
3. **No-raw-hex guard**: `scripts/no_raw_hex_in_charts.test.ts` — scans
   `components/charts/**` plus every file importing lightweight-charts; comments
   stripped. Allowlist: `lib/chart-colors.ts`, both feature `chart-theme.ts`
   files, `lw-chart-base.tsx` (the canvas base-theme). The guard caught and
   forced cleanup of stragglers in `pricer-page.tsx`, `tenor-curve-chart.tsx`,
   `portfolio-heatmap.tsx`, `spread-pnl-chart.tsx`, `pnl-trace-panel.tsx`.
4. **Suite**: `vitest run` 95/95 · `tsc --noEmit` clean · `next build` clean ·
   eslint: **21 errors / 26 warnings, all pre-existing** (base branch has 24/27 —
   this branch removed 3 by fixing pricer-page's raw-hex protocol violation;
   the rest are the simulation slice's known migration debt: restricted imports
   in staging files + `any`s).

## Visual QA (screenshots)

- **(a) Sector mapping fixed**: `home_before.png` shows the old index-ordered
  rainbow (legend led by 시은채; hues reshuffled per response order).
  `home_after.png` shows the cool-family mapping with legend AND stack in
  credit-descending order (국고채 → … → 회사채, PVBP-table order; stack is
  baseline-anchored so 국고채 sits at the bottom, reading bottom-up).
- **(b) Maturity ramp monotone**: single Blue hue, 단기 → 장기 = dark → light.
- **(c) Simulation matches Rates History feel**: `simulation_after.png` —
  series pills (footer text legend removed), crosshair reticle + date badge,
  multi-series tooltip, per-series last-value badges, and the axis in 억 units
  (was raw floats like `-32000000000.00`, see `simulation_before.png`). 합계
  Blue-20 width 3 drawn on top; components subdued.
- **(d) Navy-80 legibility**: `home_sector_tooltip_after.png` — 특은채 slice
  bounded by seams, legend chip bordered; tooltip ("특은채 · 29.3%") anchors to
  the cursor inside the chart area — the old one rendered above the column, on
  top of the legend, clipped at the panel edge. 공사채 (vivid Aqua) vs 여전채
  (pale Aqua-60) separate at stacked-bar size (luminance step + the saturation
  axis; adjacent slices never share both).
- **(e) Rate History pixel parity**: `rates_history_before/after.png` are
  identical (same hues, chips, badges, reticle) — only the wall-clock differs.
- **Entry Signals**: the L/S + win/loss marker migration is the two-constant
  swap in `features/entry-signals/chart-theme.ts` (covered by the palette test);
  the screenshots only show the watchlist state because the dockview-nested grid
  row wouldn't accept a synthetic focus click — verify markers manually by
  focusing an instrument.

## Crosshair-bug root cause (Task 4 note)

lightweight-charts reports every pixel (params.point, timeToCoordinate,
priceToCoordinate) from the **pane** origin, while the reticle overlay is
absolutely positioned from the **container** origin; a visible left price scale
sits between the two, so the overlay landed exactly `leftScaleWidth` px left of
the cursor. `snap-reticle.ts`'s `paneOffsetX()` was already the fix for the
snapped path; the extraction closed the residual hole — the raw-cursor
**fallback** path (used when no series has data at the hovered time) still
passed pane-space X. `SeriesChart` routes *all* overlay positioning through the
offset, so hosts can't reintroduce the bug.

## Decisions taken (flagging for review)

- **Mapping module lives in `src/lib/chart-colors.ts`** (extended), not a new
  `chartColors.ts` — kebab-case is the repo convention and the file already owned
  chart color mirrors.
- **Slice boundary**: eslint rule (B) allowlist now includes
  `@/components/charts{,/**}` so the slice can import the canonical SeriesChart —
  same one-way direction as the existing `@/components/ui` allowance.
- **Stack orientation**: "credit-descending order" implemented as legend order +
  bottom-up stack order (국고채 on the baseline), per StackedBar100's documented
  contract and baseline-anchoring convention. If the owner wanted 국고채 at the
  *top* of the stack, flip to `[...].reverse()` in one place (portfolio-overview's
  `orderKeys`).
- **PnL Trace "final-value badge"**: the header's cumulative value now carries
  sign via `text-chart-pnl-pos/neg` (it was uncolored `fg-primary`); the trace
  line itself stays accent (it was never sign-dependent). Max/Min markers also
  fixed stale mirrors of retired token values (`rgba(30,185,128)` /
  `rgba(224,72,72)` predate the Blueprint retheme).
- **Bid/Ask on the pricer staging page** migrated to Jade/Berry via
  `withAlpha(PNL_COLORS.*, 0.55)` — they're direction-semantic chart lines.

## Pending owner decisions

1. **HeatmapPill** (`components/data/heatmap-pill.tsx`): green/red fills, but it
   renders inside the AG Grid positions table (portfolio/columns.tsx) — non-chart
   UI by the work order's scoping, so left untouched. Decide whether KRD pills
   should join the Jade/Berry system.
2. **Non-chart semantic color migration**: `--sem-positive/negative` still drive
   tables, badges, stat tiles, PAY/REC buttons (out of scope by design).
3. **`lw-chart-base.tsx` stale canvas background**: `BASE_CHART_OPTIONS` paints
   `#161c26` labeled "--bg-surface", but the token has been `#202B33` since the
   Blueprint retheme — every LwChartBase chart canvas (Rate History, PnL Trace,
   Entry Signals) is darker than its panel. Preserved for the Task-4 pixel-parity
   gate; SeriesChart's `chartOptions` override is how the Simulation chart sits
   on the real `--bg-surface`. Aligning the base is a one-line change +
   screenshot round.
4. **Chart-chrome stale mirrors**: `CHART_CHROME_COLORS.*Stale` in
   chart-colors.ts preserve pre-Blueprint text colors used by tenor-curve /
   portfolio-heatmap (both currently unimported). Re-align or delete with the
   dead components.
5. **`RV_SERIES_COLORS` / `colorForId`** (Rate History dynamic overlays + spread
   chips) still use the 12-hue Blueprint set, which includes greens/reds by hash.
   The work order didn't scope RV series; folding them into the MS system needs
   a hashing-stable palette decision.

## How to re-verify

```bash
pnpm install
pnpm check:contrast   # gate 1 report
pnpm test             # 95 tests incl. gates 2–3
pnpm typecheck && pnpm lint && pnpm build
# visual: start-backend.ps1 (NO --reload), pnpm dev, upload Data/*.xlsx
```
