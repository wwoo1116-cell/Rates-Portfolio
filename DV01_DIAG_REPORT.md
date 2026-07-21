# DV01_DIAG_REPORT — workbook bond PVBP vs bump-reval DV01: STALE-SNAPSHOT verdict, fix gated to owner

2026-07-21. Worktree `wt-dv01-be`, branch `dv01/diagnosis`, base e302593. Diagnosis via
direct module calls only (loaders + engine + credit curve); no server started, no
workbook opened outside the existing openpyxl read paths, Data/ read-only.
**Phase 2 gate: the verdict is H-data (in a precise form) → STOPPED after Phase 1;
this file carries the decision memo. Zero production-code changes — the only commits
are the three diagnosis scripts and this report.**

## Phase 1 — measurements

Per-bond `ratio_i = workbook_PVBP_i / bump_reval_DV01_i` (central ±0.5bp on the
engine's dirty NPV at the credit-curve yield; FE payment-frequency convention
국고/통안=2 else 4), 230 of 273 bonds analyzable (43 skipped: matured by D or no
curve), identical population both dates:

| Date | mean | median | sd | q1 | q3 | min | max |
|---|---|---|---|---|---|---|---|
| 2026-07-14 | 2.235 | 1.582 | 4.089 | 1.423 | 1.892 | 0.032 | 57.3 |
| 2026-07-15 | 2.538 | 1.590 | 7.707 | 1.428 | 1.907 | 0.032 | 114.5 |

**Decomposition kills two hypotheses at once.** With `ratio ≡ (D_wb/D_mod) ×
(평가금액/dirty)`:
- value factor 평가금액/dirty = **1.0007 ± 0.007** — the value basis is NOT the issue;
- duration factor D_wb/D_mod ≈ the whole ratio, bond-by-bond (means match to 3dp);
- the ratio is NOT constant (H-scale dead): it runs 1.09 (3.7y bond) → 57–114
  (2-day bond) and grows as maturity shrinks — a duration-AGING fingerprint, not a
  unit error;
- no convention (Macaulay-vs-modified, clean-vs-dirty, compounding) reproduces a
  1.4–114× spread (H-basis-as-convention dead).

**The discriminator that decides it (script 2):** solving, per bond, for the lag `s`
such that the ENGINE's own Macaulay duration valued at `D − s` equals the workbook
듀레이션:

- implied lag: **median 111 days, sd 4.0** (q1 109, q3 111), 95.9% within ±15d of the
  median → one frozen as-of ≈ **2026-03-25** — and the engine's OWN convention
  (Macaulay on dirty at the credit yield) **reproduces the workbook column** at that
  date. The column is not wrong; it is OLD.
- **잔존일수 offset vs (maturity − 2026-07-14) = exactly +113 for ALL 230 bonds**
  (single value, zero variance) → the ENTIRE workbook is a single-dated snapshot of
  **2026-03-23** (113 days before 07-14; the 111d duration solve agrees to within its
  ±2d numeric grain). The near-1.000 value factor is short-bond price stability, not
  freshness.
- Aggregate (the panel's headline factor): **Σ pvbp_wb / Σ dv01_reval = 1.456** — the
  ledger's "~42%" reproduced as REQUIRED: it falls out of 113 days of duration decay
  mass-weighted over a book whose analyzable mass is 93% sub-1Y (short bullets lose
  duration ≈ 1:1 with calendar; ~0.31y decay on ~0.7y average duration ≈ +45%).

**Verdict: H-data, precise form — a stale single-dated blotter snapshot
(2026-03-23), internally consistent and convention-compatible with our engine,
consumed as if current by every reader** (`loaders/portfolio.py` pvbp =
"Duration가중 평가액"/10000; same values re-served to the FE through the upload
response, so the Home PVBP panel, M1/Assumed, book-summary hedged duration and
tenor_bucket columns all inherit the staleness — including the bucketing itself,
which is 113 days too long).

Authoritative side per consumer (S6 precedent affirmed): **bump-reval DV01 is the
system's risk truth**; the workbook column is a correct HISTORICAL (2026-03-23)
duration-weighted value — legitimate as blotter provenance, wrong as current risk.

## The bond-잔차 collapse check (acceptance evidence, script 3)

Window 2026-07-14 → 07-15, bond leg, service-level (230 bonds, zero skips):

| Assumed leg | Assumed (₩) | bond 잔차 = realized − assumed |
|---|---|---|
| realized bond MtM | — | (realized = **+217.1M**) |
| WORKBOOK pvbp × (−Δbp@stale bucket) — today's live M1 | +459.4M | **−242.3M** |
| REVAL DV01 × (−Δbp@fresh bucket) — option A below | +290.0M | **−72.9M** |

Correcting the bond-side M1 with reval DV01 removes **~169.4M (70%)** of the bond
residual. It does NOT collapse to swap-grade (−1.7M) — the remaining **−72.9M is
ledger ②'s credit-vs-swap-pillar basis term** (Assumed moves off IRS/CD pillar Δbp
while realized moves off credit 민평 Δy), cleanly separated by this measurement.

