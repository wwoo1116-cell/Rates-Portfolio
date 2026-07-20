# REPORT — s10: UI Shell & Chart Visibility Pass

Branch `s10/ui-chart-visibility` (worktree `wt-s10-fe`), branched off
`feat/simulation-migration` @ `9f2e547` (integration-v2 baseline).
**Not merged** — integration deferred per protocol. Frontend only; the
Simulation tab and the backend were not touched.

## Commits

| Commit | Task | Summary |
|---|---|---|
| `e6c1cb8` | T1 | Mirae lockup moved from top bar to sidebar, above Home nav |
| `4d3eb1a` | T2 | Jade/Berry heat ramps + white text on DV01 sensitivity surfaces + contrast gate |
| `bf5b00f` | T3+T4 | ChartFrame maximize/detach on all 9 non-Simulation charts; MtM chart visibility + 억/만 formatting |
| `50c23e9` | T4 fix | Detach-snapshot read moved to lazy initializer (restores eslint baseline) |
| `ac4f0ee` | T5 | Entry Signals master-palette transplant (mechanical) |
| (this)   | T6 | Report + live-verification screenshots (`docs/session-s10/`) |

T3 and T4 share one commit deliberately: T3's hover-magnification IS
ChartFrame, and the MtM chart both consumes ChartFrame and feeds the detach
registry — no split point exists where each half builds alone.

## Gates (all green)

- `pnpm test` (vitest): **18 files / 131 tests passed** — includes the S7
  no-raw-hex guard, the S7 token-contrast gate, and two NEW suites
  (`scripts/check_heat_ramp_contrast.test.ts`, `src/lib/format.test.ts`).
- `pnpm typecheck` (tsc): clean.
- `pnpm build` (next build): clean; new dynamic route `ƒ /chart/[chartId]`.
- eslint: **21 errors / 26 warnings — byte-identical count to the mainline
  baseline** (the inherited red baseline; see s7/s8 session notes). One new
  error I introduced mid-session was fixed in `50c23e9`.

## What changed, by task

### T1 — Branding (sidebar logo)
- `sidebar.tsx`: lockup is now the first element of the nav column, above
  Home. Expanded: `mirae-logo-reversed.png` at **110×26** (26px wordmark
  height, mid of the 24–28 target; the old top-bar render was 85×20),
  left-aligned with the nav icons. Collapsed 48px rail: **orange swoosh
  only, centered** — a CSS crop of the *same* asset (measured swoosh bbox
  x 301–338 / y 0–41 in the 339×80 source; wordmark ends at x 297, so the
  crop is clean). No re-derived files; `public/brand/` untouched.
  Gotcha handled: Tailwind preflight's `img { max-width:100% }` would
  collapse the crop — the cropped img carries `maxWidth:"none"`.
- `top-bar.tsx`: logo removed; workspace selector now leads the bar,
  spacing/height unchanged. Evidence: `01/02-home-sidebar-*.png`.

