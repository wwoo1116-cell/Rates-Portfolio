# R3a — simulation_service.py split plan (Phase A)

Session: r3a/sim-service-split, worktree `wt-r3a-be`, base `4cf96a3` (v2 head).
Mode: behavior-preserving structural refactor. Zero numeric change, zero API
change, zero perf change. No server starts; all verification pytest/scripts.

## 0. Preflight record (T0)

- Base commit: `4cf96a3` ("rename(be): krw-fi-pms-backend naming (R2 naming
  step, ruling 5)") — confirmed via `git show --stat` (README.md only, 6+/6−).
- Full suite at base, bare `python -m pytest` from worktree root:
  **327 passed, 4 xfailed** in 53.84s — collects cleanly.
- 42 frozen-market anchors (`test_simulate_api.py test_simulate_s15.py
  test_simulate_s18.py test_npv_identity_guard.py test_historical_basis_guard.py`):
  **42 passed** in 13.79s.
- **Deviation from session prompt, recorded verbatim:** the prompt expected
  "pytest 336+4 xfail". Actual is **327+4**, which matches (a) the base
  commit's own message ("Counts preserved: pytest 327+4 xfail (declared
  step-13 baseline)"), (b) the R2 close-out record, and (c) integration-v4/v5
  reports. Three repo-verified sources agree; the 336 figure appears nowhere
  in repo history. Verdict: prompt typo, baseline is NOT dirty — proceeding
  on the repo-declared 327+4 baseline. Any drift from 327+4 during Phase B
  remains a hard stop.
- Main checkout (`krw-fi-pms-backend`) at session start: branch v2, clean,
  head 4cf96a3. It is not touched by this session; re-verified at session end.

## 1. Current facts

### 1.1 The file

`irs_pricer/services/simulation_service.py` — **1,856 lines** (`wc -l`; CRLF,
newline-terminated). Implements the whole computation behind
`POST /api/simulate`, ported from rates-simulator-main plus s11/s13/s15/s18
extensions.

### 1.2 External public surface (frozen — nothing here may change name, home
module semantics, or signature; "home" = importable off `simulation_service`)

| Symbol | External consumers | Access style |
|---|---|---|
| `run_simulation` | `api/routers/simulate.py` | `simulation_service.run_simulation(...)` |
| `FrontendPosition` | router (direct-from import), `tests/test_simulate_s15.py` (attr) | both |
| `FrontendShockCurves` | router (direct-from import) | direct-from |
| `POLICY_BASE_RATE_KRW` | `services/portfolio_analytics_service.py` (direct-from), tests s15 (attr) | both |
| `FUNDING_SPREAD_BP` | tests s15 (attr) | attr |
| `FUNDING_RATE_KRW` | tests s15 + s18 (attr) | attr |
| `market_data_service` | tests s15 + s18: `monkeypatch.setattr(simulation_service.market_data_service, "load_snapshot"/"load_fixings", ...)` | **module attr — monkeypatch seam** |
| `_resolve_swap_float_fields` | tests s15 (attr) | attr — underscore name is nonetheless frozen surface |

No script imports `simulation_service` directly (s21 scripts go through
`api.routers.simulate`). `engine/curve_cache.py` references it in a docstring
only. Everything else in the file is internal to the family.

Because the plan keeps `simulation_service.py` as a facade with identical
re-exports, **zero external call sites change at all** — strictly inside the
"module paths only" allowance. No public-surface change required → Phase B
may proceed.

### 1.3 Internal regions (line ranges at 4cf96a3)

