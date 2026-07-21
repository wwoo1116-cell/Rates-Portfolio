# FB3-RECON — Session Report (lane B: recon bridge, path-matrix short end, label nowrap)

Session date: 2026-07-21. Worktree `wt-fb3-recon`, branch `fb3/recon-bridge`, base FE
**b5b4cac** (recon-v2). BE **e302593** — diagnosed via in-process TestClient/direct service
calls only; **no BE defect found → no BE branch created, BE tree byte-untouched** (verified
clean at e302593 at lane end). No build, no server contact, no push. Three commits:
**b569afb** (T1) · **5bfa992** (T2) · **0ebe36c** (T3), plus this report.

---

## T1 Phase 1 — the +139.3M 잔차: verdict with numbers

**Method.** The FE footer was reproduced outside the browser: real workbook book (273 bonds
/ 413 IRS, blotter-parser hydration rules), real `Data/` store, direct
`build_book_daily_pnl` + `build_pvbp_sensitivity` calls exactly as the router makes them,
and the FE `daily-recon-math` formulas transcribed. **Close 2026-07-14 → D 2026-07-15
reproduces the live Home footer byte-for-byte** (Assumed −248.6M | Realized +41.1M | 잔차
+289.6M (+705.2%) | 테타 +285.8M | 펀딩 −267.8M — lane A's evidence capture). The owner's
newer +34.7M/+174.0M/+139.3M screenshot could not be regenerated from the CURRENT store
(the market data has since advanced: close 07-15's Credit Matrix has no 07-16 row, so that
footer is now honestly DISABLED) — the mechanism decomposition below is date-independent
and was verified on the two reproducible dates.

**Decomposition of the reproduced +289.6M (+705.2%), close 07-14:**

| Cause | Amount | Evidence |
|---|---|---|
| (a) Theta/carry contamination in the 평가 buckets | **₩0.0** | Independent recomputation `V(T,y_T) − V(T,y_close)` over all 273 bonds reproduces the endpoint's bond mtm (+260.9M) to the won; `_swap_pnl`'s mtm is `V(T,c_T) − V(T,c_close)` by construction (dirty basis, settlement cash in theta — the s11 ±₩1 identity machinery). HARDEN-1's class-level theta/valuation split HOLDS at this grain. |
| **PRIMARY: Assumed sign inversion** | **+497.1M spurious** | `contributionRows` computed `KRD × (+Δbp)`; the realized buckets and both KRD grids use first-order P&L = `KRD × (−Δbp)` (BE `_bond_pnl:511` `pvbp×(−dy_bp)`; simulate `aggregates.py` "MTM = pvbp * (-sbp)"). Decisive check: swap grid said **+218.1M vs realized −219.8M** — sign-corrected, the swap-side 잔차 collapses to **−1.7M (0.8%)**. 잔차_wrong (+289.6M) − 잔차_correct (−207.5M) = the bug's +497.1M. |
| (b) Curve-source basis (bond KRD priced off SWAP pillars vs realized 민평 Δy) | **−96.9M** | Bond first-order with the CREDIT-curve Δy each bond actually repriced on = +369.8M vs the swap-pillar grid's sign-corrected +466.7M. |
| (b) Workbook-PVBP grain | **−109.0M** | Workbook static pvbp × Δy = +369.8M vs bump-reval DV01 × Δy = +260.8M — the blotter's bond pvbp **overstates reval DV01 by ~42%** (also +44% on 07-15: 62.4 vs 43.2M). Data-quality follow-up below. |
| True convexity | **≈ ₩0.0** | Exact reval (+260.9M) vs bump-reval-DV01 linear (+260.8M): the gap at single-digit-bp moves is ~₩0.1M. |
| (c) Settlement cash / CD fixing / funding | **₩0.0 in the compared buckets** | Settlement cash sits in theta by design (`_realized_swap_cash`); zero fixing warnings on the date; funding is a separate response field, never inside mtm/theta. |

Sum check: −1.7 (swap) −96.9 −109.0 −0.0 = −207.6M ≈ the sign-corrected residual −207.5M ✓.

**Verdict.** (a) explains ₩0. The +705% was manufactured by the Assumed leg's inverted
sign; the genuine residual that remains after the fix IS basis+grain-sized, and its
"convexity" component is measurably ~zero — the 잔차's owner caption 컨벡시티(+베이시스)
is dominated in practice by 베이시스 (credit-vs-swap pillars) plus the workbook-PVBP grain.

**Follow-ups surfaced (owner calls, NOT done here):**
1. Workbook bond `pvbp` ≈ +42% vs bump-reval DV01, systematically — either refresh the
   blotter's pvbp column or serve reval DV01 per bucket BE-side (would shrink the honest
   잔차 by ~₩109M/day at 07-14 magnitudes).
