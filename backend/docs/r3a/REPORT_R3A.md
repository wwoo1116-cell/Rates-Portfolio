# REPORT R3A — simulation_service.py split (BE-only, behavior-preserving)

- Branch: `r3a/sim-service-split` in worktree `wt-r3a-be`, off `4cf96a3` (v2 head).
- Plan reference: `docs/r3a/SPLIT_PLAN.md` (committed at `e1f950a`, Phase A).
- Verdict: **GO** — all mandatory gates green, zero external call-site change,
  no push (branch left local for the integrator, per session rules).

## 1. Verdict summary

`irs_pricer/services/simulation_service.py` (1,856 lines) split into the
`irs_pricer/services/simulation/` family of 11 modules + a 94-line re-export
facade at the original path. Every pre-split import — router, portfolio
analytics, tests, monkeypatch seams — works unchanged. Zero numeric change
(golden parity + HTTP byte-identity), zero API change, zero cache-behavior
change (call-count guard), test counts byte-stable at every commit.

Final module sizes (`wc -l`):

```
   105 irs_pricer/services/simulation/aggregates.py
   684 irs_pricer/services/simulation/chart.py
    24 irs_pricer/services/simulation/constants.py
   236 irs_pricer/services/simulation/daily_valuation.py
   161 irs_pricer/services/simulation/distribution.py
   140 irs_pricer/services/simulation/enrichment.py
   137 irs_pricer/services/simulation/kr_calendar.py
    43 irs_pricer/services/simulation/models.py
   210 irs_pricer/services/simulation/orchestrator.py
    98 irs_pricer/services/simulation/profiling.py
   156 irs_pricer/services/simulation/swap_inputs.py
    94 irs_pricer/services/simulation_service.py   (facade)
   (+ 22-line simulation/__init__.py family map)
```

## 2. T0 preflight (verbatim)

At `4cf96a3` inside the fresh worktree, before any edit:

- `python -m pytest` (bare, repo root): `327 passed, 4 xfailed, 1 warning in 53.84s`
- 42 frozen-market anchors (`test_simulate_api.py test_simulate_s15.py
  test_simulate_s18.py test_npv_identity_guard.py test_historical_basis_guard.py`):
  `42 passed, 1 warning in 13.79s`
- `git show --stat 4cf96a3` head lines:
  ```
  commit 4cf96a358151df4d04f43d4e7dc0a12bda616aeb
      rename(be): krw-fi-pms-backend naming (R2 naming step, ruling 5)
   README.md | 12 ++++++------
   1 file changed, 6 insertions(+), 6 deletions(-)
  ```
- **Deviation recorded:** the session prompt expected 336+4 xfail; measured is
  **327+4**, which matches the base commit's own declared baseline, the R2
  close-out record, and the iv4/iv5 reports. Treated as a prompt typo (the
  336 figure appears nowhere in repo history); baseline is provably not
  dirty. Full analysis in SPLIT_PLAN.md §0/H1.
- Main checkout at session start: branch v2, `nothing to commit, working tree
  clean`, head `4cf96a3`. Untouched-check repeated at session end (§6).

## 3. Commit stack (git show --stat verbatim, docs/r3a/commit-stats.txt)

Every code commit ran the FULL suite before committing; count was
`327 passed, 4 xfailed` at every gate, no drift, no test deleted.

| # | Hash | Subject | Gate |
|---|---|---|---|
| C1 | `e1f950a` | docs(r3a): split plan (Phase A, analysis only) | docs-only |
| C2 | `e3b2a75` | move(r3a): sim DTOs + funding constants | 327+4 |
| C3 | `d264047` | move(r3a): KR calendar + daily-valuation glue | 327+4 |
| C4 | `e165846` | move(r3a): chart builder + profiler | 327+4 |
| C5 | `9c50c03` | move(r3a): distribution + aggregates + enrichment + swap inputs | 327+4 |
| C6 | `bccfac2` | move(r3a): orchestrator; simulation_service -> facade | 327+4 |
| C7 | (this commit) | docs(r3a): report | docs-only |

