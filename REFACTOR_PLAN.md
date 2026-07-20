# REFACTOR_PLAN — R1 Diagnosis & Design Pass (READ-ONLY)

**Base:** FE `feat/simulation-migration` @ `45008ea`, BE `v2` @ `82d5b69` (both = tag `integration-v5`, both pushed). Working trees verified at these heads with only the documented conventional drift (BE `session6_dashboard_before.*` fresh capture; FE `.impeccable/hook.cache.json` + long-standing untracked reports — the same set recorded in `CLOSEOUT_v5.md`). Both dev servers confirmed down; no other session active. **This pass modified zero source files** — the only writes are this plan and `docs/refactor-r1/` evidence.

**Execution is R2's, and only after the owner approves the checklist at the bottom.**

## T0 — Invariant gate snapshot (fresh capture at the base heads)

Evidence: `docs/refactor-r1/t0-gates-fe.txt`, `t0-gates-be.txt` (pasted terminal output, per the false-pass rule).

| Gate | Value at base (must hold at every R2 commit) |
|---|---|
| FE vitest | **221 passed (221), 33 files, 0 expected-fail** |
| FE tsc `--noEmit` | clean (exit 0) |
| FE eslint repo-wide | **exactly 21 errors** (27 warnings this run; the warning count is environmental — s20 proved it on a pristine base via stash-control. The invariant is the error count.) |
| FE `next build` | clean |
| BE pytest `tests/` | **336 passed + 4 xfailed** |
| BE frozen-market anchors (`test_simulate_api` + `test_simulate_s15` + `test_simulate_s18` + `test_npv_identity_guard` + `test_historical_basis_guard`) | **42 passed** |

Gating anchors (reference, not re-derived): ES B 92 / 71,450,000 · ES C 69 / −432,400,000 · s17 KPI fixture · golden parity · NPV identity · σ invariants · capacity pin. **Config A is not a gate** (v5 closeout, FE `3f50ee6`).

**Invariant qualification for deletion commits:** a dead-code deletion that removes its own tests changes the pytest/vitest count. Rule: move/rename commits preserve counts exactly; an approved deletion commit **declares the new count in its commit message** (e.g. BE spread-backtest removal: 336+4 → 327+4, −9), and that declared count becomes the invariant for subsequent commits. No silent drift.

## T1 — Inventory

Evidence: `docs/refactor-r1/t1-import-graph-fe.txt`, `t1-import-graph-be.txt`.

- **FE:** 193 TS/TSX files under `src/`, 23,235 lines, 507 internal import edges. **Circular dependencies: 0.** Top fan-in: `lib/chart-colors.ts` (22), `lib/api-client.ts` (20), `ui/button` (19), `lib/constants.ts` (17), `lib/rv-instruments.ts` (15).
- **BE:** 73 Python modules in `irs_pricer/`, 13,295 lines, 185 edges. **Circular dependencies: 0. Layering violations (engine/core importing services/api/loaders/db): 0.** The routes → services → engine layering the refactor is meant to produce **already exists and is clean** — the BE work is naming + dead code, not re-layering.
- **Oversized / mixed-concern files:**
  - BE `services/simulation_service.py` — **1,856 lines**; contains its own `build_pvbp_sensitivity` (line 1321) shadowing the name of a *different* function in `portfolio_analytics_service.py` (line 152). Split is **out of R2 scope** (see T4-H).
  - BE `services/portfolio_analytics_service.py` — 921 lines. Watch, don't touch.
  - BE `api/models.py` — 694 lines, all Pydantic schemas; large but single-concern. Leave.
  - FE `lib/api-types.ts` — 724 lines, single-concern type mirror. Leave.
  - FE `features/simulation/components/stages/configure-stage.tsx` (454) and `components/charts/series-chart.tsx` (440) — largest components; both cohesive. Leave in R2.
  - `engine/quant_engine.py` (1,563 lines) is oversized **by design and untouchable** — the byte-identity rule (sha256 `2d600a3a…`, 83,895 bytes) means it never moves, never renames, never reformats. It appears in no move table by construction.
- Structural asymmetries (drive T4): `features/simulation/` is a fully structured slice (api/components/hooks/lib/store/types) while `features/entry-signals/` is 26 files flat; `components/chart/` (singular: ChartFrame, chart-registry) coexists with `components/charts/` (plural: the chart library); the rates-history domain is split between `features/rates-history/` and `components/rate-history/` — **two different spellings of the same domain**; `src/mocks/` is imported by production components.

