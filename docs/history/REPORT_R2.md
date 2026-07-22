# REPORT — R2 Refactor Execution Pass (2026-07-20)

Executes `REFACTOR_PLAN.md` under the dispatched owner rulings 1–5. Base verified at FE `94247df` / BE `82d5b69` (T0 below). **Both repos pushed**; folder renames landed (`UIUX_test` → `krw-fi-pms`, `IRS Pricer_Mock` → `krw-fi-pms-backend`); all worktrees repaired. Evidence: `docs/refactor-r2/`.

## T0 — Preflight (all four checks passed before any change)

1. `git show 94247df --stat`: exactly 7 files / 583 insertions, per-file counts matching the dispatch (155/9/20/215/50/112/22). HEAD == `94247df`, ahead-1 of origin, nothing outside those paths.
2. **Phantom sweep `f8c2d41`: negative in both repos** — `git cat-file -t` fatal, 0 hits in `log --all` and reflog. Recorded.
3. BE: 0 commits since `82d5b69`; tree clean except conventional `session6_dashboard_before.*` drift.
4. Fresh gates (`t0-preflight-fe.txt`, `t0-preflight-be.txt`): FE 221/0 + tsc/build clean + eslint 21 errors; BE 336+4 xfail + 42 anchors.

## Per-commit table (declared vs measured, every commit gated)

| # | Commit | Plan step | vitest | eslint err | pytest | anchors |
|---|---|---|---|---|---|---|
| 1 | FE `8845c2f` | del: spread-backtest client chain | **221/0** (declared unchanged) | 21 | — | — |
| 2 | FE `c701f62` | del: 13 verified orphans | **221/0** (declared unchanged) | 21 | — | — |
| 3 | *(no commit)* | disk-only: untracked root pngs removed | — | — | — | — |
| 4 | FE `b970437` | move M1+M2: `components/chart` → `charts` (+`detach.ts`, see deviations) | 221/0 | 21 | — | — |
| 5 | FE `e436d21` | move M3: rates-history unification | 221/0 | 21 | — | — |
| 6 | FE `786ebb9` | move M4 (as-verified: `pricer.ts` only) | 221/0 | **21→20 DECLARED** (see below) | — | — |
| 7 | FE `89d847a` | move M5: entry-signals slice layout (guard-heavy) | 221/0 | 20 | — | — |
| 8 | FE `64c731f` | move M6: reports → `docs/history` | 221/0 | 20 | — | — |
| 9 | FE `51b0812` | rename R1: `ChartFrame.tsx` → `chart-frame.tsx` (two-step NTFS) | 221/0 | 20 | — | — |
| 10 | *(no commit)* | barrel/import cleanup — **debris scan clean, documented no-op** | — | — | — | — |
| 11 | BE `c955233` | rename R2: `build_frontend_pvbp_sensitivity` | — | — | 336+4 | 42 |
| 12 | BE `fda9bd7` | move R3: `scripts/test_*` → `diag_*` (bare-pytest collects 340 cleanly — iv4 trap closed) | — | — | 336+4 | 42 |
| 13 | BE `9190d88` | del O3: `/api/spread-backtest` endpoint chain | — | — | **327+4 DECLARED = measured** | 42 |
| N1 | FE `a6e954a` | naming (ruling 5): tab title "KRW FI PMS", package `krw-fi-pms`, README pointers | 221/0 | 20 | — | — |
| N2 | BE `4cf96a3` | naming (ruling 5): README pointers | — | — | 327+4 | 42 |

**Final gates at the stack heads, post-folder-rename** (`final-gates-fe.txt`, `final-gates-be.txt`): FE 221/0, tsc clean, eslint 20 errors, build clean; BE 327+4 xfail, 42 anchors. Golden parity suites inside the 327 are green; anchors byte-exact.