```
commit e1f950a9c233a457169e97c70ba8451f9647fa99
    docs(r3a): split plan for simulation_service.py (Phase A, analysis only)
 docs/r3a/SPLIT_PLAN.md | 230 +++++++++++++++++++++++++++++++++++++++++++++++++
 1 file changed, 230 insertions(+)

commit e3b2a753a0acd4c1fca252c67189c682e2a5a26d
    move(r3a): sim DTOs + funding constants -> services/simulation/ (C2)
 irs_pricer/services/simulation/__init__.py  | 22 ++++++++++
 irs_pricer/services/simulation/constants.py | 24 +++++++++++
 irs_pricer/services/simulation/models.py    | 43 +++++++++++++++++++
 irs_pricer/services/simulation_service.py   | 64 +++--------------------------
 4 files changed, 95 insertions(+), 58 deletions(-)

commit d2640479b2383458dc3ecb213b31e2edbfdd60bc
    move(r3a): KR calendar + daily-valuation glue -> services/simulation/ (C3)
 irs_pricer/services/simulation/daily_valuation.py | 236 ++++++++++++++
 irs_pricer/services/simulation/kr_calendar.py     | 137 ++++++++
 irs_pricer/services/simulation_service.py         | 364 ++--------------------
 3 files changed, 392 insertions(+), 345 deletions(-)

commit e165846446017d02f7e1138dbd465bafc475ea28
    move(r3a): chart builder + profiler -> services/simulation/ (C4)
 irs_pricer/services/simulation/chart.py     | 684 ++++++++++++++++++++++++++
 irs_pricer/services/simulation/profiling.py |  98 ++++
 irs_pricer/services/simulation_service.py   | 735 +---------------------------
 3 files changed, 789 insertions(+), 728 deletions(-)

commit 9c50c039364b4ad1ab1f990855b5ff3442448e72
    move(r3a): distribution + aggregates + enrichment + swap inputs -> services/simulation/ (C5)
 irs_pricer/services/simulation/aggregates.py   | 105 +++++
 irs_pricer/services/simulation/distribution.py | 161 ++++++++
 irs_pricer/services/simulation/enrichment.py   | 140 +++++++
 irs_pricer/services/simulation/swap_inputs.py  | 156 ++++++++
 irs_pricer/services/simulation_service.py      | 525 +------------------------
 5 files changed, 581 insertions(+), 506 deletions(-)

commit bccfac24047f5d4dc693b1ebe13e2dc626fc8e45
    move(r3a): orchestrator; simulation_service -> facade (C6)
 irs_pricer/services/simulation/orchestrator.py | 210 ++++++++++++++++++
 irs_pricer/services/simulation_service.py      | 286 +++++--------------------
 2 files changed, 265 insertions(+), 231 deletions(-)
```

Branch total vs base: `14 files changed, 2335 insertions(+), 1851 deletions(-)`
— all under `irs_pricer/services/` + `docs/r3a/`. No FE file, no
quant_engine.py, no curve_cache.py, no server, no push.

## 4. Final gates at `bccfac2` (all fresh runs, outputs verbatim)

1. **Full suite, bare `python -m pytest` from repo root** (also proves clean
   collection) — `docs/r3a/gate-full.txt`:
   ```
   327 passed, 4 xfailed, 1 warning in 50.17s
   ```
2. **42 frozen-market anchors** — `docs/r3a/gate-anchors.txt`:
   ```
   42 passed, 1 warning in 13.73s
   ```
