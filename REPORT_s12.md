# REPORT — s12: Semantic Color Unification & Jade/Berry Lockdown

Branch `s12/semantic-color-lockdown` (worktree `wt-s12-fe`), branched off
**s10's endpoint `fc233e2`** (`s10/ui-chart-visibility`) as directed — builds
on s10's `pnl-*` Badge tones and heat ramps. **Not merged.** No Simulation
files, backend, layout-shell, or branding changes.

## Commits

| Commit | Task | Summary |
|---|---|---|
| `834dbdb` | T1 | Universal Jade/Berry for every signed/directional semantic |
| `7b6af50` | T3 | `--sem-positive/negative` retired (Jade/Berry aliases); `--sem-danger` owns errors |
| `40ba533` | T2 | Family lockdown (carry retint, `--chart-berry` rename) + guard |
| (this) | — | Report + verification screenshots (`docs/session-s12/`) |

T3 landed before T2 by necessity: the guard bans what the migrations remove,
so it could only go green after them.

## Gates (all green)

- vitest: **19 files / 138 tests** (131 baseline + 7 new guard tests).
- tsc clean; `next build` clean.
- eslint: **21 errors / 26 warnings — identical to the inherited baseline.**
- New lockdown guard demonstrated red on a seeded 3-way violation, then the
  seed was removed (§ Guard red run below).

## Disposition table — every green/red occurrence found

Sweep patterns: `sem-positive|sem-negative` (vars + Tailwind classes), raw
hexes `#0F9960/#DB3737` + rgba forms, Tailwind `green/red/emerald/rose/lime`
utilities, Jade/Berry family hexes, Blueprint `Intent`/`intent` props.
**Legend:** J/B = migrated to Jade/Berry (sign preserved) · DANGER = error
semantic, moved to new `--sem-danger` red · SIM = s11-owned, untouched
(aliases keep it rendering; guard excludes it until integration).

