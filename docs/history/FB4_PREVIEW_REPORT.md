# FB4_PREVIEW_REPORT — Configure curve preview redesign (T1 date pickers · T2 family overlay)

2026-07-21. Worktree `wt-fb4-preview`, branch `fb4/curve-preview`, base FE **acb395f**.
BE read-only (values flow through the API; no FE-external edit was needed — verified).
No build, no server contact, no push. Commits: **payload fixture (evidence-first) →
T1 → T2 → 2 lint/dead-code fixes** (hashes in `git log acb395f..HEAD`). Worktree left
for the merge pass.

## T1 — 시작일/마감일 date pickers

- 시작일 calendar = the 평가 기준일 (`userBaseDate` store key unchanged, 오늘로 reset
  kept, min/max bounded by the market-data range, **no invented weekend snapping** —
  the value is taken as typed, exactly the old control's behavior; the ◀/▶ steppers
  are gone per the owner design).
- 마감일 calendar = horizon end, a **derived editor**: value = 시작일 + `simDays`;
  committing writes `simDays = diffDays(시작일, 마감일)`. The store/wire contract is
  untouched (baseDate + simDays; 마감일 never stored).
- Validation (explicit, never silent): 마감일 ≤ 시작일 → "마감일은 시작일 이후여야
  합니다." · beyond 365d → "최대 기간 365일을 초과합니다 — {cap date} 이하로
  선택하세요." Both write NOTHING to the store (pinned). Changing 시작일 keeps
  simDays (pinned). Non-preset horizons (e.g. 100d) are now expressible; the waypoint
  regen grid handles them by construction (intermediates at i×30 for i<floor(d/30) +
  exact terminal pin — pinned).

**Payload-pin evidence (evidence-first, RECON2-SIM pattern):** commit 1 froze
`__fixtures__/payload-pin.json` — four representative selections built by
`buildSimulateRequest` at the UNTOUCHED base (default-180d · past-base-90d shaped
+events+spreads · 365d cap edge · non-preset-100d with N1 anchor 5Y) — provably
BEFORE any picker code existed. The ongoing pins: (a) the generator test asserts the
builder still reproduces the fixture byte-for-byte; (b) a configure-stage pin drives
the store THROUGH the 마감일 picker to the non-preset case's selection and asserts
`buildSimulateRequest` output `toEqual`s the frozen bytes. The builder itself
(`scenario-curves.ts`) has **zero diffs** — identity is structural AND pinned.

## T2 — 커브형: base curves × families + scenario ghost overlay