## T2 — Path-coupled guard census (critical section)

Evidence: `docs/refactor-r1/t2-guard-path-literals.txt` (raw literals per file). Three disarm classes, in decreasing danger:

**Class S — silent scope-leak (a move removes coverage with no red):** directory-walk scans where a file can leave the scanned subtree.

| Guard | Scan scope | What disarms it | R2 rule |
|---|---|---|---|
| `scripts/no_raw_hex_in_charts.test.ts` | `src/components/charts/**` subtree **+** any src file importing `lightweight-charts`; ALLOWLIST pins 4 exact paths (`lib/chart-colors.ts`, `features/simulation/lib/chart-theme.ts`, `features/entry-signals/chart-theme.ts`, `components/charts/lw-chart-base.tsx`) | A hex-bearing file moved *out of* `components/charts/` that doesn't itself import lightweight-charts silently leaves scope. A moved ALLOWLIST file goes loud-red (stale exemption), which is safe but blocks the commit. | Any move into/out of `components/charts/` or of an allowlisted file updates scope+allowlist in the same commit **and re-proves with a seeded violation** (temporary raw hex in the moved file → red → revert; s12 precedent). |
| `scripts/check_canvas_var_colors.test.ts` | same dual scope (charts subtree + lightweight-charts importers) | same silent-leak mechanism for non-importer files leaving the subtree | same rule |
| `scripts/check_zorder_priceformat.test.ts` | **all of `src/`** (walk for `setSeriesOrder`) | move-proof within src; only disarmed if code leaves `src/` (no such move planned) | no action; assert scope unchanged in R2 verify |
| `scripts/check_semantic_color_lockdown.test.ts` | **all of `src/` + `tailwind.config.ts`**; `SEMANTIC_HOMES` pins `src/lib/chart-colors.ts`, `src/app/tokens.css` | scope is move-proof; moving a HOME goes loud-red | no planned move touches either home; if one ever moves, update `SEMANTIC_HOMES` same-commit + seeded violation |

**Class L — loud on move (readFileSync ENOENT = red commit, safe but must be handled same-commit):**

| Guard | Pinned path(s) |
|---|---|
| `src/components/charts/chart-defaults.test.ts` (s14 pin + s19 R2b `BASE_CHART_OPTIONS` assertions) | `SLICE_HOSTS`: `features/simulation/components/charts/lw-line-chart.tsx`, `rate-fan-chart.tsx` |
| `src/lib/direction-color.test.ts` (single-source pin) | `features/portfolio/positions-grid.tsx`, `features/portfolio/details-panel.tsx` |
| `src/features/entry-signals/marker-pins-s20.test.ts` (z-crossing source-scan: requires `pinnedOscillatorMarkers`, forbids `wasBreaching`) | `zscore-oscillator-panel.tsx` **resolved relative to the test's own directory** — panel and test must move together |
| `src/features/simulation/lib/fan-labels.test.ts` | `../components/panels/distribution-chart-panel.tsx` relative to test |
| `scripts/check_heat_ramp_contrast.test.ts`, `scripts/check_chart_contrast.ts` | `src/app/tokens.css` |
| BE `tests/test_curve_cache.py`, `test_simulate_api.py`, `test_simulate_s15.py`, `test_simulate_s18.py` | `tests/data/*` fixtures relative to test file — move together |
| BE `tests/test_portfolio_loader.py` | `parents[2]/Data/` — couples to the **repo folder's position**, not its name; unaffected by in-repo moves |

**Class M — mock-seam (the subtlest):** `src/components/charts/krw-format-guard.test.tsx` `vi.mock`s **five module specifiers by path**: `@/components/charts/snap-reticle`, `@/hooks/use-api`, `@/features/entry-signals/use-entry-signals-data`, `@/features/entry-signals/use-pinned-backtest`, `@/stores/entry-signals-store`. If a move rewrites the component's imports but not the test's `vi.mock` specifiers, mocks can detach. R2 rule: any move of a mocked module updates the `vi.mock` specifiers in the same commit, then **seeded-violation proof**: temporarily break one fixture value → the guard must go red → revert. Also loud on the s19 R2b side: `backtest-defect-s19.test.ts`, `full-domain-fit.test.ts`, `fit-harness.ts` consume `BASE_CHART_OPTIONS` by import — compiler-checked, mechanical rewrite suffices.

