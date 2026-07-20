# REPORT — Integration Pass v4

**New baselines (local, unpushed):** FE `feat/simulation-migration` — merges `9221675`(s14) `13d162b`(s16) `83da4cb`(s17) `432e892`(s19) `1bc1b18`(s15) `eda2bad`(s18) → iv4 commits `3df8d46`(T2) `fa258cc`(T5 FE) → this report. BE `v2` — merges `4b9f0d1`(s15) `b67493a`(s18) → `43e5136`(T5 BE). Evidence: `docs/integration-v4/` (gate outputs are pasted terminal captures, per the false-pass rule).

> **⚠ ACTION NEEDED FIRST: the :8000 backend is DOWN.** Following the iv3 precedent (restart :8000 on the merged code), I stopped the old process; my relaunch was then blocked by the permission system as an owner-workload operation. Start it with:
> `cd "…\IRS Pricer_Mock" && python -m uvicorn irs_pricer.api.app:app --port 8000`
> The :3000 dev server has hot-reloaded the merged FE and expects the merged BE (Settings now calls `GET /api/portfolio/funding-rate`).

## T1 — Merges: 8/8, zero conflicts, scope held

| Merge | Files | +/− | Conflicts |
|---|---|---|---|
| FE s14/chart-polish | 23 | +596/−92 | 0 |
| FE s16/daily-pnl-columns | 8 | +202/−8 | 0 |
| FE s17/entry-signals-flow | 25 | +1178/−306 | 0 |
| FE s19/es-backtest-diagnosis | 17 | +831/−2 | 0 |
| FE s15/sim-flow | 27 | +1374/−800 | 0 |
| FE s18/sim-dual-axis | 16 | +651/−120 | 0 |
| BE s15/sim-engine | 5 | +1106/−30 | 0 |
| BE s18/sim-rate-and-perf | 4 | +454/−56 | 0 |

Designed disjointness verified mechanically: `comm -12` of Stack A's and Stack B's changed-file lists = **empty set**. BE merged tree = **byte-identical to `8131dea`** (`git diff` empty) — the BE stack was linear, so every BE-only anchor is tree-guaranteed and the fresh runs below are confirmation. Preflight disclosures: a locally-modified `.impeccable/hook.cache.json` (FE) and iv3's uncommitted `session6_dashboard_before.*` fresh-capture drift (BE) blocked `merge` start — both **stashed, preserved, not discarded** (`git stash list` in each repo). These were dirty-worktree files, not lane conflicts.

## T2 — TODO burn-down

