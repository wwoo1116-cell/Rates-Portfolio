# REPORT s21 — Simulation Curve Cache: Hardening & Full-Book Validation

**Branch:** `s21/curve-cache` (worktree `wt-s21-be`), base = BE mainline `v2` @ `40a3238`
(post-iv4 + perf pass). **BE only** — zero FE changes, zero API shape changes. No merges
performed; integration v5 owns them.

**Mission (revised brief):** the 23.5-minute defect was already fixed by the perf pass
(`40a3238`). This pass makes the module-global exact-key memo's safety argument
*executable*, adds the operational kill switch, and validates the fix on the real book
with the s18 profiler unchanged.

**Verdict up front:**

- All hardening gates green; **no stand-down finding** — every probed determinant mints
  new keys, the key is total.
- Full book, s18's request shape: **1,409.7s → 118.6s cold / 91.6s warm** — **11.9× / 15.4×** (ramp/matrix leg:
  116.5s cold / 95.8s warm). Byte-identity proven at the HTTP level.
- **One real finding: iv4's capacity extrapolation was low.** The live book mints
  **11,661 distinct keys** per ramp/matrix run — headroom at 32,768 was only **2.8×**,
  under the ≥4× policy. `_MAX_ENTRIES` raised to **65,536** (5.6×) and the pin now
  asserts against the measured real-book number. (§1.5)

---

## 0. Preconditions (verified before branching)

| Check | Result |
|---|---|
| `REPORT_integration_v4.md` on FE mainline | present (`UIUX_test/REPORT_integration_v4.md`) |
| s18 profiler (`IRS_PRICER_SIM_PROFILE`) | present, used unchanged (only env set + log captured) |
| s18 drift guards | present (`tests/test_simulate_s18.py`, in the anchor capture) |
| `curve_cache._MAX_ENTRIES == 32768` | confirmed at base (raised to 65,536 by this pass, §1.5) |
| pytest baseline | **329 passed + 4 xfailed** (`docs/session-s21/gate-baseline-pre.txt`) — run as `pytest tests`; bare `pytest` still trips on `scripts/test_*.py`, the documented non-issue |

**Writer-collision note:** at session start the *mainline* checkout had an uncommitted
`README.md` edit (mtime 15:33, ≈5 min before this session; a Korean-translation docs
pass) plus stale `scripts/session6_*` regenerations from 13:41. The edit was static on
re-check 45 s later and touches nothing in this lane's scope; work proceeded in the
fresh worktree off the HEAD *commit*, mainline checkout untouched. Not a stand-down.
Mainline HEAD re-verified unmoved at hand-off (§6).

## 1. T1 — Hardening the landed cache

### 1.1 Kill switch (env)

`IRS_PRICER_CURVE_CACHE=0` now stops the app lifespan from installing the wrapper;
default (unset or any other value) installs as before. Read **per startup**, not at
import; the disable path calls `uninstall()` (not a bare skip) so a previous in-process
startup can't leave the wrapper bound. Files: `api/app.py` (lifespan),
`engine/curve_cache.py` (`ENV_FLAG` at the definition site). Pinned by
`test_env_kill_switch_controls_install`. This is the A/B mechanism used throughout this
report and the operational escape hatch (engine then runs unmemoized: correct, slow).

### 1.2 Key totality — the safety argument, now executable

The ruling's premise: `bootstrap_zero_curve` has **exactly one input** (the par-rate
vector) and the key is that vector at exact float bit patterns, so the key is *total*
and staleness is impossible by construction. Documented at the definition site
(`curve_cache.py` "KEY TOTALITY") and pinned by three new tests:

- `test_key_is_total_determinism_and_exact_roundtrip` — the raw bootstrap is
  deterministic (bit-identical arrays for the same vector), and the key's
  `float()`-coerced reconstruction (`list(key)` — what the cached path actually feeds
  the engine) round-trips the input exactly.
- `test_key_totality_mutated_inputs_cannot_serve_stale_curves` — a caller mutating its
  par-rate structure mid-run gets a fresh, correct curve, never the pre-mutation entry.
  This is the property run-scoping was meant to buy, delivered by the key instead.
