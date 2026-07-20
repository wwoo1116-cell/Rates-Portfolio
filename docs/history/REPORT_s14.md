# REPORT — s14: Chart Polish Pass (Shared Defaults + Non-Simulation Sweep)

- **Branch / worktree:** `s14/chart-polish` in `wt-s14-fe`, off FE mainline `3aa8e79` (integration-v3 head). NOT merged.
- **Scope kept:** shared chart layer + Home / Portfolio Management / Rates History / Entry Signals + formatter utils. **Zero files touched under `src/features/simulation/`** (s15's lane) and zero backend changes.
- **Display-only:** no request/response payload, valuation, or data-shape change anywhere — every edit is a render-time formatter, chart option, or badge-visibility flag. PVBP/MtM numerics are byte-identical by construction (verify: `git diff 3aa8e79 -- src` touches no API/math module other than additive formatters in `lib/format.ts`).

## Gates (all green at HEAD)

| Gate | Result |
|---|---|
| vitest | **169/169** (baseline 148 + 21 s14 additions), 23 files — includes all guards (no-raw-hex, Jade/Berry lockdown, canvas no-var, heat/chart contrast) |
| tsc --noEmit | clean |
| next build | clean (13/13 pages) |
| eslint | no NEW issues on touched files; the 4 errors + 1 warning reported there (`pnl-trace-panel` no-explicit-any ×4, `lw-chart-base` `_type` unused) are the inherited red-baseline items on untouched lines |

Evidence: `docs/session-s14/` (headless Playwright, s8 recipe; no OS captures).

---

## T1 — Vertical gridlines OFF everywhere

- `BASE_CHART_OPTIONS.grid.vertLines` → `{ visible: false }` in `src/components/charts/lw-chart-base.tsx`. Every lightweight-charts host (SeriesChart and all raw `LwChartBase` hosts) inherits; time-axis tick labels unaffected; horizontal gridlines untouched (still `rgba(255,255,255,0.07)`).
- **Sweep result: no non-Simulation local grid override exists.** The only other `grid:` config in the repo is `features/simulation/components/charts/lw-line-chart.tsx` (s15's file — its colors-only override does not set `visible`, so it re-enables nothing; left alone per lane boundary). Hand-rolled canvas charts (tenor-curve, sparkline, stacked-bar-100, heatmap) draw no vertical gridlines to begin with.
- **Pin:** `chart-defaults.test.ts` asserts `vertLines.visible === false` and that horzLines stay enabled.
- Before/after: `00-before-mainline-rates-history.png` (mainline :3000, verticals visible) vs `02-rates-history-2series-badges-on.png` (same view on s14, verticals gone). All other screenshots confirm per tab.

## T2 — KRW 억/만 formatter as the default

**Mechanism.** New pure module `src/components/charts/series-defaults.ts`:
- `SeriesChartSeriesDef.valueKind?: "krw" | "rate" | "bp"` — a series declares what its values ARE; `resolveSeriesFormatter` maps `krw → formatKrwAxisSigned` (signed 억/만, no raw floats / sub-만원 digits), `rate → rateFormatter` (4dp %), `bp → formatBp` (2dp, new in `lib/format.ts`, replacing two identical local `spreadFormatter` copies). An explicit `formatter` always wins → fully backward-compatible (s15's `distribution-chart-panel` passes `formatKrwAxis` explicitly and is unaffected until they delete it).
- SeriesChart applies the resolved formatter to **axis ticks, last-value badges, AND the crosshair tooltip** (tooltip previously fell back to `toLocaleString`).
- `rateFormatter` now lives in series-defaults; `lw-chart-base` re-exports it so no import breaks.

**Sweep (per-chart formatter wiring deleted or upgraded):**

| Surface | Before | After |
|---|---|---|
| Portfolio details — MtM (1Y) (`details-panel.tsx`) | `formatter: formatKrwAxisSigned` | `valueKind: "krw"` |
| Rates History RV chart (`rate-history-chart.tsx`) | local `spreadFormatter` + `rateFormatter` import | `valueKind: "bp" / "rate"` |
| Home spread P&L (`spread-pnl-chart.tsx`) | hand-rolled LwChartBase host, `formatPnlKrw` (full digits) axis | **migrated to canonical SeriesChart**, `valueKind: "krw"`; gains the standard reticle+tooltip; zero line now the canonical `ZERO_LINE_COLOR` (was a private rgba white) |
| Home PnL Trace (`pnl-trace-panel.tsx`) | `formatPnlKrw` on axis, Max/Min markers, tooltip rows, final badge | `formatKrwAxisSigned` on all six chart surfaces (kept as a raw host — its multi-field tooltip has no SeriesChart equivalent) |
| Spread position header badge (`spread-position-panel.tsx`) | `formatPnlKrw` | `formatKrwAxisSigned` (chart badge); the PVBP legs/residual TABLE keeps full-digit `formatPnlKrw` deliberately — tables aren't chart surfaces (scope note added in `pnl-format.ts`) |
| Entry Signals equity curve (`equity-curve-panel.tsx`) | local `Math.round().toLocaleString()` (raw won digits) on axis + net readout | `formatKrwAxisSigned` both |
| Entry Signals price panel (`price-panel.tsx`) | local `spreadFormatter` | shared `formatBp` (rate/bp display unchanged) |

**Guard:** `krw-format-guard.test.tsx` renders all four KRW chart fixtures (MtM history, spread P&L, PnL Trace panel, equity curve) against a recording lightweight-charts fake and asserts (a) every KRW series carries a custom formatter (a missing one = the library's 2dp-float default = fail), (b) formatter output over decimal-heavy probes never matches `\d+\.\d{2}`, (c) marker texts and the crosshair-tooltip DOM are clean.

Evidence: `04-pnl-trace-krw-axis.png` (억 axis, `Max: +12.4억` / `Min: -1.7억` markers, `+7.6억 KRW` badge, 만/억 tooltip), `05-portfolio-details-mtm.png` (`+1.3억` badge/axis), `06-entry-signals-equity-krw.png` (`-4.3억` axis/badge/net).

## T3 — Badge collision policy

- SeriesChart default: past `badgeLimit` series on a pane (default `DEFAULT_BADGE_LIMIT = 2`) only series opted in as `primary` keep their last-value badge; the rest read via crosshair. Per-series `lastValueBadge` is a hard override in both directions; per-chart `badgeLimit` (e.g. `Infinity`) opts a chart out.
- **lightweight-charts renders the series `title` on the price axis even with `lastValueVisible: false`** — the policy therefore blanks the title too, or the badge pile survives as a label pile (found live, pinned in the guard test).
- Applied: Rates History marks the first selected instrument `primary`; the migrated spread-P&L chart uses `lastValueBadge: false` (its header readout owns the number — pre-s14 behavior preserved). The Simulation fan chart (6+ series, no primary) will inherit badge-off at integration, as the work order intends.
- ≤2 series is pixel-compatible with pre-s14 (all badges on) — Rate History's default view unchanged (`02-…`).

Evidence: `03-rates-history-3series-primary-badge-only.png` — three instruments, exactly one badge (IRS 3Y, primary).

## Integration notes for s15 / the integrator

1. Everything lands through the shared layer: **Simulation charts inherit vertical-gridline-off (via `BASE_CHART_OPTIONS`), the badge policy + valueKind defaults (via SeriesChart) with no s15 edits.** s15's local `formatter: formatKrwAxis` on the fan chart keeps working (explicit wins); deleting it swaps the fan to the SIGNED formatter (`+3.2억` vs `3.2억`) — flag if the sign is unwanted there.
2. `features/simulation/components/charts/lw-line-chart.tsx` still paints its own vertical gridlines (slice-local re-implementation, colors from chart-theme). Its vertLines should be turned off by s15/integration to match — one line: `grid: { vertLines: { visible: false }, … }`.
3. New shared exports: `series-defaults.ts` (`resolveSeriesFormatter`, `badgeVisible`, `DEFAULT_BADGE_LIMIT`, `rateFormatter`, `SeriesValueKind`), `lib/format.ts#formatBp`.
4. `formatPnlKrw` (`features/home/pnl-format.ts`) survives for table readouts only; its doc now states the chart-surface ban.

## Files touched

Shared: `components/charts/lw-chart-base.tsx`, `series-chart.tsx`, `series-defaults.ts` (new), `chart-defaults.test.ts` (new), `krw-format-guard.test.tsx` (new), `lib/format.ts`.
Hosts: `features/portfolio/details-panel.tsx`, `features/home/{rate-history-chart,spread-pnl-chart,spread-position-panel,pnl-trace-panel,pnl-format}.tsx|ts`, `features/entry-signals/{equity-curve-panel,price-panel}.tsx`.
Evidence: `docs/session-s14/*.png` (7), this report.