- **Family chips** (sector vocabulary): 국고 · 통안 · IRS · 회사채 · 여전채. A bond
  family chip renders only when the credit taxonomy carries the sector ("every family
  the snapshot carries" — pinned with 통안채 absent from the test taxonomy); IRS is
  always offered (market snapshot source). Default selection 국고+IRS = the pre-FB4
  two lines. Last selected family stays (F2 convention).
- **Solid base + same-color dashed ghost** per family via the existing
  `TermStructureChart` (its `dashed` prop — no chart host changes needed).
- **No forked math:** the ghost is a view over the request's own propagation —
  new pure `buildScenarioOverlay(req, day, families)` consumes
  `lib/recon/path-matrix`'s `createPathEvaluator` (imported, not modified):
  ghost(τ, D) ≡ base(τ) + `cumBpAt(family, τ, D)`/100, with the engine's own
  sector→curve mapping (`sectorToFamily`: 통안채→국채 curve, 여전채→카드채 curve).
  Pinned numerically (a sweep across families × pillars × slices incl. a shaped
  mid-slice) and source-level (`scripts/check_preview_overlay_reuse.test.ts` — the
  lib must import the evaluator; the panel may not touch `shockAtTenor`/
  `generateShockCurves`/`deriveFundingSteps` directly).
- **Terminal equivalence:** at D = simDays the overlay reproduces the OLD two-line
  preview byte-for-byte (`buildInputCurvePreview` comparison pin) — the pre-FB4
  커브형 was the horizon-end special case of the new view.
- **Scrubber:** `isShapedScenario` (the SIM2-4 activation predicate mirrored: off-line
  waypoints, or 금통위 events) decides — parallel scenarios keep ONE terminal overlay
  (no scrubber, pinned); shaped scenarios get a D+n scrubber (the dormant `ui/Slider`
  gets its first caller) stepping every ghost through time slices.
  **Scrubber↔readout binding:** the header readout renders `D+{n} {anchor cum bp}` —
  e.g. dragging to the off-line waypoint day shows exactly `D+45 +25.0bp` (the
  designed anchor-pillar value at that slice, via the same evaluator) and the legend's
  `점선 = 시나리오 (D+45)` follows; pinned including a numeric re-slice sweep of the
  captured ghost points against `cumBpAt(·, ·, 45)`.
- **시계열형 untouched** (its pins pass unchanged); the SIM2-1 no-fetch pin holds
  (every quote hook is `!isPath`-gated) and an UNSELECTED family costs no request
  (per-family gating, pinned via the series-spy's requested-sector inventory).

### Family / token inventory (contrast-gate covered; no new hues, no Jade/Berry)

| Chip | Base-quote source | Shock curve (engine mapping) | Color token |
|---|---|---|---|
| 국고 | credit series 국고채 | 국채 | `--chart-sector-ktb` (sectorColor 국고채) |
| 통안 | credit series 통안채 | 국채 | `--chart-sector-msb` |
| IRS | market snapshot swap quotes | swap | Tangerine (`previewPalette[2]` — the slice's established IRS hue) |
| 회사채 | credit series 회사채 | 회사채 | `--chart-sector-corp` |
| 여전채 | credit series 여전채 | 카드채 | `--chart-sector-cardcap` |

Ghosts reuse the SAME token (dashed) — zero new colors; the S7 gate's token sweep
covers every hue on the surface.

### Render evidence (component-test captures — live screenshots post-merge per rule)

Captured `TermStructureChart` props (the chart-mock's prop inventory in
`curve-view-panel.test.tsx`):
- **Before** (base behavior, kept green until the T2 commit): 2 solid curves —
  `국고채` (Ocean) + `IRS` (Tangerine), terminal shock baked in.
- **After — parallel default:** 4 curves — `국고`/`국고 시나리오(dashed)` in the KTB
  sector token + `IRS`/`IRS 시나리오(dashed)` in Tangerine; legend
  `점선 = 시나리오 (D+180)`; no scrubber.
- **After — 여전채 added:** 6 curves; the pair carries `--chart-sector-cardcap`.
- **After — shaped:** scrubber present (max=simDays), readout `D+90 +30.0bp` →
  drag → `D+45 +25.0bp`, ghost points re-sliced (numeric sweep in-test).

## Gates (final HEAD)

| Gate | Result |
|---|---|
| tsc | clean |
| vitest | **423 / 0 (56 files)** = **404 T0 (re-derived from checkout) + 19 declared**: T1 +6 (5 new configure pins + 1 fixture self-check; 3 re-pins [CHANGED, FB4] inside) · T2 +13 (lib 5 · panel 6 · guard 2) |
| eslint (`npx eslint .`) | **34 problems = 13E/21W** — checkout baseline exact |
| Guards | all green in-suite (incl. the new overlay reuse guard; contrast gate untouched-token argument above) |
| Tree | clean · NO push · no server contact · no build |
| Forbidden surfaces | `git diff --name-only acb395f..HEAD` = configure-stage, curve-view-panel, use-input-curves, input-curve-preview (+tests/fixture/guard/hook-cache) — **zero** scenario-recon files (path-matrix/scenario-recon imported only), **zero** builder-semantics diffs (`scenario-curves.ts` untouched), zero files outside the Simulation family |

## Notes for the merge pass

- Expected intersection with anything concurrent: `.impeccable/hook.cache.json` only.
- Post-merge live checks: Configure shows 시작일/마감일 pickers (try 마감일 < 시작일
  → message, no change); 커브형 default two families with dashed ghosts; add 통안/
  회사채/여전채 chips (present only if the live taxonomy carries them); design an
  off-line waypoint → scrubber appears, readout tracks; 시계열형 unchanged.