- `test_key_totality_run_determinants_reach_the_key` — probe runs differing ONLY in
  `sigma_bp`, ONLY in `baseDate` (the fixture's irsCurves are tenor-labelled, so
  baseDate sets the year-fraction resolution), and ONLY in the scenario shock vector
  each strictly mint new cache keys. **No curve determinant outside the key was found**
  — the stand-down clause was not triggered.

Snapshot/baseDate immutability during a run is *documented* (the simulate path builds
fresh per-(scenario, day) lists from the Pydantic-parsed request and never mutates one
in place — `simulation_service.build_chart_data`), but the tests show correctness does
not depend on it: mutation ⇒ new key ⇒ fresh compute, never a stale hit.

One seam kept honest: on a hit, the caller receives the array computed from the *first*
caller's reconstructed input. The round-trip pin proves that reconstruction exact for
the float tuples every engine path passes; exotic numeric types fall through to the
uncached original via the existing TypeError guard.

### 1.3 Mutability — pinned already, nothing new found

`test_cached_curve_is_not_mutable_by_callers` (landed) still pins `writeable=False`.
No uncovered mutation path surfaced; not redone, per the brief.

### 1.4 Concurrency statement

Verified execution model, recorded in `curve_cache.py` "CONCURRENCY":

- `/api/simulate` and the other pricing endpoints are **sync `def`** → Starlette runs
  them on its threadpool; multiple threads per worker process can hit the cache
  concurrently.
- `--workers 4` (the standard start since iv4) → **4 processes × 1 independent cache**:
  4 cold warmups, ~22MB per worker at the new capacity. No cross-process sharing.
- CPython's `functools.lru_cache` is thread-safe here (internal lock in the C
  implementation). Worst race: two threads compute the same miss concurrently — both
  produce bit-identical arrays (purity + determinism, pinned in §1.2), one insert wins,
  no wrong result possible. **No actual hazard found ⇒ no concurrency test added**, per
  the brief.

### 1.5 Capacity on the real book — the finding

Measured on the full live book (ramp/matrix, simDays 180, 5 scenarios,
`docs/session-s21/fullbook-profile-ramp.txt`): **11,661 distinct keys** — **4.7×**
iv4's ~2.5k fixture extrapolation. Cause: iv4's swap-independence experiment cloned one
swap (shared start date ⇒ shared next-fixing ⇒ ONE short-anchor curve variant), but the
real book's 377 swaps carry varied next-fixing dates, minting ~13 curve variants per
(scenario, day) instead of ~3. Headroom at 32,768 was **2.8×** — below the ≥4× policy;
under the old 2048 cache this key set reproduces s18's collapse exactly (§3).

Per the brief ("raise the floor if the real number says otherwise"):
`_MAX_ENTRIES` **32,768 → 65,536** (headroom **5.6×**; ~22MB/worker, ×4 workers ≈ 90MB,
accepted under the same cheap-insurance rationale). The capacity pin
(`test_simulate_key_set_fits_cache_with_headroom`) now asserts
`_MAX_ENTRIES ≥ 4 × 11,661` with measurement provenance, replacing the guessed 16,384
floor. Note for whoever raises the horizon: keys scale ≈ linearly with simDays under
ramp; a 365-day run would measure ≈ 23.5k keys — still inside 65,536, but re-measure
and re-pin if such runs become standard.

## 2. T2 — Correctness evidence

### 2.1 A/B byte-identity (kill switch)

`docs/session-s21/fixture-ab.txt` — per committed fixture (including the s15 minimized
live-book `fan_non_monotone_request.json`): cache uninstalled vs installed-cold vs
installed-warm. **sha256 of the canonically serialized response identical across all
three legs on both fixtures.** Raw bootstrap invocations counted at the
`curve_cache._original` seam on every leg:

| Fixture | OFF | COLD | WARM | sha256 equal |
|---|---|---|---|---|
| fan_non_monotone (60d, 2 pos) | 3.55s / 1,267 raw | 3.19s / 1,010 raw | 0.17s / 0 raw | ✅ `37fd9ed2…` |
| representative (90d, 5 pos) | 1.67s / 2,911 raw | 1.13s / 1,445 raw | 0.49s / 0 raw | ✅ `f7de35cd…` |