## Decision memo (owner ruling requested — no code changed)

**A. Switch consumers to server-side bump-reval DV01 (RECOMMENDED).**
`build_pvbp_sensitivity` (and thus M1/Assumed + book-summary's bond leg) computes
per-bond DV01 by ±0.5bp reval at the request's valuation date, bucketing by FRESH
remaining maturity; workbook pvbp/duration/잔존일수 demoted to provenance fields.
- Blast radius: PVBP panel bond rows shrink ÷1.456 aggregate (headline change the
  owner must expect); recon bond 잔차 −242.3M → −72.9M (measured above); hedged
  duration in book-summary corrects likewise; FE untouched (values flow through the
  API/upload response — verified consumer chain, no FE edit needed). BE cost: ~2
  extra revals × 273 bonds per cache-cold request (same order as the daily-pnl bond
  leg, ~hundreds of ms; ttl-cacheable).
- Re-pin ledger (to enumerate at fix time): pvbp-sensitivity fixtures, recon M1
  anchors, book-summary pins, FE panel expectation strings.
**B. Age the workbook columns at the loader** (roll 잔존일수/듀레이션/pvbp from the
detected snapshot date to the request date). Cheaper compute, but duration aging is
approximation (nonlinear through coupons), pvbp needs value aging too, and it keeps
the blotter as risk source. Fragile; not recommended.
**C. Keep workbook values, label the staleness** ("PVBP: 블로터 2026-03-23 기준").
Honest and one-line cheap, but leaves wrong-scale numbers as a risk panel's headline.
Acceptable only as an interim while A is scheduled.

**In every option**: the loader should DETECT and surface the snapshot as-of (the
uniform 잔존일수 offset makes it computable per file: `remaining_days − (maturity −
today)` modal value) — staleness must be visible, whatever consumes the numbers.
A refreshed blotter export would also change the live numbers under the CURRENT code;
worth telling the owner regardless (the 42% is partly an ops/data-currency issue).

## Ledger ② dependency (one paragraph)

Independent — its own lane. The credit-Δy basis term does NOT share the staleness
root: with the duration mass corrected (option A applied in-measurement), a −72.9M
bond residual REMAINS, attributable to Assumed consuming IRS/CD swap-pillar Δbp while
realized bonds reprice off per-sector credit 민평 curves. Closing it means a
per-sector Δy source for the Assumed leg (credit-curve day-over-day per sector×tenor —
the `credit_matrix.daily_shift` machinery already computes exactly this shape).
Lane B's −96.9M estimate and this −72.9M are the same term under different
measurement conventions (theirs pre-dated the duration correction). Sequencing: ② is
only worth doing AFTER A lands, or its effect will be swamped by the staleness term.

## Gates (nothing changed but scripts + this report)

pytest **350 passed + 4 xfailed** (= checkout baseline, zero new tests — diagnosis
only) · 43-anchor battery **43/43** · golden parity untouched · s21 byte-identity
untouched (`quant_engine.py` untouched by construction) · tree clean · NO push · no
server contact (TestClient unused — module calls only; :8000 never touched) · FE repo
untouched (@ acb395f, clean).

Worktree left in place for the merge/landing pass.
