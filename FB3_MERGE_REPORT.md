# FB3_MERGE_REPORT — both FB3 lanes landed; the live footer's numbers are now RIGHT

2026-07-21. Numeric-bug priority merge: until this landed, the live daily-recon footer
carried a sign-inverted Assumed leg (+497.1M of manufactured residual on the
reproduced date). Corrected, built, smoked, pushed.

## Step 0/1 — state + disjointness

FE b5b4cac clean · lane A `fb3/rh-fixes` @ 1c2673c · lane B `fb3/recon-bridge` @
539050a · BE e302593 clean (zero diffs claimed and verified) · servers 200/200.
Name-only diff intersection = the sanctioned hook cache only.

## Step 2 — merges

| Order | Commit | Lane |
|---|---|---|
| 1 | **e0129ee** | fb3/rh-fixes (F1 liveness gate, F3 fixed coefficients) — clean |
| 2 | **e361e11** | fb3/recon-bridge (sign fix, bridge ladder, F4a, nowrap) — hook-cache conflict only, resolved per rule |

## Step 3 — gates (derived → observed)

- vitest: derived **404/0** = 385 (fb3 base) + 12 (lane A enumeration) + 7 (lane B
  enumeration), test-file sets fully disjoint → observed **404 passed / 0 failed**,
  first run, no reconciliation needed (the recon-v2 autocrlf lesson stayed a lesson).
- eslint: derived **13E/21W** → observed **13E/21W**.
- tsc clean · guards all green in-suite (incl. lane B's updated recon naming pins —
  old footer wording pinned absent — and the Δbp reuse guard) · both trees clean ·
  BE untouched (e302593, clean, zero diff).

## Step 4 — single window

Build clean 13/13 → FE-only restart (kill-check: :3000 free, no orphans) → 200/200.
BE process untouched throughout.

## Step 5 — live smoke (evidence `fb3-evidence/`)

a. **Sign fix — headline.** Home recon @ D−1 2026-07-14 (`fb3-home-ladder-after.png`;
   before = recon-v2's `recon-evidence-2026-07-21/vmp2-home-recon-unchanged.png`):
   - M3 grid signs now agree with realized direction — 국고채 4Y reads **+43.9M** on a
     yields-down day (was −43.9M); IRS row correspondingly flipped.
   - Ladder verbatim: **테타 (T−1 기지) +285.8M + ASSUMED (PVBP×Δbp) +248.6M = 예상
     PNL +534.4M vs REALIZED (테타+채권평가+스왑평가) +326.9M → 잔차
     컨벡시티(+베이시스) −207.5M (−63.5%)**, with **펀딩 −267.8M** the only
     비교-대상-아님 chip. The manufactured +497.1M is gone (old 잔차 +289.6M → new
     −207.5M = exactly the 2×|Assumed| inversion delta). The remaining residual is the
     documented bond-side ledger (swap side closes to −1.7M per lane B): open items
     ①/② below — basis-grain on the swap leg as demanded; the bond leg's magnitude is
     precisely why ① is open.
b. Ladder present on all three 대사 surfaces: Home ✓, RH subtab ✓ (`fb3-rh-ladder.png`),
   Simulation 시나리오 대사 ✓ (`fb3-sim-recon-ladder.png`, ladder terms present in the
   per-path form). Scenario 잔차 byte-unchanged vs recon-v2 is pinned by lane B's
   scenario-recon tests (the ladder re-labels; the values were already sign-correct on
   that surface).
c. Path matrix (F4a): the no-MPC run renders **0.0** at the short-end cells — 256
   zero-cells counted in the visible matrix, none as "—"
   (`fb3-sim-path-matrix-zeros.png`). The MPC-event stepping variant was not driven
   live (event-form scripting out of smoke proportion) — covered by lane B's
   path-matrix pins; noted, not hidden.
d. **F1** — PnL Trace opened from a chart click, then notional changed 3× (150/220/80):
   chart canvases + header survived every re-trace (`fb3-pnltrace-after-changes.png`).
   **F3** — spread builder: **zero weight inputs**; coefficients read-only **+1/−1**
   and **+1/−2/+1** (`fb3-spread-builder{,-fly}.png`); a canonical 2-leg spread added
   and rendering (`fb3-spread-series.png`) — the series math is untouched
   (reference-identity pin), recon-v2-identical by construction.
e. Nowrap: the **경로 매트릭스** subtab measures 96×28px — single line, no mid-word
   break (was the wrapped "경로 매트릭\n스" visible in the recon-v2 evidence). Lane
   A's RH-tab label handoff list remains OPEN (not fixed here, per instruction).

## Step 6 — push + cleanup

Tag **fb3** @ **e361e11** (the built/running commit). `git push --all` then
`git push --tags`: mainline b5b4cac→e361e11, new branches `fb3/rh-fixes` +
`fb3/recon-bridge`, new tag. **FE refs 26 → 29.** BE: nothing to push. Both
`wt-fb3-*` worktrees removed post-push (long-path delete, again), branches retained.
This report is committed + pushed as a docs follow-up on the same branch (tag stays
on the built commit).

## Carried ledger (owner sequencing)

**NEW, Phase-1 discoveries (lane B) — OPEN:**
1. **① Blotter bond PVBP overstates reval DV01 by ~42%** (both testable dates) — this
   questions the PVBP Sensitivity panel's headline numbers AND is the dominant term of
   the remaining −207.5M recon residual. Needs a dedicated diagnosis lane (workbook
   PVBP provenance vs bump-reval).
2. **② Per-sector credit-Δy variant** to close the −96.9M basis component (credit
   민평 moves vs swap-pillar Δbp).

**Prior ledger:** PnL Trace → SeriesChart migration (retires the F1 wiring class) ·
ES-revival migration check · SIM-2 flag ① instrumented key-count run · mirror
unification (diff lane-A details-panel edits first) · s20 minBarSpacing/marker
sign-offs · v2 refactor-closure implicit-only FLAG · `_ktb3y_bp` dormant fields
dead-code candidate · RH-tab label nowrap handoff list (lane A).

Servers RUNNING on the merged build (FE production :3000, BE 4-worker :8000, 200/200).

**New mainline head: `feat/simulation-migration` @ e361e11 (tag fb3) — plus this
report's docs commit on top; FB4-PREVIEW bases on the post-report head recorded in
git.**