**Universal R2 rule:** move + all guard-path updates in one commit; run the seeded-violation red-proof for every Class S/M guard whose scope or seam the commit touched; paste the red run into `docs/refactor-r2/`.

## T3 — Smell inventory

Evidence: `docs/refactor-r1/t3-orphan-candidates.txt`.

| Item | Detail | Grade |
|---|---|---|
| **Dead FE spread-backtest client** | `useSpreadBacktest` in `hooks/use-api.ts` + `spreadBacktestApi` (`lib/api-client.ts`) + request/response types: **zero callers** (only a comment mention in `entry-signals-store.ts`); no FE test references → 221 unchanged | **delete** (R2) |
| **BE `/api/spread-backtest` chain** | `api/routers/spread_backtest.py`, `services/spread_backtest_service.py`, app include, **9 tests** | **delete, owner-gated** — it is a live API surface; removal declares 336+4 → 327+4 |
| **Orphan FE modules (fan-in 0)** | 17 candidates. High-confidence retired: `features/simulation/simulation-workspace.tsx` (pre-s15 staged flow), `components/layout/tab-dockview.tsx` (dockview retired), `components/data/data-grid.tsx` (pre-TanStack), `mocks/backtest.ts` + `mocks/backtest-snapshot.ts`, `hooks/use-manual-portfolio-metrics.ts`, `features/portfolio/columns.tsx`. Ambiguous: `theme-provider/theme-script` (vs inline no-flash init), `charts/sparkline`, `portfolio-heatmap`, `tenor-curve-chart` | **delete after per-file verification** — the graph can't see string registries / Next conventions; each deletion pre-verified by grep + tsc + build + `/dev/components` gallery render |
| **Unused ui/ primitives** | `segmented-control`, `select`, `slider`, `toast`, `tooltip` have fan-in 0 — not even the dev gallery imports them (contradicting the Phase-2 "gallery renders every component" claim — see Appendix A) | **leave-with-rationale**: they are the DESIGN.md primitive library surface, cheap to keep; deleting narrows the design system without owner intent |
| **Branding strays** | untracked `public/bulb-icon.png`, `public/mirae-logo.png` at public root (canon lives in `public/brand/`) | **delete from disk** (untracked — no commit). Committed `public/Mirae_Asset_Center1.png` is **live** (login background) — keep |
| **`src/mocks/` misnomer** | `home.ts`, `pricer.ts` imported by production components (`portfolio-heatmap`, `tenor-curve-chart`, `pricer-page`) — placeholder data, not test mocks | **relocate + rename** → `lib/placeholder-data/` |
| **`components/chart/` vs `components/charts/`** | singular dir holds `ChartFrame.tsx` (9 importers) + `chart-registry.tsx`; plural dir is the chart library | **relocate** (merge into `components/charts/`) |
| **rates-history naming split** | `components/rate-history/instrument-selector.tsx` (4 importers) vs `features/rates-history/` + route `(workspace)/rates-history` | **relocate + rename** to `features/rates-history/` |
| **`ChartFrame.tsx` casing** | only PascalCase filename in a kebab-case codebase | **rename** → `chart-frame.tsx` (case-change: two-step `git mv` on Windows, see T4) |
| **BE duplicate name, distinct logic** | `build_pvbp_sensitivity` ×2 — portfolio (`PositionData`+snapshot+fixings) vs simulation (`FrontendPosition`, frozen FE contract). **Not a DRY merge** (principle 3 — domain-distinct) | **rename** simulation's → `build_frontend_pvbp_sensitivity` |
| **BE `scripts/test_*.py` collection trap** | diagnostic scripts named `test_*` break bare `python -m pytest` (iv4 note) | **rename** prefix → `diag_*` |
| **F-04 PVBP sign double-convention** | bond PVBP long=+ (blotter, 3 consumers) vs long=− then `abs()` (allocation `_revalue`); same name, opposite conventions (EVALUATION_REPORT F-04) | **leave-with-rationale in R2** — a sign-convention unification is logic-adjacent; document-only commit allowed, code change deferred (Appendix A) |
| **`web/` Vite reference client** | 64 tracked files (node_modules/dist are local-only, not tracked), documented in README as the API-consumption reference | **leave-with-rationale**; owner may opt to delete (T5) |
| **Magic numbers (list-only; naming is R2 and only where behavior-identical)** | `fit-harness.ts:112` barSpacing clamp ceiling `this.width_ * 0.5` (mirrors LWC internal); `full-domain-fit.ts` 2-per-trigger re-assert budget; BE ttl 60s default in `core/ttl_cache.py` consumers. Counter-examples already done right: `_MAX_ENTRIES = 65536`, `POLICY_BASE_RATE_KRW`, `minBarSpacing: 0.05` | **list only** |
| Commented-out code blocks | swept both repos: **none found** | — |