| Region | Lines | Symbols |
|---|---|---|
| Docstring, imports, holidays init | 1–47 | `_hols_lib`/`_KR_HOLIDAYS` (try/except import), `logger` |
| s15/s18 funding constants | 50–71 | `POLICY_BASE_RATE_KRW`, `FUNDING_SPREAD_BP`, `FUNDING_RATE_KRW` |
| s18 T5 profiler (measure-only) | 74–151 | `SIM_PROFILE_ENV`, `_sim_profiler`, `_phase`, `_log_profile` |
| Wire DTOs (frozen FE contract) | 156–184 | `FrontendPosition`, `FrontendShockCurves` |
| Quant-glue helpers: shocks & per-day valuation | 189–409 | `get_sector_curve_key`, `parse_tenor_to_years`, `interpolate_curve_shift`, `get_position_shock_bp`, `_is_matured`, `calculate_daily_mtm`, `calculate_daily_carry`, `calculate_daily_funding_cost`, `calc_dynamic_funding_rate` |
| KR calendar / tenor dates | 412–523 | `next_kr_business_day`, `modified_following_kr`, `_TENOR_MONTHS`, `tenor_to_maturity_date`, `resolve_curve_maturity_dates`, `build_bizday_schedule` |
| Chart builder (per-scenario engine run: FM precompute, per-day loop, recon, decomposition accumulators — the identity the FE waterfall consumes — response shaping) | 528–1169 | `_build_irs_shock_curve`, `build_chart_data` |
| s11 T3 distribution fan | 1172–1318 | `_DIST_SIGMA_BP_DAILY`, `_DIST_PERCENTILES`, `_DIST_Z`, `_offset_curve_points`, `_offset_shock_curves`, `_offset_custom_path`, `build_distribution_bands` |
| Aggregate tables | 1321–1406 | `build_frontend_pvbp_sensitivity`, `build_book_daily_pnl` |
| IRS static enrich | 1409–1536 | `enrich_irs_pvbp` |
| s15 T2 swap market-data resolution | 1539–1669 | `_MONTHS_TO_TENOR`, `SWAP_EXCLUSION_REASON_NO_QUOTES`, `_resolve_swap_inputs`, `_resolve_swap_float_fields` |
| Orchestration (endpoint body) | 1672–1856 | `run_simulation`, `_run_simulation_profiled` |

Decomposition accumulators (`cumulative_bond_carry`, `cumulative_funding`,
`cumulative_irs_carry`, `bond_mtm`, `irs_mtm_t`) are locals of
`build_chart_data`; the `decomposition` dict (bondMtm + bondCarry +
fundingCost + swapMtm + swapCarry == totalPnL float identity) is assembled at
its tail and post-processed (swaps-excluded nulling) in
`_run_simulation_profiled`. The split keeps `build_chart_data` whole — the
identity lives inside one function and is not touched.

## 2. Byte-stable / untouched-in-behavior touchpoints

- **`engine/quant_engine.py`** — structurally excluded since R1. Zero edits.
- **`engine/curve_cache.py`** — zero edits. Its mechanism (rebinding
  `quant_engine.bootstrap_zero_curve` module attr) is split-proof *provided*
  the moved code keeps calling `qe.bootstrap_zero_curve(...)` through the
  module object (it does; the plan forbids `from quant_engine import
  bootstrap_zero_curve` in any new module). Key derivation and call-count
  guards (`test_raw_engine_called_exactly_once_per_variant_and_never_on_repeat`)
  unaffected; asserted at every gate.
- **`IRS_PRICER_CURVE_CACHE` kill switch** — lives in curve_cache/app
  lifespan; untouched. Pinned by `test_env_kill_switch_controls_install`.
- **`simulate_irs_path_fm` (~82s FM hotspot)** — called from
  `build_chart_data` via `qe.`; the call site moves file, the call does not
  change. NOT optimized (out of scope).
- **Frozen wire contract** — `FrontendPosition`/`FrontendShockCurves` field
  names and `run_simulation`'s response dict move verbatim.

## 3. Proposed module boundaries

New subpackage `irs_pricer/services/simulation/`;
`irs_pricer/services/simulation_service.py` remains as a **facade** that
re-exports the entire previous module surface (public names + the frozen
underscore seam `_resolve_swap_float_fields` + `_resolve_swap_inputs` +
`market_data_service`), so every existing import — package-internal, router,
tests — keeps working unchanged.

### Symbol → module map