### T2 — DV01 heatmap: white text + Berry/Jade ramps
- New tokens `--chart-heat-pos` (Jade-80) / `--chart-heat-neg` (Berry-80) /
  `--chart-heat-text` (#FFFFFF) in tokens.css, mirrored as `HEAT_*` +
  `heatRampFill()` in `lib/chart-colors.ts`: **5 alpha steps
  (0.12→0.70)**, |value|/range picks the step, sign picks the family.
- **Clamp**: the top step is 0.70 because solid Jade-80 leaves white text at
  ~2.1:1. Per the owner rule the ramp drops failing steps; white text never
  switches to dark. A gate test pins the clamp honesty (one 15% step above
  the top *must* fail — if it starts passing, tighten deliberately).
- Surfaces converted off green/red: **PVBP Sensitivity table** (Home),
  **KRD heat cells + DV01 column** (Portfolio grid), **HeatmapPill**
  bidirectional mode (dev gallery is the only current mount), and the
  treemap `portfolio-heatmap.tsx` PnL text labels (component is currently
  unmounted; converted for convention consistency). Zero-value cells keep
  the muted em-dash — a white "—" on no fill adds noise, not information.
- New gate `scripts/check_heat_ramp_contrast.test.ts`: composites every
  step of both ramps over `--bg-surface` (sRGB source-over, what the
  browser paints) and requires ≥3:1 vs white; also pins tokens↔constants
  mirror sync and `heatRampFill` behavior. Evidence:
  `01-home-sidebar-expanded.png` (PVBP panel, live backend data).

### T3 — Portfolio MtM chart
- **Root cause of "too dark"**: the old chart passed `color:
  "var(--accent)"` into lightweight-charts — canvas cannot resolve CSS
  custom properties, so the series painted in the library's fallback.
- Rebuilt on the canonical `SeriesChart`: `CHART_SERIES_COLORS[0]` (ocean,
  4.4:1 vs `--bg-surface`), **line width 3**, zero baseline, crosshair
  tooltip. Wrapped in ChartFrame (hover affordance → click maximize; a
  separate hover-zoom lens was not needed per the task's own let-out).
- New `formatKrwAxisSigned` (lib/format.ts, tested): `+3.2억` / `-450만`
  style, **no sub-만원 digits**, applied to axis ticks + lw last-value badge
  + tooltip + the panel's final-value readout (which previously used
  PriceDisplay's raw-digit rate notation). Note: the canonical axis
  formatter **rounds** to 만원 (`formatKrw` is the truncating one); I reused
  the canonical formatter as instructed — flag if strict 절삭 is wanted.
  Evidence: `06-portfolio-details-mtm.png`, `08-portfolio-mtm-detached.png`.

### T4 — ChartFrame (maximize + detach)
- New `src/components/chart/ChartFrame.tsx`: the frame div IS the chart's
  `position:relative` container, so adoption is a one-line container swap
  and embedded rendering is pixel-identical (overlays/reticles keep
  working). Hover/focus reveals two 22px icon buttons top-right.
- **Maximize**: children re-parent into a full-viewport portal
  (`z-1000`, ESC or ✕ exits, header with title). Re-parenting remounts the
  chart, so lightweight-charts re-creates its canvas at overlay size — a
  true re-render, never bitmap scaling.
- **Detach**: `window.open` → new route `/chart/[chartId]` (outside the
  `(workspace)` group: no shell chrome, dark tokens global, auth-gated like
  the workspace layout). Self-fetching panels remount and refetch via the
  shared query cache + persisted zustand stores; props-driven charts pass a
  JSON snapshot via localStorage (`detach.ts`, nonce in URL, 24h TTL GC,
  reload-safe). `chart-registry.tsx` maps all 9 ids; ChartFrame never
  imports the registry (panels import ChartFrame — importing back would
  cycle).
- **Wrapped (9)**: Rate History, PnL Trace, Spread Position (Rates History
  tab); sector + maturity allocation (Home); MtM (Portfolio); Price/Spread,
  Z-Score, Equity Curve (Entry Signals). Simulation untouched.
  `tenor-curve-chart` / `portfolio-heatmap` are unmounted (dead) and were
  not wrapped.
- **Latent bug fixed en route**: the three Entry Signals panels keyed their
  series-building effects off `chartRef.current`, so any LwChartBase
  remount *without* a panel remount left a blank chart. Effects now key off
  the `chart` state (matching PnL Trace / SpreadPnlChart), which maximize
  relies on. Evidence: `03-…hover-controls.png`, `04-…maximized.png`,
  `05-…detached.png` (self-fetch path), `08-…mtm-detached.png` (snapshot
  path).

### T5 — Entry Signals palette transplant (mechanical)
- Signed semantics → chart Jade/Berry pair, sign convention preserved
  (rich / z>0 / SHORT = Berry; cheap / z<0 / LONG = Jade): z-score cells,
  ENTRY_LONG/SHORT signal badges, Long/Short trade badges, trade-PnL cells,
  backtest stat tiles, equity-curve net readout.
- `Badge` grew **additive** `pnl-positive`/`pnl-negative` tones (soft fill
  = `withAlpha(PNL_COLORS.*, 0.15)`, text = `--chart-pnl-*`); existing
  tones and all non-Entry-Signals call sites are untouched.
- The `rgba(22,28,38,x)` loading/error scrims (price-panel + the identical
  literals in rate-history-chart) now route through
  `CHART_CHROME_COLORS.scrim*Stale` — deliberately matching the stale
  `#161c26` canvas bg lw-chart-base still paints (S7 pixel-parity pending
  decision), documented at the constant.
- Series identity colors already token-routed (colorForId /
  RV_SERIES_COLORS; SMA/bands/zero via the sanctioned chart-theme.ts
  mirror) — left alone. No signal logic, thresholds, or meanings changed.
  Post-change grep: zero raw hex in `features/entry-signals/` outside the
  allowlisted mirror. Evidence: `07-entry-signals.png`.

## Live verification (headless Playwright, backend :8000 + worktree dev :3010)

Screenshots committed under `docs/session-s10/` (both servers were started
for the pass and stopped afterward; no OS-level captures, per house rule):

1. `01-home-sidebar-expanded.png` — sidebar lockup above Home; PVBP heat
   ramp live (Jade positives / Berry negatives, white text); top bar clean.
2. `02-home-sidebar-collapsed.png` — swoosh-only mark centered in the rail.
3. `03-rates-history-hover-controls.png` — hover affordance on the chart.
4. `04-rates-history-maximized.png` — full-viewport overlay, re-rendered.
5. `05-rates-history-detached.png` — `/chart/rates-history` in its own
   window, full selector + theme (self-fetch detach path).
6. `06-portfolio-details-mtm.png` — MtM line clearly legible; `+4.4억`
   badge; `+5.0억/+3.0억` axis.
7. `07-entry-signals.png` — transplanted palette across all three charts,
   watchlist grid, backtest tiles (seeded 3s10s spread).
8. `08-portfolio-mtm-detached.png` — snapshot detach path: signed 억/만
   axis (`+8,000만` … `+4.4억`), zero line, no sub-만원 digits.

Seeding used the established localStorage recipes (auth/upload gates,
`entry-signals-storage` v1 spread `S:1*IRS||10Y~-1*IRS||3Y`) plus two
seeded `manual-positions` IRS entries to light up the analytics panels.

## Ambiguities / owner decisions needed

1. **"Berry/Cyan" vs Berry/Jade**: task headers say "Berry/Cyan" but the
   body specifies "Berry negative, Jade positive" and the reserved P&L pair
   is Jade/Berry (Aqua/cyan hues are sector-identity: 공사채/여전채). I used
   **Jade** for positive throughout. If "Cyan" was literal, say so and I'll
   re-map — the ramp machinery is palette-agnostic.
2. **Zero cells** in heatmaps keep the muted `—` (not white) — flag if
   "white text on all cells" was meant to include null markers.
3. **만원 rounding vs 절삭**: `formatKrwAxis` rounds; `formatKrw` truncates.
   The chart surfaces use the (rounding) axis formatter per "reuse the
   existing 억/만 axis formatter". Both render zero sub-만원 digits.
4. Left on sem green/red deliberately (outside this session's scope —
   candidates for the calibration pass): Portfolio grid **DIR** badges and
   details-panel direction Badge (Pay/Buy vs Rec/Sell), **Daily P&L by
   Book** table text, spread-position-panel's last-P&L readout and
   Net-PVBP/negative-notional accents, PnL Trace **PAY/REC** toggle fills.
5. Entry Signals **WATCH / NONE / TYPE / EXIT REASON** badges remain accent
   (non-directional) — untouched per the sign-convention-only rule.
6. `RV_SERIES_COLORS` (series identity, 12-hue Blueprint) still pre-dates
   the MS palette — was already a pending S7 item, unchanged here.
7. **Maximize + Entry Signals time-sync**: a maximized/detached ES chart
   re-registers in the sync registry of its own window; cross-window sync
   does not exist (detached windows are independent React trees). Accepted
   as out of scope.

## Notes for integration (Session B / integrator)

- Simulation adoption of ChartFrame is one line per chart: replace the
  chart's `relative` container with
  `<ChartFrame chartId="…" title="…" className="…">`, add a registry entry
  in `components/chart/chart-registry.tsx` (self-fetch entries are
  two lines).
- If Session B touched `tokens.css`/`chart-colors.ts`: my additions are
  append-only blocks (`--chart-heat-*`, `HEAT_*`/`heatRampFill`,
  `CHART_CHROME_COLORS.scrim*Stale`) — conflicts should be trivial.
- The S7 token-contrast gate parses every `--chart-*` token as #RRGGBB —
  do NOT add rgba()-valued `--chart-*` tokens (my heat tokens are hex bases
  for this reason; alpha lives in `HEAT_ALPHA_STEPS`).