2. The Δbp leg reads swap pillars while bond realized moves on the Credit Matrix — a
   per-sector credit-Δy M2 variant would close the −96.9M basis, but needs the per-sector
   realized buckets lane A already estimated (~30-40 BE lines, response-contract growth).

## T1 Phase 2 — the bridge ladder (owner spec, applied to ALL 대사 surfaces)

**Term definitions (mutually exclusive, collectively the compared bucket):**
- 테타 (T−1 기지값) = the Total row's `theta` (bond accrued roll + swap leg theta +
  windowed settlement cash — deterministic pre-open).
- Assumed (PVBP×Δbp) = Σ_tenor 합계KRD@D−1 × (−Δbp) — **sign fixed**.
- 예상 PnL ≡ 테타 + Assumed (exact).
- Realized ≡ 테타 + 채권평가 + 스왑평가 (funding excluded — Phase 1 confirmed it is a
  separate field, so it stays the ONLY 비교-대상-아님 chip; pinned singular).
- 잔차 (컨벡시티+베이시스) ≡ Realized − 예상 (≡ 평가합 − Assumed; the theta rung cancels).

±₩1 pins: `bridgeLadder` identity tests (integer-won closure, no rounding leak) +
per-day scenario pins (below). Surfaces: Home/RH shared `daily-recon-panel` footer (ladder
row), RH range strip (테타/예상 columns added; footer-disabled days retain the
deterministic 테타/Assumed/예상 honestly; mismatch days stay all-—), and the Simulation
시나리오 대사 in per-path form: per-day 테타 = engine carry lanes (`decompositionDaily
bondCarry + swapCarry`), 실현 = 테타+평가 == `total − fundingCost` (±₩1 pinned per day),
M3 lanes now 예상/실현/잔차 + a terminal 만기 브리지 line. **The scenario 잔차 is
byte-identical to pre-ladder** (its assumed already used the correct −KRD×Δbp convention —
engine-validated in RECON-SCEN; the 566,157/1,909,929 fixture anchors pass unchanged).

Rename guards updated: old wording pinned ABSENT (계산 테타 outside-chip; 엔진 평가 경로;
the old two-term caption clause); 잔차 keeps its never-테타/carry naming rule — 테타 now
legitimately appears as a LADDER TERM label, and the guards distinguish the two.

## T2 — F4a per-pillar verdict + fix