Permanent form: `test_simulate_http_bytes_identical_cached_vs_uncached` (parametrized
over both fixtures) POSTs through the real app with the kill switch off/on and asserts
**HTTP body byte equality** — fan bands, `ratePaths`, `totalReturnDecomposition`,
exclusions, funding strip, everything at the serialization the frontend consumes. This
doubles as the no-API-schema-diff proof.

### 2.2 Anchors (frozen-market only)

`docs/session-s21/gate-anchors.txt`: `test_simulate_api.py` (golden source parity, σ
scaling + median pins) + `test_simulate_s15.py` (golden contract, fan-center-is-base
under any σ) + `test_simulate_s18.py` (2.75% / +10bp / −25.0bp drift guards) +
`test_npv_identity_guard.py` + `test_historical_basis_guard.py` (s13 matrix) —
**42 passed**. Live-data anchors (home-vs-trace `1,984,626.564647` etc.) deliberately
not used: frozen to the pre-refresh dataset (2026-07-16 14:11 refresh); documented, not
a regression.

### 2.3 Call-count guard (new)

`test_raw_engine_called_exactly_once_per_variant_and_never_on_repeat` counts at the
`curve_cache._original` seam — what actually reaches the unmemoized engine, which
miss-count pins structurally cannot see (a bypass path or double-compute shows up here):
a cold fixture run reaches the raw engine exactly once per distinct par-rate variant
(== misses, not one more); an identical repeat reaches it **exactly 0 times**. The
script capture (§2.1) shows the same contract on both fixtures.

## 3. T3 — Performance (actuals, s18 profiler unchanged)

Full-book request reconstructed in-process from the BE's own portfolio loader
(`scripts/s21_fullbook_profile.py`), mapped to the frozen FrontendPosition contract
field-for-field as the live bridge does (`position-bridge.ts`); the s18 payload was
never committed. **Composition: loader parsed 686 positions (273 bonds + 413 IRS) —
identical to s18's parse — of which 377 swaps are live at baseDate (the bridge's
maturity filter; s18 ran 413 live swaps on 2026-07-15, so ~36 swaps have rolled off in
the refreshed book). Request = 650 positions. Reported, not papered over.**

Three request shapes measured, because distinct-key count and call structure are
functions of the SHOCK SHAPE, not just the horizon — a step request's par vectors
repeat across days and would have flattered the comparison:

| Leg | Wall cold | Wall warm | bootstrap calls | distinct keys | headroom @65,536 |
|---|---:|---:|---:|---:|---:|
| s18 baseline (pre-fix, 2048 entries) | **1,409.7s** | — | 658,505 (~all real) | — | — |
| s21 `s18-shape` (fixture curves, baseDate 2026-07-15, ramp/matrix) | **118.6s** | 91.6s | 657,425 (11,661 real) | 11,661 | 5.6× |
| s21 ramp/matrix (snapshot-store curves, baseDate 2026-07-16) | 116.5s | 95.8s | 656,889 (11,661 real) | 11,661 | 5.6× |
| s21 step/parallel (API defaults) | 85.7s | 85.2s | 11,519 (237 real) | 237 | 276× |

The ramp/matrix leg reproduces s18's call structure (656,889 vs 658,505 wrapper calls —
same per-day revaluation loop inside `simulate_irs_path_fm`) while the bootstrap row
collapses from **1,312.9s to 25.84s cold / 2.56s warm**. Under the old 2048-entry LRU,
11,661 cyclically-swept keys are exactly the >capacity condition iv4 diagnosed — every
call a real ~2ms bootstrap ⇒ ~1,313s, which is s18's number. The mechanism is confirmed
end-to-end. The step leg shows why shock shape matters: constant shocks repeat par
vectors day-over-day, so only 237 curves exist all run.

Exclusions: **0** on every leg (all 377 swaps priced from the snapshot store / frozen
curves; the honest-exclusion path was never entered). HTTP 200 equivalents throughout.

Precision note: the three profile captures ran in processes that imported the constant
*before* the capacity raise, so their summary lines print `capacity 32768 (headroom
2.8x)` — that IS the finding of §1.5. Key counts and walls are unaffected (11,661 <
32,768: no eviction occurred); the table's headroom column states the post-raise value.