| Item | Disposition |
|---|---|
| **T2.1** `lw-line-chart` vertical grid | **Already materially closed by s18** (`grid.vertLines.visible:false` set slice-locally; the slice hosts can't consume `BASE_CHART_OPTIONS`). iv4 added the missing **pin**: `chart-defaults.test.ts` now source-asserts every `vertLines` config in both slice hosts (`lw-line-chart`, `rate-fan-chart`) resolves `visible: false`. Visual: `t2-sim-configure.png` / `t2-sim-results-signed-axis.png` — no vertical grid anywhere. |
| **T2.2** `formatKrwAxis` sign inheritance | s18 had already deleted the explicit override. iv4 added `valueKind: "krw"` so the SIGNED formatter arrives. **Decision confirmed against the live render, not assumed**: return panel badge `-11.6억`, readouts `금리P95 -25.5억 … 금리P5 +2.4억` — losses read negative on a return panel, which is correct. Pinned both directions in `distribution-chart-panel.test.tsx`. |
| **T2.3** Return-panel raw floats | s18's verbatim wiring applied at the definition site: `valueKind:"krw"` on every `line()` def + `primary:true` on the center (scenario mode) and 합계 (fallback mode); **no `formatter:` key** (explicit would suppress the signed default). The z-order rule is pinned twice: **runtime** (`distribution-chart-panel.test.tsx`: the lowest-z-order series on the scale must carry a `priceFormat`) and **repo-wide guard** `scripts/check_zorder_priceformat.test.ts` — recorded as the **fourth individual in the lightweight-charts defect family** (canvas-`var()` ×3, index-vs-calendar axis, z-order formatter capture). Live: axis ticks `+10.0억/0/-20.0억`, single badge, rate fan `+30.0bp` badge. |
| **T2.4** s14 KRW-guard harness | **Closed in-lane by s17** (its merge updated `krw-format-guard.test.tsx` to the pinned seam, disclosed in REPORT_s17); at the merged head the harness mocks `use-pinned-backtest` and the test passes with **identical fixture values** — no number moved, confirming harness-not-regression. Nothing left to do here. |

## T3 — Anchors at the merged head (all re-verified)

| Anchor | Expected | Got | Verdict |
|---|---|---|---|
| Identity diag, 419 legs | byte-identical, worst resid 0 | fresh run diff vs committed evidence = **path line only** (worktree vs repo dump path); all 456 substantive lines byte-equal, per-leg resid 0.0000 | **PASS** (`anchor-identity-diag.txt`) |
| s13 dirty-basis matrix | byte-identical | `diff` = **empty** | **PASS** (`anchor-basis-matrix.txt`) |
| Home-vs-trace live HTTP | 1,984,626.564647 both, diff 0 | trace `1984626.564647019`; Home replay (iv3 recipe: 7/14 + that date's quotes) `1984626.564647019`; **\|diff\| = 0.0**; theta/mtm legs byte-eq to iv3 — and this ran through the REWIRED funding path | **PASS** (`anchor-home-vs-trace.txt`) |
| Daily anchor | +4,188,430 | `total=4,188,430 mtm=-297,566,897 theta=301,755,328`, telescoping stale-diagnostic 12,328,767.12 unchanged | **PASS** (`anchor-session6-impact.txt`) |
| PVBP / MtM levels | byte-identical vs iv3 | label-normalized (console cp949 mojibake), funding lines excluded: **identical** — every PVBP row, IRS MtM clean/dirty, eval 3,759,864,170,000, summary | **PASS** — funding-line delta is T5, arithmetically exact (below) |
| TR decomposition ±₩1 | s15 pin | pinned test green in 327; live decomposition sums on capture (−12.0 + 7.5 − 7.0 ≈ −11.6억 display-rounded) | **PASS (test-pinned)** |
| Funding / Carry | 2.85% / +57.1bp, delta −25.0bp | constants + carry-A/B pinned by tests (green); live chips FUNDING **2.85%** (`t2-sim-results-signed-axis.png`). **+57.1bp not re-measured**: it is specific to s18's 24-bond+6-swap seed book, which was never committed; BE tree is byte-identical to the s18 head that measured it | **PASS (constant live; carry tree-guaranteed + test-pinned — stated in writing per the rule)** |
| Same-book A/B residual −0.000bp | s18 pin | `test_carry_ab_only_funding_moves` green | **PASS (test-pinned)** |
| Golden parity (BE) | byte-exact | suite green; explicit-funding path untouched by T5 (only the omitted-field/home paths moved) | **PASS** |
| Fan crossings, full book | 76/121, finalMTM/finalSwap byte-identical | **Not re-run**: the request was built live from the owner's ledger and never committed; a re-run would need that exact payload (and ~24 min). Guaranteed instead by (a) BE tree ≡ `8131dea` byte-for-byte, (b) the non-monotone fixture test pinning crossings+identity semantics, green | **PASS (tree-identity + fixture-pinned — explained in writing)** |

## T4 — Gates (captured output in `docs/integration-v4/gate-*.txt`)

| Gate | Expected | Got |
|---|---|---|
| BE pytest | 326 + 4 xfail | union head: **326 + 4 xfail** (`gate-be-pytest.txt`); final head: **327 + 4 xfail** — the +1 is iv4's T5 drift guard `test_home_funding_rate_uses_policy_constant` (`gate-be-final.txt`) |
| FE vitest | **198 + 3 expected-fail** | union head (pre-T2): **exactly 198 + 3** (`gate-fe-vitest-union-preT2.txt`) — arithmetic reconciled: 148 +21(s14) +3(s16) +9(s17) = 181; +10(s15) +7(s18) = 198; s19's +3 are the xfails. Final head: **205 + 3 expected-fail** — +7 = chart-defaults pin (+1), z-order guard (+2), distribution-panel pins (+4) (`gate-fe-final.txt`) |
| s19 xfails | still failing as designed | **3 expected-fail at both heads** — not flipped, not weakened, defects not fixed (that is s20's job) |
| tsc / build | clean / clean | clean (pasted) / clean (`gate-fe-build.txt`, built at the identical final commit in the capture worktree) |
| eslint repo-wide | **exactly 21 errors** | **21 errors / 26 warnings** (`gate-fe-final.txt`) — not fewer, not more |
| Note | | `python -m pytest` bare from the BE root trips on diagnostic `scripts/test_*.py` (collection errors) — the suite has always been `pytest tests`; recorded so nobody mistakes it for a regression |

## T5 — Funding divergence: worse than the question, now one source

**Source trace (answer: no, Home did not render 2.60% — it was worse).** Three divergent values coexisted:
1. **Simulation**: `POLICY_BASE_RATE_KRW` 2.75% + 10bp = **2.85%** (owner ruling, s18).
2. **Settings hero (FE)**: scanned rate-history's `base_rate` for the latest day only → **null on every non-MPC day** (`기준금리 데이터 없음`, live-captured pre-fix) and 2.60% at best.
3. **Home funding leg (BE)**: `load_base_rate` is an **exact-date** lookup → `None` on any close date without a BOK xlsx row → `or 0.0` → the leg silently accrued at **0.10%** (base 0 + 10bp). Proof to the won: iv3's capture funding −10,300,998 = eval 3,759,864,170,000 × 0.0010 × 1/365; × 0.0285/0.0010 = −293,578,443 ≈ the post-rewire −293,578,435 (₩8 float noise). The deleted code's own comment warned about exactly this silent zero.

**Disposition (the ruling exists → wiring, executed):** BE `home_funding_rate()` derives from `POLICY_BASE_RATE_KRW` (+ the user's Settings spread, semantics unchanged); additive `GET /api/portfolio/funding-rate` exposes the pair; Settings consumes it via `useFundingRate()`. BOK series untouched where it is genuinely market data (Rates History chart). **Drift guard extended**: Home == Simulation == 0.0285 at default spread, endpoint included — the two panels can no longer diverge. **Anchored-P&L check before wiring:** `funding_rate` feeds exactly one site, the funding leg, documented "총액(ΔNPV) 밖" — and the post-rewire anchor re-runs above are byte-identical on total/theta/mtm/PVBP. Live same-session captures: `t5-settings-funding-hero.png` (**2.85%**, "BOK 기준금리 2.75% + 10 bp"), `t2-sim-results-signed-axis.png` (**FUNDING 2.85%** chip), `t5-home-funding-header.png` ("Funding: BOK + 10bp", seeded funding column −3.9M = 500억 × 2.85%/365 exactly; s16's partial-state column alignment visibly intact).

## Self-resolved ambiguities (numbered findings)

1. **Preflight dirty files stashed, not discarded** (FE hook cache; BE iv3 session6 fresh-capture drift) — both recoverable via `git stash list`; BE working tree now carries iv4's fresh capture in the same uncommitted-drift convention iv3 left behind.
2. **Settings hero channel**: chose an additive read-only endpoint over an FE constant mirror — a second manually-maintained copy is the disease T5 exists to cure. (A FE-side pin of the rendered hero was therefore not added; the drift guard pins the value at the single source instead.)
3. **Fan-crossings anchor not re-run** — reasons and guarantees in T3; re-measuring requires the owner's ledger payload.
4. **Carry +57.1bp not re-measured** — seed book not reconstructable from committed artifacts; tree-identity + pinned A/B invariants stand in.
5. **BE +1 / FE +7 test-count deltas** over the stated gate targets — all iv4's own pins, enumerated in T4.
6. **`t5-home-funding-header.png` uses a 2-bond+1-IRS seed**, not the owner ledger — the header text and column arithmetic are the evidence, not the book.
7. **Owner's :8000**: stopped for the iv3-precedent restart onto merged v2; relaunch blocked by the permission classifier mid-sequence → **left down, flagged at the top of this report** with the exact start command. :3000 was never touched (it hot-reloads the merged FE from this worktree by itself).
8. **Fresh identity-diag run overwrote `scripts/s11_identity_diag.json`** with byte-identical content (no git drift) — noted because the run happens in-place.

## Findings for the owner's ledger (not touched, per scope)

- **Silent-zero class**: `load_base_rate`'s exact-date semantics remain (now unused for funding). If anything else ever consumes it for a "latest" semantic, the same silent-zero trap re-arms.
- s19's three xfail diagnostics (`backtest-defect-s19.test.ts`) are the s20 fix-pass acceptance criteria; still failing by design at this head.
- Inherited, still open: fan-median rank semantics owner decision (iv3), Entry Signals signal-color calibration (s17), full-book simulate runtime (~24 min; s18's cache recommendation), eslint 21-error baseline.