**Declared eslint baseline change 21 → 20 at step 6** (`eslint-baseline-21to20-step6.txt`): `pricer-page.tsx`'s `@/mocks/pricer` import violated the slice-isolation `no-restricted-imports` rule — one of the 21 baseline errors. The approved `@/lib/placeholder-data/` destination is a *sanctioned* `@/lib/*` path under that same rule, so the move cures exactly that error (stash-control verified; the other 20 errors byte-identical). 20 is the new FE red baseline.

## Guard red-proofs (S/M classes, s12 protocol)

| Commit | Guard | Proof |
|---|---|---|
| step 4 | `no_raw_hex` (S) — files *entering* the charts subtree | seeded `#ff0000` in moved `ChartFrame.tsx` → gate red naming the new path → reverted (`redproof-step4-no-raw-hex.txt`) |
| step 7 | `krw-format-guard` (M) — 2 vi.mock specifiers repointed to `hooks/` | seeded formatter removal in moved `equity-curve-panel` → guard red through re-attached mocks ("es-equity: KRW series must carry a custom formatter") → reverted (`redproof-step7-krw-format-guard.txt`) |
| step 7 | `no_raw_hex` (S) — ALLOWLIST repointed to `lib/chart-theme.ts`; scope follows moved LWC importer | seeded `#ff0000` in moved `price-panel` → gate red at the NEW path; repointed allowlist green (`redproof-step7-no-raw-hex-scope.txt`) |

Class-L guards needed only mechanical same-commit path updates; `marker-pins-s20` moved with its subject so its same-dir resolution never broke; `fan-labels`, `chart-defaults`, `direction-color`, both BE fixture suites — none of their pinned paths moved.

## Orphan verification outcomes (ruling 3)

**Deleted (13):** `charts/{portfolio-heatmap,sparkline,tenor-curve-chart}`, `data/data-grid`, `layout/{tab-dockview,theme-provider,theme-script}`, `portfolio/columns`, `simulation/simulation-workspace`, `hooks/use-manual-portfolio-metrics`, `mocks/{backtest,backtest-snapshot,home}` — each grep-verified for string registries/dynamic imports/config refs; `mocks/home.ts` is a **cascade orphan** (only importers were the two deleted charts).
**Retained with reason (5):** `ui/{segmented-control,select,slider,toast,tooltip}` — fan-in-0 but they are the DESIGN.md primitive library surface (plan grade: leave-with-rationale).
**Newly exposed for R3 (not on the approved list, not touched):** `features/simulation/{pricer-page,impact-grid,trade-entry}.tsx` + `stores/simulation-store.ts` — the legacy pricer-sandbox family whose former root (`simulation-workspace`) was on the list; also `lib/placeholder-data/pricer.ts` becomes orphaned if that family goes. Note: `charts/sparkline` (deleted) is distinct from `data/sparkline` (gallery-used, kept).

## Old → new path map (as landed)

| Old | New |
|---|---|
| `components/chart/{ChartFrame,chart-registry,detach}` | `components/charts/{chart-frame,chart-registry,detach}` |
| `components/rate-history/instrument-selector.tsx` | `features/rates-history/instrument-selector.tsx` |
| `src/mocks/pricer.ts` | `src/lib/placeholder-data/pricer.ts` |
| `features/entry-signals/` (flat, 26 files) | `…/components/panels/` (7+2 tests), `…/components/stages/` (4+1 test), `…/components/{signal,trades}-columns`, `…/hooks/` (3+1 test), `…/lib/` (4+2 tests); `entry-signals-workspace.tsx` stays at slice root |
| root `REPORT_*/SESSION_*/HANDOFF_*/CLOSEOUT_v5/INTEGRATION_V2*.md` (18) | `docs/history/` |
| BE `scripts/test_{ccp_target,ccp_target_t,interpolators,npv}.py` | `scripts/diag_*.py` |
| folder `UIUX_test` | `krw-fi-pms` (package name `krw-fi-pms`, tab title "KRW FI PMS") |
| folder `IRS Pricer_Mock` | `krw-fi-pms-backend` |

`quant_engine.py`: untouched by construction. `simulation_service.py` split: still deferred to R3.