### Residual hot spots after the cache (measurement only, no action taken)

From the ramp cold profile (`fullbook-profile-ramp.txt`), total 116.5s:

| Where | Cost | Note |
|---|---:|---|
| `simulate_irs_path_fm` non-bootstrap remainder | **~82s** (108.2s cum − 25.8s bootstrap) | s18's table predicted ~80s; per-day schedule/NPV math per swap × scenario (1,885 calls × ~44ms). The next optimization target if anyone scopes one. |
| base-run daily KRD recon | 27.4s phase (of which `build_bumped_curves` 3.6s, `portfolio_krd_day` 0.9s) | base run only, skipped in scenario expansion |
| bootstrap hit overhead | ~2.5s per warm run (656,889 lookups × ~4µs) | key-tuple construction dominates; harmless |
| bond pricing (`calculate_daily_mtm`/`carry`) | ~1.4s | unchanged, negligible |

## 4. T4 — Gates

| Gate | Expected | Got |
|---|---|---|
| pytest `tests` | 329 + 4 xfail baseline + new s21 tests | **336 passed + 4 xfailed (329 baseline + 7 new items, xfail count unchanged)** (`docs/session-s21/gate-final.txt`) |
| API schema diff | none | none — HTTP byte-identity A/B is the proof (§2.1) |
| FE diff | empty outside BE tree | empty — branch touches only `irs_pricer/`, `tests/`, `scripts/`, `docs/`, `REPORT_s21.md` (`docs/session-s21/gate-diffstat.txt`) |

New tests (7 test items, all in `tests/test_curve_cache.py`):
1. `test_env_kill_switch_controls_install`
2. `test_key_is_total_determinism_and_exact_roundtrip`
3. `test_key_totality_mutated_inputs_cannot_serve_stale_curves`
4. `test_key_totality_run_determinants_reach_the_key`
5. `test_raw_engine_called_exactly_once_per_variant_and_never_on_repeat`
6–7. `test_simulate_http_bytes_identical_cached_vs_uncached[fan|representative]`

Changed landed test: `test_simulate_key_set_fits_cache_with_headroom` — capacity floor
re-anchored from the guessed 16,384 to `4 × 11,661` measured (§1.5).

## 5. Evidence index (`docs/session-s21/`)

- `gate-baseline-pre.txt` — precondition gate at `40a3238` (329 + 4 xfail)
- `fixture-ab.txt` — A/B byte-identity + wall/call-count table (§2.1)
- `gate-anchors.txt` — frozen-market anchor suites (42 passed)
- `fullbook-profile.txt` — step-leg full-book profile (§3)
- `fullbook-profile-ramp.txt` — ramp/matrix leg, the capacity finding (§1.5, §3)
- `fullbook-profile-s18shape.txt` — s18's exact request shape, apples-to-apples (§3)
- `gate-final.txt` — final full suite at the report commit
- `gate-diffstat.txt` — branch diff stat (BE-only proof)

## 6. Integrator note for v5

- **Merge-order constraint vs s20: none.** Disjoint trees (s20 is FE/ES; this branch
  touches no FE file).
- **Correction to the brief:** `start-backend.ps1` **already exists on v2** (F-17
  provenance: deliberately single-process, no `--reload`, port 8000 — its header
  documents the reload-watcher crash mode). It does **not** carry `--workers 4` or
  `IRS_PRICER_CURVE_CACHE`. Updating it is an ops decision that belongs to P5 (the
  F-17 single-process rationale and the new 4-worker standard need reconciling by the
  owner); this lane did not touch it. Both the flag and the worker count need
  documenting there when P5 lands.
- **P2 (server-side cancel): untouched**, as fenced. No cancel plumbing in this diff.
- The capacity raise (32,768 → 65,536) supersedes iv4-P1's sizing note in
  `curve_cache.py`; the iv4 pins still pass unmodified except the headroom floor
  re-anchor described in §4.
- Mainline HEAD re-verified at hand-off: `40a3238` still `v2` HEAD, unmoved for the whole session.