| # | Surface (file) | Was | Disposition |
|---|---|---|---|
| 1 | Positions grid Dir column (`positions-grid.tsx:132`) | Pay=red / else=green | **J/B** — Pay=Berry. ⚠ see Ambiguity 1 |
| 2 | Details DIR badge (`details-panel.tsx`) | Pay/Buy=green | **J/B** — Pay/Buy=Jade (`pnl-positive` tone). ⚠ contradicts #1, see Ambiguity 1 |
| 3 | Daily P&L by Book: `KrwCell`, period ribbon (`book-daily-pnl-table.tsx`) | signed green/red | **J/B** |
| 4 | PAY/REC toggle (`pnl-trace-panel.tsx`) | PAY=red solid / REC=green solid | **J/B** — PAY=Berry, REC=Jade solids |
| 5 | `NumericCell` / `NumericInline` (shared) | signed green/red | **J/B** — also recolors Simulation's pricer usage via the shared component |
| 6 | `DeltaIndicator` (shared) | signed green/red | **J/B** — ditto (sim impact-grid consumes it) |
| 7 | `PriceDisplay` negative sign | red | **J/B** — Berry |
| 8 | `Sparkline` (components/data) | `var(--sem-*)` fed to canvas | **J/B** + bug fix: canvas can't resolve `var()` — it had been stroking black; now `PNL_COLORS` literals |
| 9 | Spread Position: last P&L, negative notional | signed green/red | **J/B** |
| 10 | Spread Position: Net-PVBP "residual ok" | green = success | **fg-primary** — success ≠ signed; Jade is locked. ⚠ Ambiguity 2 |
| 11 | `mocks/backtest-snapshot.ts` bull/bear scenario lines | green/red | **J/B** (module currently unimported) |
| 12 | `columns.tsx` DIR badge + KRD context | green/red softs | **J/B** — NOTE this module is **dead code** (nothing imports `createPositionColumnDefs`; the live grid builds inline defs). Migrated so nothing green/red survives a resurrection. ⚠ Ambiguity 3 |
| 13 | `tenor-curve-chart.tsx` (dead, unmounted) | resolved sem green/red | **J/B** literals |
| 14 | Error texts: PnL-trace, Daily-P&L ×2, Overview, PVBP table, constraints-form, upload page, FileUploadRow | red (sem-negative) | **DANGER** — error ≠ signed; red retained under `--sem-danger` |
| 15 | Input validation (border + message) | red | **DANGER** |
| 16 | Button `danger` variant | sem-negative | **DANGER** |
| 17 | Destructive hovers: dockview panel-close, grid row-delete | red | **DANGER** |
| 18 | Top-bar "Reset Layout" option | red | **DANGER** |
| 19 | Badge tones `positive`/`negative` (`badge.tsx`) | green/red pair | **REMOVED** — zero consumers after #2; additive `danger` tone added; gallery updated |
| 20 | Upload READY badge (`file-upload-row.tsx`) | green | **accent** — success/status ≠ signed. ⚠ Ambiguity 4 |
| 21 | Upload ERROR badge | red | **DANGER** tone |
| 22 | StatusDot `live`/`offline` | green / red | live → **fg-primary** (white + ping), offline → **DANGER**. ⚠ Ambiguity 4 |
| 23 | Toast `success` (`toast-store.ts`) | `Intent.SUCCESS` = Blueprint **vendor green** (compiled CSS, unreachable by tokens) | **Intent.PRIMARY** (accent). Errors keep `Intent.DANGER` (vendor red ≈ danger semantic) |
| 24 | Optimal `Callout intent="success"` | vendor green tint | **intent="primary"** |
| 25 | `--pt-intent-success` bridge (`globals.css`) | sem green | **accent**; `--pt-intent-danger` → `--sem-danger` |
| 26 | Tokens `--sem-positive/negative(-soft)` (`tokens.css`) | Blueprint green/red | **Alias-deprecated to Jade/Berry** (`var(--chart-pnl-*)`, softs = family @15%). Removal preferred but impossible: the **live s11 slice** consumes the vars/classes (`pricer-page`, `results-grid-panel`, `scenario-config-panel`, `trade-entry`) and this pass may not touch those files. Any stale reference now renders Jade/Berry — green/red is unreachable. TODO(integration): migrate sim, delete aliases |
| 27 | Tailwind `sem.positive/negative(-soft)` mappings | — | kept, DEPRECATED-commented (sim classes must keep generating CSS); `sem.danger(-soft)` added |
| 28 | `SIM_SERIES_COLORS.carry` / `--chart-series-carry` | Jade-80 (S7 sanctioned exception) | **Aqua** — lockdown revokes the exception; sim resolves the token at runtime so s11 picks it up without a file touch |
| 29 | Legacy `--chart-berry` (#E75353 red accent) | name collided with locked family | **renamed `--chart-scarlet`** (token + tailwind + mirror comments). Sim's `resolveCssVar("--chart-berry", "#E75353")` falls back to the identical hex — zero visual change there |
| 30 | `RV_SERIES_COLORS` `#29A634` green / `#43BF4D` lime (+`#DB2C6F` rose) | series-IDENTITY hues, not semantic | **left** — identity palette, not signed; pre-existing S7 pending item. ⚠ Ambiguity 5 |
| 31 | `CHART_SERIES_COLORS[4]`/`SPREAD_SERIES_COLORS` `#E75353` | series-identity red (dashed spread lines) | **left** (now named scarlet). Same rationale as #30 |
| 32 | Simulation slice (7 green/red sites incl. Bid=green/Ask=red, rates-up=red bp deltas, sim chart-theme mirror) | — | **SIM** — inventoried for integration; renders Jade/Berry already where it consumes shared components/aliases |
| 33 | Blueprint vendor CSS internals (bp5 intent colors) | vendor green/red | out of reach of the token layer; all in-repo *uses* of green intents removed (#23/#24/#25). Error/danger intents deliberately stay red |
| 34 | Tailwind `heat.pos-*/neg-*` mappings (config) | referenced **nonexistent** `--heat-pos-*` vars (never-finished Phase-2 wiring, zero class usage) | **left as-is** — dead but out of scope; noted for cleanup |

Also confirmed absent: Tailwind stock `green-*/red-*/emerald-*/rose-*/lime-*`
classes (zero anywhere), `#26de81`-era hexes (already gone).

## Guard (Task 2) — `scripts/check_semantic_color_lockdown.test.ts`

7 tests over comment-stripped `src/**` + `tailwind.config.ts`, **excluding
`src/features/simulation/**`** with a `TODO(integration)` note, `*.test.*`
exempt. Allowlist is two files — `lib/chart-colors.ts` + `app/tokens.css`
(plus `tailwind.config.ts` for the deprecated name mappings only):

1. Jade/Berry family hexes (all 6) + the rgb-triplet soft forms → semantic homes only.
2. `--ms-jade*`/`--ms-berry*` raw-layer refs → semantic homes only.
3. `sem-positive|sem-negative` (vars or classes) → alias homes only.
4. Tailwind stock green/red classes → banned outright.
5. `#0F9960` extinct; `#DB3737` only as tokens.css `--sem-danger`; plus
   definition-drift pins (danger really is red; aliases really are Jade/Berry).

### Guard red run (seeded, then removed)

Seed: three lines appended to `delta-indicator.tsx` (`"#65C581"`,
`"text-green-500"`, `"var(--sem-positive)"`):

```
× Jade/Berry family values exist only in the semantic modules
    + "src/components/data/delta-indicator.tsx: #65C581"
× retired sem-positive/sem-negative names do not reappear outside the deprecated-alias homes
    + "src/components/data/delta-indicator.tsx: --sem-positive"
× Tailwind stock green/red palette classes are banned everywhere
    + "src/components/data/delta-indicator.tsx: text-green-500"
Tests  3 failed | 4 passed (7)
```

Seed removed; suite back to 138/138. (`git diff` clean against the seed file.)

## Live verification (`docs/session-s12/`, headless, servers stopped after)

1. `01-portfolio-dir-jade-berry.png` — grid Dir `Pay` in Berry / `Rec` in
   Jade **and** the details `PAY` badge in Jade in one frame (the preserved
   contradiction, Ambiguity 1); MtM/PVBP surfaces unchanged.
2. `02-home-daily-pnl-jade-berry.png` — Daily P&L `+231,402` in Jade; PVBP
   heat ramp untouched; top-bar LIVE dot now neutral white.
3. `03/04-pnl-trace-*.png` — PAY active = solid Berry; REC = solid Jade.

## Ambiguities / owner decisions (not silently skipped)

1. **Pay direction is colored inconsistently across surfaces** — grid Dir:
   Pay=Berry; details badge + dead columns.tsx: Pay/Buy=Jade. Both predate
   s12 (they were red-vs-green before); "signs preserved exactly" forbade
   harmonizing. One ruling needed: is PAY the Berry side (as the PAY/REC
   toggle and z-score SHORT already imply) or the Jade side?
2. Non-signed **"good/success" states** lost green and got neutral/accent:
   Net-PVBP residual-ok (fg-primary), upload READY (accent), toast success
   (accent), optimal Callout (primary). If a distinct "success" hue is
   wanted, it needs a new token — Jade is locked.
3. `features/portfolio/columns.tsx` is **dead code** (unimported); candidate
   for deletion at integration.
4. **StatusDot live** = white + ping (was green). Judgment call; swap in one
   line if a different hue is preferred.
5. `RV_SERIES_COLORS` still contains identity green/lime/rose hues that can
   read as semantic on signal charts — pre-existing S7 item, now the only
   green left anywhere; a follow-up re-palette would finish the story.
6. Simulation inherits everything at integration: drop the guard's sim
   exclusion, migrate its 7 sem-* sites, delete the deprecated aliases +
   tailwind mappings, and let its chart-theme fallbacks (`--chart-berry`,
   old carry) be updated. Until then sim already renders Jade/Berry through
   the aliases and shared components — only its two `var(--sem-*)` Bid/Ask
   literals and class names are stale *names*, not stale colors.