| New module | Symbols (moved verbatim) |
|---|---|
| `simulation/models.py` | `FrontendPosition`, `FrontendShockCurves` |
| `simulation/constants.py` | `POLICY_BASE_RATE_KRW`, `FUNDING_SPREAD_BP`, `FUNDING_RATE_KRW` (with the s15 T1/s18 T1 manual-constant comment block intact — the "never derive from BOK series" ruling) |
| `simulation/kr_calendar.py` | `_hols_lib`/`_KR_HOLIDAYS` try/except init, `next_kr_business_day`, `modified_following_kr`, `_TENOR_MONTHS`, `tenor_to_maturity_date`, `resolve_curve_maturity_dates`, `build_bizday_schedule` |
| `simulation/daily_valuation.py` | `get_sector_curve_key`, `parse_tenor_to_years`, `interpolate_curve_shift`, `get_position_shock_bp`, `_is_matured`, `calculate_daily_mtm`, `calculate_daily_carry`, `calculate_daily_funding_cost`, `calc_dynamic_funding_rate` |
| `simulation/profiling.py` | `SIM_PROFILE_ENV`, `_sim_profiler`, `_phase`, `_log_profile` (see H3: `_sim_profiler` retargets its two service-level wraps from `sys.modules[__name__]` to the chart module) |
| `simulation/chart.py` | `_build_irs_shock_curve`, `build_chart_data` |
| `simulation/distribution.py` | `_DIST_SIGMA_BP_DAILY`, `_DIST_PERCENTILES`, `_DIST_Z`, `_offset_curve_points`, `_offset_shock_curves`, `_offset_custom_path`, `build_distribution_bands` |
| `simulation/aggregates.py` | `build_frontend_pvbp_sensitivity`, `build_book_daily_pnl` |
| `simulation/enrichment.py` | `enrich_irs_pvbp` |
| `simulation/swap_inputs.py` | `_MONTHS_TO_TENOR`, `SWAP_EXCLUSION_REASON_NO_QUOTES`, `_resolve_swap_inputs`, `_resolve_swap_float_fields` |
| `simulation/orchestrator.py` | `run_simulation`, `_run_simulation_profiled` |
| `simulation_service.py` (facade) | re-export of all of the above surface + `market_data_service` module attr |

### Intended import graph (acyclic; arrows = imports)

```
models        ← (nothing in family)
constants     ← (nothing)
kr_calendar   ← (nothing in family; qe for _modfol_bd? no — none)
daily_valuation → models
profiling     → chart (wrap targets), qe
chart         → models, daily_valuation, kr_calendar, qe
distribution  → models, chart, qe
aggregates    → models, daily_valuation (helpers), qe
enrichment    → models, kr_calendar (next_kr_business_day), qe
swap_inputs   → models, kr_calendar (_TENOR_MONTHS inverse), services.market_data_service, engine.fixings, core.errors, qe
orchestrator  → constants, profiling, models, kr_calendar, chart, distribution, aggregates, enrichment, swap_inputs
facade        → everything above (re-export only)
```

`_MONTHS_TO_TENOR` (swap_inputs) is derived from `_TENOR_MONTHS`
(kr_calendar) — swap_inputs imports `_TENOR_MONTHS` and derives locally,
byte-identical expression. Acyclicity is checked mechanically at the final
gate (topological import of every family module in a fresh interpreter).

## 4. Hazards found while reading (findings ledger, Phase A)

- **H1 (deviation, recorded — no fix).** Prompt baseline 336+4 vs
  repo-declared and measured 327+4. See §0.
- **H2 (hazard, respected by design).** `next_kr_business_day` exists BOTH as
  `quant_engine.next_kr_business_day` and as the service-local definition
  (line 412). All family call sites (`build_chart_data` recon loop,
  `enrich_irs_pvbp`) resolve the *service-local* one. The split must import
  it from `simulation/kr_calendar.py`, never from `quant_engine` — they are
  different code; unifying them would be a behavior change. Same-name-family
  note also applies to `build_book_daily_pnl` (a *different* function exists
  in `portfolio_analytics_service`; all external `pas.build_book_daily_pnl`
  call sites are unaffected — the sim one is internal-only).
