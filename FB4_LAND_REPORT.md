# FB4_LAND_REPORT — fb4/curve-preview landed, :3000 on the new build, live-verified

2026-07-21, evening (owner ruling: FB4 lands tonight for local eye-verification
before tomorrow's Vercel/NSSM deployment). FE-only landing; **BE untouched
throughout** (v2 @ 11a4daf on :8000, verified before and after).

## Steps 0–2 — merge + gates

Step 0 all-match (FE acb395f clean · lane `fb4/curve-preview` @ 2228c78 clean, 5
commits as briefed · BE 11a4daf clean · servers 200/200 · no pre-existing landing
branch). Merge `--no-ff` = **6a530f1** — zero conflicts (not even the hook cache).

Gates, derived → observed, all exact on the first run: vitest **423 passed / 0
failed** (404 baseline + 19 per the lane's enumeration — no autocrlf surprises; the
lane's payload pin reads eol-agnostically per the recon-v2 lesson) · eslint
**13E/21W** · tsc clean · guards green in-suite (incl. the new overlay reuse guard
and the preserved 시계열형 no-fetch pin) · both trees clean · BE-untouched proof
(11a4daf, clean, zero diff).

## Step 3 — single build+restart window (:3000 only)

Build clean 13/13 → old node owner (PID 24644) stopped, kill-check clean (:3000
free, zero node) → `next start` relaunched → FE 200 on first check. **:8000 never
touched** (listener verified intact before and after; BE health 200).

## Step 4 — live smoke (evidence `fb4-evidence/`)

a. **Calendars** ✓ — 시작일 (평가 기준일) + 마감일 (시뮬레이션 종료) pickers present;
   the stepper and every 30D~365D segment GONE (0 matches). A non-preset 100-day
   horizon (07-14 → 10-22) configures and runs (68.2s; Results chip **D+100**).
   Both validations are explicit messages, never silent clamps: 마감일 ≤ 시작일 →
   "마감일은 시작일 이후여야 합니다."; > 365d → the 365-day cap message
   (`fb4-calendar-validation.png`, `fb4-run-100d-results.png`).
b. **Payload identity observed live** ✓ — 시작일 2026-07-14 + 마감일 2027-01-10
   (+180d) reproduces the old 180D preset **pixel-for-pixel**: TR 조달비용 −524.8억 /
   채권평가 −14.8억 / 채권캐리 +455.9억 / 스왑평가 +22.6억 / 스왑캐리 −29.7억 / 토탈
   −90.7억 — identical to the dv01-era capture of the same scenario, 만기 브리지 line
   included (`fb4-run-180d-tr.png` vs `dv01-evidence/dv01-sim-tr-summary-0714.png`).
c. **커브형** ✓ — family chips on the live snapshot: **국고 · IRS · 회사채 · 여전채**
   (the credit-taxonomy-carried set — no chip fabricated for uncarried sectors),
   solid base curves + dashed same-color scenario ghosts
   (`fb4-curve-ghost-overlay.png`).
d. **Scrubber** ✓ — with a shaped scenario (waypoint D+30 set to +25bp), the
   시나리오 시점 (D+n) scrubber appears; driving it to the waypoint reads
   **"D+30 +25.0bp"** in the header readout (terminal badge D+180 +30bp)
   (`fb4-scrubber-shaped.png`).
e. **Regressions absent** ✓ — 시계열형 toggle behavior intact
   (`fb4-timeseries-intact.png`); **zero** `credit-curve/series` requests fired
   during 커브형/시계열형 toggling with unselected families (request-level
   observation); Simulation results unchanged vs the dv01-era capture (= item b).

## Step 5 — push + cleanup

Tag **fb4** @ 6a530f1 (the built/running commit). `git push --all` then `--tags`:
mainline acb395f→6a530f1, new branch `fb4/curve-preview`, new tag. **FE refs
29 → 31.** BE: nothing. `wt-fb4-preview` removed (long-path delete, as ever) +
pruned; branch retained. This report committed + pushed as a docs follow-up (tag
stays on the built commit).

## Carried ledger (verbatim)

- **Three DV01 FE follow-ups**: ① `blotter_as_of` staleness notice (PVBP panel /
  recon caption); ② `dv01_sources`/`frn_positions` mixed-basis disclosure chip;
  ③ FB3 ladder-evidence re-capture — superseded by
  `dv01-evidence/dv01-recon-ladder-0714.png` (잔차 −29.7M), keep with the deploy docs.
- **Simulate `remainingDays` staleness** (+113d aging anchor) — separate enumerated
  BE change; goldens will move again.
- **Ops: blotter refresh** — the export is four months stale (2026-03-23); refresh
  upstream; reval outputs are refresh-independent (pinned), FRN/fallback rows and
  the detected as-of will move by design.
- **Ledger ② (per-sector credit-Δy Assumed variant)** — next in sequence; its target
  is the visible −29.7M panel-grade / −71.8M subset-grade recon remainder.
- Standing hygiene: PnL-Trace → SeriesChart migration · mirror unification (diff
  details-panel first) · s20 minBarSpacing/marker sign-offs · v2 refactor-closure
  FLAG · `_ktb3y_bp` dormant dead-code candidate · RH label-nowrap handoff list ·
  SIM-2 flag ① instrumented key-count run.

**New FE mainline head: `feat/simulation-migration` @ 6a530f1 (tag fb4) + this
report's docs commit — tomorrow's deployment base. Both servers RUNNING (:3000 on
the fb4 build, :8000 on the dv01 build, health 200/200) — owner verification may
begin.**