**Verdict: both halves of the question resolved per regime.**
- **Live-app payloads** (`buildSimulateRequest`): shortEndBp derives from 금통위 events;
  with none, `generateShockCurves` pins the short nodes at 0 → the scenario **genuinely
  applies zero shock at 1D/3M by design** (short end moves only via MPC events). The
  matrix READ was already correct — the **display** was the defect: `ui/MatrixGrid`
  rendered every numeric 0 as the unmapped em-dash (KRD mass grammar), so measured zeros
  read as "don't know" on every row (the owner's screenshot).
- **The committed linear fixture** ships an explicit flat short end (generator
  `shortEnd=5.0`), where 1D/3M genuinely move — and the matrix agrees with the engine
  there too.

**Fix + pins (5bfa992):** `MatrixGrid` gains `zeroAsDash` (default true = Home PVBP mass
grammar byte-identical); the M2 path matrix passes false (0.0 renders +0.0; null keeps —)
— the same rule/prop name lane A's `SectorTenorMatrix` established at 48a6b15. Caption
states the 금통위-only short-end design. Byte-agreement pin: matrix(swap family) equals
the engine's `irsDailyReconciliation.cumulativeBp` per pillar per row at the engine's 3dp
wire rounding (first/middle/last recon rows of the linear fixture); default-params pin:
no-event payloads apply exact 0 at 1D/3M for 국채/swap/회사채 on every sampled day while
3Y ramps; display pin: M2 shows +0.0 at 1D/3M while M1's zero-mass cells keep the em-dash.

## T3 — F4b nowrap

**Declared file: `src/app/globals.css`** — one `.label-nowrap` utility
(`white-space: nowrap; word-break: keep-all`) with an ownership comment; lane A should not
touch that block this pass. Applied in scope: SegmentedButtons segments (the 경로 매트릭스
culprit; the scenario 대사 host widened w-72→w-96 to fit), curve-view ToggleChips,
Δbp-chart tenor chips, range-strip view toggle + 계산/+20일 확장 buttons, `ui/Chip` root,
bridge-ladder rung captions. `dockview-tab` titles already truncate — untouched. Pin: all
four scenario 대사 subtab buttons carry the class.

**Handoff to lane A (wraps NOT fixed here — their files):** label surfaces inside the
Rates History tab's own components — instrument-selector chips, PnL Trace controls, spread
builder buttons. Apply the same `.label-nowrap` class; do not mint a second utility.

## Test enumeration (+7 net; re-pins marked [CHANGED, FB3] in-file)

| Commit | New tests | Re-pins |
|---|---|---|
| b569afb (T1) | +3 — bridgeLadder identities/±₩1 grain; scenario per-day ladder identities (incl. realized == total−fundingCost); old-wording-absent guard | daily-recon-math sign fixtures; panel footer→ladder DOM (3); strip ladder columns (2); scenario panel M3 lanes/legend/caption (2); chart-test row fixtures |
| 5bfa992 (T2) | +3 — engine byte-agreement; default-params short-end zeros; M2 0.0-vs-— display (+M1 grammar preserved) | — |
| 0ebe36c (T3) | +1 — subtab label-nowrap pin | — |

## Gates (final HEAD 0ebe36c)

| Gate | Result |
|---|---|
| FE tsc | clean |
| FE vitest | **392 passed / 0 failed (51 files)** = 385 (recon-v2 baseline, re-derived at T0 from this checkout) + 7 declared |
| FE eslint (`npx eslint .`) | **34 problems = 13E/21W** — equal to baseline |
| Guards | all green in-suite (incl. the updated recon naming pins, Δbp reuse guard, contrast gate) |
| Tree | clean |
| BE | **untouched** — no branch created (diagnosis found the defect FE-side); `krw-fi-pms-backend` clean @ e302593; pytest/anchors/golden/byte-identity not owed (zero BE diff) |
| Build / push / servers | none · none · untouched |

## Forbidden-surface proof (verbatim `git diff --name-only b5b4cac..HEAD`, feature commits)

```
.impeccable/hook.cache.json
src/app/globals.css
src/components/ui/chip.tsx
src/components/ui/matrix-grid.tsx
src/features/home/daily-recon-panel.test.tsx
src/features/home/daily-recon-panel.tsx
src/features/home/recon-deltabp-chart.test.tsx
src/features/home/recon-deltabp-chart.tsx
src/features/home/recon-range-strip.test.tsx
src/features/home/recon-range-strip.tsx
src/features/simulation/components/panels/curve-view-panel.tsx
src/features/simulation/components/panels/scenario-recon-panel.test.tsx
src/features/simulation/components/panels/scenario-recon-panel.tsx
src/features/simulation/components/segmented-buttons.tsx
src/features/simulation/lib/recon/path-matrix.test.ts
src/features/simulation/lib/recon/scenario-recon.test.ts
src/features/simulation/lib/recon/scenario-recon.ts
src/hooks/use-recon-range.ts
src/lib/daily-recon-math.test.ts
src/lib/daily-recon-math.ts
```

Zero paths in the Rates History tab's files (PnL Trace, spread builder/positions, its
chart hosts) and zero touches to its recon-subtab mount line. The shared daily-recon
internals under features/home and use-recon-range are this lane's per the brief.
(`.impeccable/hook.cache.json` = the auto-updated design-hook cache rider.)

## Notes for the merge pass

- Branch `fb3/recon-bridge`: b569afb → 5bfa992 → 0ebe36c (+ this report as a docs
  commit); worktree left in place.
- Expected intersection with lane A: `.impeccable/hook.cache.json` only (benign).
- Post-merge live check: Home 일별 대사 at close 07-14 should now read
  **테타 +285.8M + Assumed +248.6M = 예상 +534.4M vs Realized +326.9M → 잔차 −207.5M
  (컨벡시티+베이시스)**, 펀딩 −267.8M outside; Simulation 경로 매트릭스 1D/3M columns
  show +0.0 (no-MPC scenarios); no mid-word label wraps on subtabs/chips.