3. **Golden parity + HTTP byte-identity + call-count + kill switch** —
   `docs/r3a/gate-golden-http-cache.txt`:
   ```
   tests/test_simulate_api.py::test_matches_source_backend_golden PASSED
   tests/test_curve_cache.py::test_simulate_http_bytes_identical_cached_vs_uncached[fan_non_monotone_request.json] PASSED
   tests/test_curve_cache.py::test_simulate_http_bytes_identical_cached_vs_uncached[simulate_request_representative.json] PASSED
   tests/test_curve_cache.py::test_raw_engine_called_exactly_once_per_variant_and_never_on_repeat PASSED
   tests/test_curve_cache.py::test_env_kill_switch_controls_install PASSED
   5 passed, 1 warning in 11.63s
   ```
   - HTTP-level byte-identity on BOTH committed s21 fixtures runs through the
     app's TestClient (no server), kill-switched vs cache-installed cold; the
     warm leg (identical repeat ⇒ raw engine reached exactly 0 times; cold ⇒
     exactly once per distinct variant) is the call-count guard test. All
     unchanged from the s21 contract.
4. **Import graph acyclic + per-module fresh-interpreter import** —
   `docs/r3a/gate-import-graph.txt` (both `from .x import` and
   `from . import x` forms captured):
   ```
   topological order (deps first): constants -> kr_calendar -> models ->
   daily_valuation -> enrichment -> swap_inputs -> aggregates -> chart ->
   distribution -> profiling -> orchestrator -> simulation_service
   ACYCLIC: yes
   ALL MODULES IMPORT CLEAN
   ```

## 5. Findings ledger

**Fixed (behavior-neutral, required by the split):**

- **H3 — profiler wrap retarget** (C4, `e165846`). `_sim_profiler` wrapped
  `calculate_daily_mtm`/`calculate_daily_carry` on `sys.modules[__name__]`;
  after the move those names are resolved from `simulation/chart.py` globals,
  so the wrap now targets the chart module. Off-path (env unset — every test
  and all production traffic) is the same single branch. On-path evidence:
  `IRS_PRICER_SIM_PROFILE=1` smoke on the committed fan fixture logged
  `svc.calculate_daily_mtm 200 calls / svc.calculate_daily_carry 200 calls`
  (= 40 business days × 5 scenario runs — interception proven live).

**Found, not fixed (recorded; respected by design):**

- **H1** — prompt baseline figure 336+4 is wrong; 327+4 is the repo-declared
  and measured baseline (SPLIT_PLAN §0).
- **H2** — same-name divergent functions: `next_kr_business_day`
  (quant_engine vs simulate family — different code, both kept; family
  imports the service-local one from `kr_calendar.py`) and
  `build_book_daily_pnl` (portfolio_analytics_service vs
  `simulation/aggregates.py` — different functions, both kept).
- **H4** — tests' monkeypatch seam `simulation_service.market_data_service`
  preserved: facade keeps the module attr; `swap_inputs.py` calls through the
  module attribute, never binds the functions at import time.
- **H5** — `_KR_HOLIDAYS`/`_hols_lib` guarded-import structure (including the
  NameError-through-`except Exception` fallback quirk) replicated verbatim in
  `kr_calendar.py`, not cleaned up.
- **H6** — `pyproject.toml` `packages = ["irs_pricer"]` lists no subpackages
  (pre-existing); repo runs from source, so the new subpackage needs no
  packaging change. Left for any future wheel-install work.
- **H7** — no dynamic attribute access, no import-order dependencies beyond
  H5; `services/__init__.py` unaffected.

## 6. Parallel-coexistence compliance

- No server started; no touch of :3000/:8000. All verification via pytest and
  the app's TestClient in-process.
- All work in worktree `wt-r3a-be`; the main `krw-fi-pms-backend` checkout
  was read-only to this session. End-of-session check (run after C7 commit,
  appended below by the final verification): expected `On branch v2 …
  nothing to commit, working tree clean` at `4cf96a3`, identical to session
  start.
- No push. Branch `r3a/sim-service-split` is local-only; integrator merges
  after the demo sprint lands.

## 7. Out-of-scope confirmations

FM optimization (~82s residual): not touched — `simulate_irs_path_fm` call
site moved file, call unchanged. Server-side cancellation (s22), curve-cache
changes, quant_engine, FE files, legacy pricer-sandbox family, F-04, pending
owner sign-offs: all untouched.