## T3b — Doc-drift census

Living docs (`README` ×2, `PRODUCT.md`, `DESIGN.md`, `WORK_ORDER.md`, `MIGRATION_PLAN.md`, `CLAUDE.md`, script headers) swept for contradictions with code-encoded policy (`--reload`, worker count, `IRS_PRICER_CURVE_CACHE`, double-start guard, funding constants, anchor policy, retired 35-trade capture): **zero contradictions at base.** The two `--reload` README contradictions found at v5-closeout were fixed there (FE `45008ea`, BE `82d5b69`); `start-frontend.ps1` exists as claimed; no stale 2.60% funding or 35-trade references outside historical reports (which are point-in-time records, exempt by design). One reality-vs-claim drift (gallery coverage) is logged in Appendix A rather than here since the drifted statement lives in a historical phase log.

## T4 — Target structure & move plan

**FE target:** `features/<tab>/` slices (each optionally `components|hooks|lib|store|api` as simulation already does) + `components/` (shared library: `charts/`, `ui/`, `data/`, `layout/`, `providers/`, `upload/`) + `lib`/`stores`/`hooks`/`types`. **BE target:** current layering is already correct — no directory moves; naming and scripts only.

Move mapping (every mover; `git mv` exact; blast radius = importer files to rewrite):

| # | Old → New | Command | Blast | Risk |
|---|---|---|---|---|
| M1 | `src/components/chart/ChartFrame.tsx` → `src/components/charts/ChartFrame.tsx` | `git mv src/components/chart/ChartFrame.tsx src/components/charts/` | 9 | **Class S scope-growth**: file *enters* the `no_raw_hex`/`canvas_var` charts subtree — expect new scope hits; pre-scan before commit |
| M2 | `src/components/chart/chart-registry.tsx` → `src/components/charts/chart-registry.tsx` (dir `components/chart/` dies) | `git mv` as above | ~5 | same as M1 |
| M3 | `src/components/rate-history/instrument-selector.tsx` → `src/features/rates-history/instrument-selector.tsx` | `git mv` | 4 | low; leaves no guard scope |
| M4 | `src/mocks/{home,pricer}.ts` → `src/lib/placeholder-data/{home,pricer}.ts` | `git mv` ×2 | 3 | low |
| M5 | `features/entry-signals/` flat → slice layout: panels (`price-panel`, `zscore-oscillator-panel`, `equity-curve-panel`, …) → `components/panels/`; `configure-stage` → `components/stages/`; `use-*` hooks → `hooks/`; `fit-harness`/`full-domain-fit`/`marker-trade-correspondence` → `lib/`; **tests move with their subjects** | `git mv` per file (26 files) | ~15 | **highest**: Class L `marker-pins-s20` same-dir resolution; Class M `krw-format-guard` vi.mock specifiers ×3 entry-signals paths; `no_raw_hex` ALLOWLIST entry `features/entry-signals/chart-theme.ts`. All three updated same-commit + seeded-violation proofs |
| M6 | Root historical reports (`REPORT_s10..s20`, `REPORT_integration_v3/v4/v5`, `INTEGRATION_V2_REPORT`, `SESSION_BRANDING_REPORT`, `SESSION_PNL_RUN_REPORT`, `HANDOFF_chart_colors`, `CLOSEOUT_v5`, `DIAG_*`) → `docs/history/` | `git mv` ×~17 | 0 code; README + cross-doc links updated same commit | low; living docs (`README`, `PRODUCT`, `DESIGN`, `WORK_ORDER`, `MIGRATION_PLAN`, `CLAUDE.md`) stay at root |
| R1 | `ChartFrame.tsx` → `chart-frame.tsx` (after M1) | **two-step, Windows case rule:** `git mv ChartFrame.tsx chart-frame.tmp.tsx && git mv chart-frame.tmp.tsx chart-frame.tsx` | 9 | case-only-adjacent rename — single-step `git mv` can silently no-op on NTFS; precedent: GitHub itself case-fixed the BE repo name |
| R2 | BE `simulation_service.build_pvbp_sensitivity` → `build_frontend_pvbp_sensitivity` | in-file rename + its callers | in-module | low; anchors pin behavior |
| R3 | BE `scripts/test_*.py` → `scripts/diag_*.py` | `git mv` per file | 0 imports (standalone) | verify none imported by `tests/` first |
| — | `irs_pricer/engine/quant_engine.py` | **never moves, never renames** | — | byte-identity rule |
| T4-H (deferred) | `simulation_service.py` split into `services/simulation/` package with re-export shim | — | — | **out of R2** — proposed for R3 with its own anchor plan |