- **H3 (behavior-neutral fix required by the split).** `_sim_profiler` wraps
  `calculate_daily_mtm`/`calculate_daily_carry` on `sys.modules[__name__]` —
  interception works only if the wrap target is the module whose globals
  `build_chart_data` reads at call time. After the split those globals live
  in `simulation/chart.py`, so the profiler must `setattr` on the chart
  module instead of the facade. Labels (`svc.calculate_daily_mtm`) and
  restore semantics are kept verbatim. Off-path behavior is a single env
  check (unchanged); on-path behavior is measurement-only (s18 T5,
  explicitly not part of numeric output). Evidence: profiler is inert in
  every test (env unset) — full-suite + anchors green; plus a
  `IRS_PRICER_SIM_PROFILE=1` smoke via `scripts/s21_fullbook_profile.py`-style
  direct call is NOT run (server-independent but heavy); instead the wrap
  targets are asserted by reading the moved code in review.
- **H4 (seam, preserved by construction).** Tests monkeypatch
  `simulation_service.market_data_service.load_snapshot/load_fixings`. The
  patch lands on the shared `market_data_service` **module object**, so any
  family module that calls `market_data_service.load_snapshot(...)` through
  the module attr (as `_resolve_swap_inputs`/`_resolve_swap_float_fields`
  do) sees it. Requirements: (a) facade keeps `market_data_service` as an
  attribute; (b) `swap_inputs.py` imports the module, not its functions.
- **H5 (hidden state, moved intact).** `_KR_HOLIDAYS` module global +
  guarded `holidays` import: on ImportError `_hols_lib` is undefined and the
  calendar functions' inner `try: _hols_lib.KR(...)` raises NameError, caught
  by their `except Exception` fallbacks to `_KR_HOLIDAYS = set()`. This exact
  structure (including the NameError-as-fallback quirk) is replicated in
  `kr_calendar.py`, not "cleaned up".
- **H6 (observation — no fix, out of scope).** `pyproject.toml` declares
  `packages = ["irs_pricer"]` without subpackages; the repo runs from source
  (tests/scripts from repo root), so the new subpackage needs no packaging
  change. Noted for any future wheel-install work.
- **H7 (latent import-order dependency, none found).** All family-internal
  references are plain module-global lookups; no `__getattr__`, no dynamic
  `getattr(simulation_service, ...)`, no import-time side effects beyond the
  holidays init (H5) and logger creation. `services/__init__.py` eagerly
  imports only `market_data_service`, `mtm_service`, `pricing_service` —
  unaffected.

Fixes applied in Phase B: **H3 only** (provably behavior-neutral and required
by the split). Everything else: found-not-fixed / respected-by-design.

## 5. Commit stack plan (Phase B)

Each commit message declares test-count preservation (327+4, no tests
deleted); full suite runs at every commit. Any anchor/golden drift ⇒ revert
that commit.

1. **C1 `docs(r3a): split plan`** — this file only.
2. **C2 `move(r3a): sim DTOs + funding constants -> services/simulation/`** —
   create package; extract `models.py`, `constants.py`; `simulation_service`
   imports the names back into its namespace.
3. **C3 `move(r3a): KR calendar + daily-valuation glue`** — extract
   `kr_calendar.py`, `daily_valuation.py`; same back-import pattern.
4. **C4 `move(r3a): chart builder + profiler`** — extract `chart.py` and
   `profiling.py` together (H3: profiler wrap targets retarget to chart in
   the same commit — never a commit where interception is silently dead).
5. **C5 `move(r3a): distribution + aggregates + enrichment + swap inputs`** —
   extract `distribution.py`, `aggregates.py`, `enrichment.py`,
   `swap_inputs.py`.
6. **C6 `move(r3a): orchestrator; simulation_service -> facade`** — extract
   `orchestrator.py`; facade reduced to documented re-exports.
7. **C7 `docs(r3a): report`** — REPORT_R3A.md with final gates.

Final gates (all at C6, pasted into the report): full pytest 327+4; 42
anchors; bare-root collection; golden parity (`test_matches_source_backend_golden`);
HTTP byte-identity on both committed s21 fixtures via TestClient cold/killed
(`test_simulate_http_bytes_identical_cached_vs_uncached`) and warm-repeat +
call-count guard (`test_raw_engine_called_exactly_once_per_variant_and_never_on_repeat`);
import-graph acyclicity check (fresh-interpreter per-module import, output shown).
