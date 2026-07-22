# RECON2_MERGE_REPORT — both RECON-2 lanes landed; demo runs on this build

2026-07-21. Owner ruling (b): merge first, trader demo on the produced build.
Final mainline `feat/simulation-migration`: merge chain **aebf77c** (SIM) → **b588578**
(RH) → **7b1067d** (eol fix) → this report/docs commit. Tag **recon-v2** = 7b1067d,
the exact commit the running production build was made from. BE **e302593 untouched**
(zero diff, process never touched — up throughout).

## Step 0/1 — state + disjointness

All heads matched the brief (FE 2c0311f · SIM 3d84b46 · RH ae842aa · BE e302593, all
clean; servers 200/200). Lane-diff intersection = exactly `.impeccable/hook.cache.json`
(sanctioned). SIM = simulation slice only; RH = features/home recon strip + Δbp chart +
`hooks/use-recon-range` + `scripts/check_deltabp_reuse.test.ts`.

## Step 2 — merges

| Order | Commit | Lane |
|---|---|---|
| 1 | **aebf77c** | `recon2/sim-anchor` @ 3d84b46 — clean (ort) |
| 2 | **b588578** | `recon2/rh-deltabp` @ ae842aa — one conflict, the hook cache only, resolved per the sanctioned rule |

## Step 3 — gates (derived BEFORE running → observed)

- **vitest**: derived 385/0 = 345 (recon-v1) + 22 (SIM enumeration) + 18 (RH
  enumeration), test files fully disjoint. First run: **383/385 — 2 failed**, both the
  SIM golden identity pins, and the reconciliation was NOT a lane interaction: git
  autocrlf materialized the golden fixture LF in the lane worktree but CRLF on the
  merged mainline checkout, so the byte comparison failed on line endings while the
  JSON payload was identical. Fixed in **7b1067d** (the test normalizes `\r\n` on read;
  the pin still compares the full serialized request; 0 tests added). Re-run:
  **385 passed / 0 failed** — matches the derivation.
- **eslint**: derived 13E/21W (both lanes at baseline, neither touches the 13 error
  sites) → observed **13E / 21W** ✓.
- **tsc** clean · **guards** all green in-suite (contrast gates, cashflow anti-fork,
  krw/hex/token rules, canvas-var, zorder, and RH's source-level Δbp reuse guard — no
  comments naming its guarded identifiers were added anywhere) · **both trees clean** ·
  BE `git diff e302593` empty.

## Step 4 — single build+restart window

`next build` clean (13/13). FE-only restart (kill-check: :3000 free, no orphan node);
BE never touched. Health 200/200. **The running site = this build = the demo.**

## Step 5 — demo dress rehearsal (evidence `recon-evidence-2026-07-21/vmp2-*`)

1. **Anchor selector** ✓ — 국고 5Y design at base 2026-07-15, run 106.2s, Results chip
   **"국고 5Y 목표 +30bp"** (`vmp2-anchor-results-5y.png`); anchor-3Y run 106.9s, chip
   "국고 3Y 목표", normal Results (`vmp2-anchor-results-3y.png`) — identity observed
   live once (byte-proof is the golden pin).
2. **0.5bp floor** ✓ — 10Y anchor, spread10y 12, target 12: red validation names the
   numbers ("…상쇄되어 3Y 환산 기준변동이 0.00bp (< 0.5bp)…"), CTA disabled
   (`vmp2-floor-blocked.png`); target→30 clears it, CTA enabled
   (`vmp2-floor-cleared.png`). (The runCurrent no-request half is unit-pinned; the
   probe script's `role=alert` reading was a probe artifact — the screenshot is the
   evidence.)
3. **정산 CF raw Δ** ✓ — live footer now prints "예상 +1.5억 vs 엔진 +1.5억 **(Δ ₩-2)**",
   "(Δ ₩+3)", "(Δ ₩+2)" … — the F-VMP-1 sub-display drift self-explains; never Δ ₩0
   (`vmp2-cf-footer-0715.png`).
4. **RH Δbp 시계열** ✓ — [잔차 표|Δbp 시계열] toggle live; 16 tenor chips
   D+1/D+91/D+182/…/D+30Y all default-selected; per-tenor series with the D+3Y badge;
   caption states 공백=미매핑/주말 (0 아님) + hover isolation
   (`vmp2-rh-deltabp-default.png`); [잔차 표] unchanged
   (`vmp2-rh-table-unchanged.png`). Chip-filter/hover isolation are pinned in the RH
   lane's tests; the smoke script's chip probe used wrong accessible names ("10Y" vs
   "D+10Y") so those two extra screenshots were skipped — noted, not hidden.
5. **Untouched surfaces** ✓ — Home Daily P&L and Home 일별 대사 render the recon-v1
   numbers exactly (footer Assumed −248.6M | Realized +41.1M | 잔차 +289.6M; 대사 일치
   −6,610,000) (`vmp2-home-dailypnl-unchanged.png`, `vmp2-home-recon-unchanged.png`).
6. **Recommended demo baseDate: 2026-07-15** — live-confirmed: the 5Y/3Y runs at that
   base included swaps (no 스왑 제외 notice → IRS quotes present) and bonds priced off
   exact Credit Matrix data (CM latest = 07-15; IRS carries 07-15 and 07-16 but CM has
   no 07-16 — 07-16 would run bonds off a stale matrix; today 07-21 excludes swaps
   entirely).

## Step 6 — docs preservation

`docs/recon2/RECON2_DESIGN.md` + `docs/recon2/SESSION_PROMPT_recon2_draft.md` committed
with this report (SIM2_DESIGN.md-style loss can't recur for RECON-2's design record).

## Step 7 — push + cleanup

- Tag **recon-v2** @ 7b1067d (the built/running commit). `git push --all` then
  `git push --tags` (combined form refused, as before): mainline 2c0311f→7b1067d, new
  branches `recon2/sim-anchor` + `recon2/rh-deltabp`, new tag. **FE refs 23 → 26.**
  This report/docs commit is pushed as a follow-up on the same branch (docs-only; the
  tag deliberately stays on the built commit). BE: nothing to push.
- Both `wt-recon2-*` worktrees removed (Windows long-path `\\?\` delete again) +
  pruned; lane branches retained and pushed.

## Carried ledger

1. **SIM-2 flag ①** — instrumented curve-cache key-count run still open (smoke observed
   106-112s full-book walls, consistent with the s21 scale; key count needs an
   in-process run).
2. **Mirror unification** — lane-B cash-lane table vs the now-exported CashflowTable;
   diff lane-A's details-panel.tsx edits first.
3. **v2 refactor-closure** — implicit-only FLAG, owner ruling still open.
4. **`_ktb3y_bp` dormant fields** (`rate_path`/`ratePaths`, zero live consumers since
   HARDEN-1) — dead-code candidate for the next cleanup pass; DTO now carries the
   "3Y 관측" labeling mandate if revived instead.
5. **SIM2_DESIGN.md confirmed lost** (twice-verified); SIM2_REPORT.md is the standing
   authority.
6. F-VMP-1 root drift (₩2-3/window engine-lane float summation) remains open at the
   engine level; the display now self-explains it (owner-ruled transparency fix).

**End state: both servers RUNNING on the merged recon-v2 build (FE production :3000,
BE 4-worker :8000, health 200/200) — the site as left is the demo, demo-ready.**