## Push confirmation (`push-lsremote.txt`)

FE `45008ea..a6e954a` → `github.com/wwoo1116-cell/Rates-Portfolio` (21 refs; includes R1's `94247df`). BE `82d5b69..4cf96a3` → `CD-IRs-NPV-Pricer` (14 refs; GitHub redirects to the case-fixed `CD-IRS-NPV-Pricer.git`). **Remote-rename note for the owner (report-only):** the GitHub repo names still say `Rates-Portfolio` / `CD-IRS-NPV-Pricer`; renaming them to match `krw-fi-pms(-backend)` is your optional click — redirects will keep local origins working either way.

## Deviations & incidents (all disclosed, all resolved in-session)

1. **`detach.ts`** — third file in `components/chart/` the R1 mapping missed; moved with M1+M2 (the plan's stated intent was that the singular dir dies).
2. **M4 shrank** — `home.ts`/`backtest*.ts` were deleted as verified orphans before the move; only `pricer.ts` moved.
3. **Errant `git add -A` at step 8** briefly committed the 7 unruled untracked owner reports (O4 was not dispatched); caught immediately, **amended out before any push** (final step-8 commit `64c731f` contains exactly 18 renames + README; the reports are untracked again).
4. **Red-proof revert via `git checkout --`** at step 7 restored one file from the index, wiping its unstaged import rewrites — caught by tsc, re-applied, full suite re-verified.
5. **pnpm virtual store is path-bound** — the folder rename required one `CI=true pnpm install` relink (39s) before FE gates would run; each `wt-s*-fe` worktree will need the same one-time relink on next use.
6. **eslint 21→20** — declared at step 6 (see above), a cure not a mask.
7. **`wt-iv4-live`** is an inert empty directory (no `.git`) — leftover from iv4, ignorable/deletable at the owner's leisure.

## Found, not fixed (appendix — nothing here entered R2)

- F-04 bond-PVBP sign double-convention (unchanged; the step-11 rename removed the *name* collision only).
- Gallery coverage drift: `/dev/components` renders none of the five retained ui/ primitives despite the Phase-2 claim.
- Legacy pricer-sandbox family + `placeholder-data/pricer.ts` — R3 deletion candidates once the owner rules.
- `MIGRATION_PLAN.md` and `docs/history/*` retain old folder names by design (point-in-time records).
- ~82s FM residual, s22 cancel, s20 marker-suppression + minBarSpacing sign-offs — separate tracks.

## Final stacks, verbatim

FE (`git log --oneline 94247df..a6e954a`):
```
a6e954a rename(fe): KRW FI PMS naming (R2 naming step, ruling 5)
51b0812 rename(fe): ChartFrame.tsx -> chart-frame.tsx (R2 step 9, R1 casing)
64c731f move(fe): historical reports -> docs/history (R2 step 8, M6)
89d847a move(fe): entry-signals slice layout (R2 step 7, M5 — guard-heavy)
786ebb9 move(fe): mocks -> lib/placeholder-data (R2 step 6, M4 as-verified)
e436d21 move(fe): rates-history unification (R2 step 5, M3)
b970437 move(fe): components/chart -> components/charts, singular dir retired (R2 step 4, M1+M2)
c701f62 del(fe): 13 verified orphans (R2 step 2)
8845c2f del(fe): spread-backtest client chain (R2 step 1)
```
BE (`git log --oneline 82d5b69..4cf96a3`):
```
4cf96a3 rename(be): krw-fi-pms-backend naming (R2 naming step, ruling 5)
9190d88 del(be): /api/spread-backtest endpoint chain (R2 step 13, O3 approved)
fda9bd7 move(be): diagnostic scripts test_* -> diag_* (R2 step 12)
c955233 rename(be): simulation pvbp builder -> build_frontend_pvbp_sensitivity (R2 step 11)
```
(This report is committed on top of `a6e954a` and pushed; its own hash is in the closing message of the session report.)