**Proposed R2 commit stack** (one domain per commit, gates green at each, deletions → moves → renames → barrel cleanup):

1. `del(fe): spread-backtest client chain` (hook, api-client, types, queryKey) — counts unchanged.
2. `del(fe): verified orphans` — per-file verification protocol; counts unchanged.
3. *(disk only, no commit)* remove untracked root pngs.
4. `move(fe): components/chart → components/charts` (M1+M2, scope pre-scan).
5. `move(fe): rates-history unification` (M3).
6. `move(fe): mocks → lib/placeholder-data` (M4).
7. `move(fe): entry-signals slice layout` (M5 — the guard-heavy commit; all three guard updates + seeded red-proofs inside).
8. `move(fe): historical reports → docs/history` (M6).
9. `rename(fe): chart-frame casing` (R1, two-step).
10. `cleanup(fe): import/barrel tidy` — only if steps 4–9 left mechanical debris; no new barrels invented.
11. `rename(be): frontend pvbp builder` (R2).
12. `move(be): scripts diag_ prefix` (R3).
13. *(owner-gated)* `del(be): spread-backtest endpoint` — declares 327+4.

## T5 — Owner-decision items (report-only, not in R2 until ruled)

| # | Item | Options | Recommendation |
|---|---|---|---|
| O1 | **Project folder name `UIUX_test`** | (a) rename to match the GitHub repo (`Rates-Portfolio` / `rates-portfolio-fe`), (b) keep | (a), but **after** R2 lands — it invalidates every absolute path in scripts/memory/worktrees at once; do it as its own final step with nothing else in flight |
| O2 | **Browser tab title `"Future"`** (`app/layout.tsx` metadata: title and description are both literally "Future") | (a) product name per PRODUCT.md (e.g. "KRW Rates Portfolio"), (b) desk-brand title, (c) keep | (a) — it's the only user-visible string still carrying a placeholder |
| O3 | **BE spread-backtest endpoint deletion** (commit 13) | delete / keep dormant | delete — UI-orphaned since iv2, client side already dead in commit 1; declared count 327+4 |
| O4 | **Untracked owner reports** (`SESSION1–5_REPORT`, `DIAGNOSIS_REPORT`, `EVALUATION_REPORT`) | commit into `docs/history/` / leave untracked | commit — they're the F-XX findings source and memory references them; untracked = one `git clean` from gone |
| O5 | **`web/` Vite reference client** (64 tracked files) | keep as documented reference / delete | keep; revisit after R3 |

## Appendix A — Found, not fixed (never enters R2)

1. **F-04** bond-PVBP sign double-convention (see T3) — pre-existing, currently neutralized by `abs()`; unification is a logic change.
2. **Gallery coverage drift**: `/dev/components` gallery does not import `segmented-control`, `select`, `slider`, `toast`, `tooltip` despite the Phase-2 "renders every component" claim — either gallery gap or the claim is stale. Report-only.
3. **`app/layout.tsx` metadata description `"Future"`** — placeholder shipped to `<meta>`; folded into O2.
4. **eslint 21-error red baseline** (pnl-trace `any` ×4 etc.) — pre-existing, tracked, not R2's to fix.
5. **~82s FM residual, s22 cancel, s20/minBarSpacing sign-offs** — separate tracks, unchanged.

## Owner approval checklist (gate for R2)

- [ ] **Move mapping** M1–M6 approved as listed (or lines struck)
- [ ] **Deletion list** approved: FE client chain + verified-orphan list; per-file verification protocol accepted
- [ ] **O3**: BE spread-backtest endpoint — delete (327+4 declared) or keep
- [ ] **Rename decisions**: R1 casing, R2 pvbp builder, R3 diag prefix
- [ ] **R2 sequencing** (13-step stack) approved, incl. the invariant-qualification rule for deletion commits
- [ ] **T5 rulings** recorded for O1/O2/O4/O5 (may be deferred without blocking R2 steps 1–12)
