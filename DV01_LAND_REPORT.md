# DV01_LAND_REPORT — dv01/fix landed on v2, :8000 restarted, live-verified

2026-07-21, evening (owner ruling: DV01 lands alone tonight; FB4 lands separately).
BE-only landing: NO `next build`, NO FE restart — FE @ acb395f consumes corrected
values through the API unchanged.

## Steps 0–2 — merge + gates

Step 0 all-match (BE v2 @ e302593 clean · lane 6cce89e clean · FE acb395f clean ·
servers 200/200 · no pre-existing landing branch). Merge `--no-ff` = **131e8ea**,
zero conflicts, tree clean.

Gates, derived → observed, all exact: pytest **360 passed + 4 xfailed** (350+4 base
+ 10 per the DV01_FIX_REPORT enumeration) · battery **43/43** with exactly the two
declared `[CHANGED, DV01-A/B]` re-pins · s21 cache **14/14** · `git diff e302593..HEAD
-- quant_engine.py` = **empty**.

## Step 3 — :8000 restart window (the only server action)

Old owner PID **4564** stopped; kill-check clean (:8000 free, zero python processes)
BEFORE relaunch; 4-worker standard start (logs at `server-dv01.log`); health 200 on
first check. **:3000 never touched** (node listener verified intact before and after).

## Step 4 — live verification (evidence `dv01-evidence/`)

a. **PVBP Sensitivity** (`dv01-pvbp-panel.png` + `pvbp-sensitivity-live-0716.json`,
   captured from the LIVE :8000): bond grand total **188,274,825** — byte-exact to
   the Phase-A ledger's 07-16 figure (×0.674 vs the old 279,516,580); per-sector
   totals match the ledger row-for-row (국고 26.9M … 여전 14.7M); the IRS row is
   served intact (−101.96M @07-16 — swap code untouched, fixture-pinned
   byte-identical).
b. **Daily recon ladder @ D−1=2026-07-14** (`dv01-recon-ladder-0714.png`):
   **테타 +285.8M + Assumed +70.8M = 예상 +356.6M vs Realized +326.9M → 잔차 −29.7M
   (−9.1%)** — from FB3's −207.5M (−63.5%). The combined Assumed +70.8M decomposes as
   bond +288.9M (the Phase-A number, was +459.4M) + IRS −218.1M (unchanged; the IRS
   M1/M3 rows are visually identical to the FB3 capture). Caption for the owner: the
   remaining −29.7M is ledger ②'s credit-basis term (panel-convention realized; the
   diagnosis' 230-bond like-for-like variant of the same remainder is −71.8M — both
   stated so nobody chases a phantom delta), plus the FRN/fallback rows by design.
c. **Simulate @ base 2026-07-14** (`dv01-sim-tr-summary-0714.png`): 채권평가 (bond
   MtM) **−18.0억 → −14.8억**; 조달비용 −524.8억 / 채권캐리 +455.9억 / 스왑평가
   +22.6억 / 스왑캐리 −29.7억 all **byte-identical to the FB3-era capture of the
   same scenario**, and 토탈 −93.9억 → −90.7억 moves by exactly the bond delta. (The
   shrink factor here is scenario-shock-shape dependent — the fan-fixture class is
   ×0.672; this scenario's long-end-weighted shock lands ×0.82 — the structural check
   is the only-bond-leg movement, which held.) The sim-side 만기 브리지 renders with
   its own corrected 가정 leg.
d. **Additive fields live** (`pvbp-sensitivity-live-0716.json`): `dv01_sources`
   per row + 합계 {reval 223, sheet_fallback 44, sheet_frn 6} · `blotter_as_of` =
   **"2026-03-23"** · `frn_positions` = the 6 중소기업은행(변) rows. FE renders none
   of it yet — expected; follow-ups recorded.

## Step 5 — push + cleanup

Tag **dv01** @ 131e8ea. `git push --all` then `--tags`: v2 e302593→131e8ea, new
branches `dv01/diagnosis` + `dv01/fix`, new tag. **BE refs 16 → 19.** FE: nothing
pushed. `wt-dv01-be` removed + pruned; branches retained. This report committed +
pushed as a docs follow-up (tag stays on the landed/running commit).

## Carried list (verbatim from DV01_FIX_REPORT.md)

- **FE follow-ups (recorded, not done)**: ① `blotter_as_of` staleness notice on the
  PVBP panel / recon caption; ② `dv01_sources`/`frn_positions` mixed-basis disclosure
  chip; ③ re-capture the FB3 ladder evidence (it pre-dates this fix — superseded by
  `dv01-evidence/dv01-recon-ladder-0714.png`).
- **BE follow-up**: simulate `remainingDays` still the stale column (+113d) — pvbp
  AGING slope/roll-off anchor; a separate enumerated change (goldens move again).
- **Ops**: the blotter export is four months stale (2026-03-23) — refresh upstream
  regardless; refresh-independence of the reval path is pinned, refresh will change
  only FRN/fallback rows + the detected as-of.
- **Ledger ②** (per-sector credit-Δy Assumed variant): now unblocked and correctly
  sequenced — the visible remainder it would close is the −29.7M panel-grade /
  −71.8M subset-grade residual above.

**Servers RUNNING: :8000 on the dv01 build (131e8ea, 4-worker, health 200), :3000
unchanged (acb395f build) — owner verification may begin.**
