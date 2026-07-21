# DV01_DIAG_ADDENDUM — independent corroboration, two additional findings, and a SESSION-COLLISION record

2026-07-21, second DV01-DIAG session (this one). **Read this WITH `DV01_DIAG_REPORT.md`.**

## ⚠ Session collision — what happened, verifiably (final state)

Two sessions were dispatched into the same lane and worked the SAME worktree
concurrently. When THIS session started, `dv01/diagnosis` + `wt-dv01-be` already
existed (my `git worktree add` failed with "branch already exists"). Timeline as
recorded by the repo:

1. This session wrote `scripts/dv01_diag.py` (13:49) and ran its own Phase-1
   harness; the other session wrote `dv01_diagnosis.py`/`2`/`3` and
   `DV01_DIAG_REPORT.md` (13:52) in parallel.
2. While this addendum was being drafted, the other session committed
   **35f92a9** (its report + scripts — an `add -A` that also swept in this
   session's `dv01_diag.py`) and then **6996e36**, removing `dv01_diag.py` as
   "unreviewed unknown-origin" — the mirror image of this session's own
   caution about adopting the other's unverified files. Symmetric, correct
   behavior on both sides; nothing was lost: **this session's harness content
   is preserved in git at `35f92a9:scripts/dv01_diag.py`**.
3. This session then committed ONLY this addendum (the remaining un-adopted
   file). An earlier draft of this section flagged the other report's "only
   commits are…" sentence as claiming commits that did not exist — that was
   true at reading time but the session was simply mid-flight; the flag is
   WITHDRAWN. Its measurements were verified real regardless (below), which
   is the part the standing rules actually require.

Net: the branch carries the other session's report as the primary Phase-1
document, this addendum as the corroboration + deltas, and both harnesses in
history (theirs at HEAD, this session's at `35f92a9:scripts/dv01_diag.py`).

## Corroboration (independent harness, same data)

My `scripts/dv01_diag.py` was written and run before I discovered the other report.
Where the two overlap, results agree to 3–4 significant figures:

| Quantity | Other report | This session |
|---|---|---|
| Ratio mean/median/sd (07-14) | 2.235 / 1.582 / 4.089 | 2.2350 / 1.5818 / 4.0888 |
| Ratio mean/median/sd (07-15) | 2.538 / 1.590 / 7.707 | 2.5378 / 1.5899 / 7.7070 |
| min / max (both dates) | 0.032 / 57.3 · 114.5 | 0.0319 / 57.28 · 114.55 |
| 평가금액/dirty | 1.0007 | 1.0007 (median 1.0010) |
| Workbook Assumed(bond), 07-14 | +459.4M | +459.4M |
| Staleness estimate | duration-solve 111d ± 4 → ≈03-25; 잔존일수 offset **+113** → **2026-03-23** | lag(dur − implied dur) median 0.3012y ≈ 110d → ≈03-26 (coarser method, consistent) |

**The decisive +113-day claim re-verified from scratch by this session: the
잔존일수 − (maturity − 2026-07-14) offset is exactly +113 for ALL 273 bonds**
(they reported 230; it holds for the full population — zero variance). Snapshot
date 2026-03-23 stands. H-scale dead, H-data (stale single-dated snapshot) verdict
**CONFIRMED by two independent implementations**.

Collapse-check differences are methodological, not contradictory: the other session
compared realized vs assumed over the 230-bond subset with FRESH re-bucketing
(realized +217.1M → residual −72.9M with reval DV01); this session compared against
the service's actual footer bucket (all 273 incl. fallback rows, stale buckets:
realized +260.9M → −53.9M). Both show the same shape: **the DV01 correction removes
~70% of the bond 잔차; the remainder is ledger ②'s curve-source basis.** The landing
pass should quote the other session's −72.9M for the like-for-like acceptance number
(fresh bucketing is the right convention under option A) and note the −53.9M
whole-book variant.

## Two findings ABSENT from the other report (this session's additions)

1. **FRN "(변)" sub-finding — the ratio-0.032 head of the distribution.** Six rows
   (중소기업은행(변) …) carry sheet durations ≈ 0.02y — reset-linked duration, the
   RIGHT concept for a floater — while the engine's fixed-coupon model revalues them
   as ~0.69y bonds (lag −0.63y, opposite sign to everything else). For these bonds
   the WORKBOOK is closer to economic truth and bump-reval overstates. Any option-A
   implementation must carve FRNs out (visible caveat, not silent fixed-coupon
   repricing) or the "risk truth" claim is dishonest for exactly those rows.
2. **The SIMULATION consumer is missing from the other report's blast radius.**
   `position-bridge.ts::bondToSimPosition` ships `pvbp: b.pvbp` into `/api/simulate`,
   and the engine's bond MtM path (`calculate_daily_mtm`, aged `p.pvbp`) scales with
   it — so simulate `bondMtm`/`decompositionDaily`/시나리오 대사 realized lanes are
   inflated by the SAME 2026-03-23 staleness (and the M1 grid the scenario recon
   derives from request positions likewise). Option A as scoped (server-side reprice
   in `build_pvbp_sensitivity`) fixes Home/recon but NOT simulate; the simulate fix
   is a separate decision with golden/byte-identity blast radius (fan fixtures,
   HARDEN-1 anchors, s21 cache pins) and must be its own enumerated lane. The memo's
   "FE untouched, a correct BE fixes the FE surfaces" claim is TRUE for Home/recon
   and FALSE-by-omission for the Simulation tab — flagged so the owner rules with
   the full picture.

Also for completeness: the loader line the whole chain hangs on is
`irs_pricer/loaders/portfolio.py:201-205` (`"Duration가중 평가액"/1e4`, fallback
`듀레이션×평가금액/1e4` — parse verified correct; the INPUT column is the stale part),
and the FE never reads that column itself (blotter-parser.ts bond `pvbp: 0` at
acb395f) — the upload response is the single distribution point.

## Recommendation deltas

The other report's memo (A recommended / B rejected / C interim / detect-and-surface
the snapshot date in every option) is endorsed as-is, with two amendments:
- Option A must state the FRN carve-out explicitly (finding 1).
- The owner ruling should decide simulate's treatment at the same time (finding 2) —
  even if the decision is "defer" — so the 대사 surfaces and the Simulation tab do
  not silently diverge in risk basis after A lands.

## Gates (this session's own runs at e302593 + untracked diagnosis files)

- BE pytest: **350 passed + 4 xfailed** (T0, re-derived from checkout).
- 43-anchor battery: **43 passed**.
- Golden / s21 byte-identity / quant_engine: untouched by construction (zero
  production-code changes; the branch's only committed content is this session's
  two files).
- No server contact (module calls only), Data/ read-only, no push, FE repo: zero
  writes (read-only `git show acb395f:` inspection only).
- Tree: clean after this addendum's commit (the other session committed its own
  set; nothing untracked remains). The landing pass reviews BOTH documents
  together; retrieve this session's harness via
  `git show 35f92a9:scripts/dv01_diag.py` if a re-run is wanted.
