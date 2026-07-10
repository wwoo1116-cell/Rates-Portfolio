# MIGRATION_PLAN.md — IRS Pricer_Mock → UIUX_test

> **Status:** planning document only. No application code has been moved, edited, or deleted in either repository as part of producing this document.
> **Source:** `Projects_AS/Rates Portfolio/IRS Pricer_Mock` (FastAPI + QuantLib, git HEAD `096db58`)
> **Target:** `Projects_AS/Rates Portfolio/UIUX_test` (Next.js 16 + React 19 + Zustand, no git repo initialized)
> **Note on duplicates:** byte-identical copies of both projects also exist one directory up, at `Projects_AS/IRS Pricer_Mock` and `Projects_AS/UIUX_test` (same git HEAD, no diff as of this writing). See Open Questions §6.10.

---

## 0. Scope Decisions (resolved this session)

These were open/blocking questions during planning; the user has since resolved them, so they're recorded here as decisions, not questions:

1. **Interpolation naming** — the code's `ql.PiecewiseLogLinearDiscount` (log-linear interpolation on discount factors, `engine/curve.py:59-71`) and the "ISDA linear interpolation" language used to describe this project's valuation convention refer to the **same concept**, just named differently in different places. No code change implied; no further reconciliation needed.
2. **`engine/risk.py`'s documented DoD failure** — ship deltas/DV01 derived from it with a **visible "Provisional" label** (same visual pattern as the existing "MOCK PRICING" badge already used elsewhere in this app), rather than blocking the feature entirely on a fix.
3. **KTB / KTBF pricing** — **deferred entirely to a separate future project**, not part of this migration's phases. Noted for that future project: KTB futures (KTBF) are expected to be considerably simpler to implement than IRS (no curve bootstrap; largely CTD-bond tracking + basis), so if anything, KTBF may be worth sequencing *before* KTB cash-bond pricing when that project starts — the reverse of what the original draft assumed.
4. **`book` / `ticker` fields** — add them as real columns to `trade_specification` now (Alembic migration), rather than deferring or deriving them client-side only.

With all four originally-blocking questions resolved, **nothing blocks starting Phase 1** (see §5).

---

## 1. Source Inventory — IRS Pricer_Mock

### 1.1 Module map

| Layer | File | Responsibility |
|---|---|---|
| `core/` | `conventions.py` | Calendar (`ql.SouthKorea()`), day count (`Actual365Fixed`), business-day convention (`ModifiedFollowing`), fixed-leg frequency (`Quarterly`), float tenor (3M), spot lag (1D) — every QuantLib constant the rest of the package shares. |
| `core/` | `market_data.py` | `MarketSnapshot`/`RateQuote` — the frozen dataclass contract every curve/pricing call consumes; deliberately source-agnostic (Excel, DB, live feed all produce this same shape). |
| `core/` | `errors.py` | `NonBusinessDayError`, `CurveBootstrapError`, and the KRX-business-day check — domain-level validation kept out of I/O. |
| `engine/` | `curve.py` | `build_curve()` — bootstraps the single CD91D discount/projection curve via `PiecewiseLogLinearDiscount`; also `curve_bump_scenarios()`'s reuse point. |
| `engine/` | `instruments.py` | `VanillaSwap` dataclass + `to_ql_swap()` — builds the QuantLib swap object and pricing engine on demand. |
| `engine/` | `pricing.py` | `price_swap()` — NPV/fixed-leg-PV/float-leg-PV/par-rate for a hypothetical (not-yet-booked) swap. |
| `engine/` | `mtm_valuation.py` | `value_booked_trade()` — clean/dirty NPV, accrued interest, and a full cash-flow-by-cash-flow breakdown for a *historically booked* swap; `fair_rate_for_schedule()` for par-rate hints. Single-curve assumption stated explicitly in the module docstring. |
| `engine/` | `risk.py` | `dv01()` (fixed-leg BPS for a +1bp fixed-rate move) and `curve_bump_scenarios()`/bucketed delta ladder — see §1.3, not safe to port verbatim. |
| `engine/` | `context.py` | `managed_quantlib_env()` — thread-safe scoping of QuantLib's global evaluation date and fixing histories. |
| `db/` | `models.py` | SQLAlchemy ORM: `TenorPillar`, `MarketData`, `TradeSpecification`, `NpvPnlTrace`. No `ON DELETE CASCADE` anywhere — auditability by design. |
| `db/` | `database.py`, `repository.py`, `trade_repository.py`, `trace_repository.py`, `connection_settings.py` | Engine/session management, DB-backed market-data lookup (replaces Excel loaders at request time), trade CRUD, NPV/PnL trace read-through cache, and user-entered (not env-var) MySQL connection settings. |
| `loaders/` | `true_data.py`, `total_data.py`, `csv_loader.py`, `base_rate.py`, `call_rate.py`, `factory.py`, `cache.py`, `infomax_schema.py` | Excel/CSV ingestion for market data + fixing history, format auto-detection, two-tier (memory + disk) cache. |
| `services/` | 10 files | One per use case — `pricing_service`, `mtm_service`, `portfolio_service`, `historical_pnl_service`, `npv_trace_service`, `market_data_service`, `calendar_service`, `rate_history_service`, `spread_backtest_service`, `trade_service` — each composes `core/` + `engine/` + `loaders/`/`db/`. |
| `api/routers/` | 11 files | See §1.2 for the full route table. |
| `web/` | — | A **separate, already-working reference frontend** (Vite + React 19 + Tailwind 4 + `lightweight-charts`) that consumes this exact API over HTTP via a ~50-line fetch wrapper (`web/src/lib/api.js`). Valuable as prior art for the API-client pattern (error-shape handling, network-vs-HTTP-error distinction) — **not** as a source of visual design; its own design system ("Coinbase Blue" flat/hairline terminal) is unrelated to UIUX_test's dark Marquee-dialect system and is not being reused. |
| `scripts/` | 12 files | One-off debug/verification scripts (`debug_npv_residual.py`, `analyze_residual.py`, `migrate_excel_to_mysql.py`, etc.) — explicitly separate from the formal test suite; not safe to treat as validated behavior. |

### 1.2 API route table

All routes verified by reading each router file directly.

| Method | Path | Request | Response | Calls |
|---|---|---|---|---|
| POST | `/api/curve` | `CurveRequest` | `CurveResponse` (zero rates + DFs on a 0.25Y mesh) | `pricing_service.sample_curve` |
| POST | `/api/price` | `PriceRequest` | `PriceResponse` (npv, fixed/float leg PV, par rate, dv01) | `pricing_service.price` |
| POST | `/api/delta` | `PriceRequest` | `DeltaResponse` (total + bucketed) | `pricing_service.delta` |
| POST | `/api/mtm/fair-rate` | `MtmFairRateRequest` | `MtmFairRateResponse` | `mtm_service.fair_rate` |
| POST | `/api/mtm` | `MtmRequest` | `MtmResponse` (clean/dirty NPV, accrued, cashflows) | `mtm_service.value_trade` |
| POST | `/api/mtm/npv-trace` | `NpvTraceRequest` | `NpvTraceResponse` | `npv_trace_service.compute_npv_trace` |
| GET | `/api/mtm/npv-trace/{trade_id}` | query params | `NpvTraceResponse` | `npv_trace_service.compute_npv_trace_for_trade` (cached) |
| GET | `/api/market-data/range` | — | `DateRangeResponse` | `market_data_service.list_available_dates` |
| POST | `/api/market-data/live` | `MarketDataResponse` | `MarketDataResponse` | `market_data_service.update_live` |
| GET | `/api/market-data/{valuation_date}` | — | `MarketDataResponse` | `market_data_service.load_snapshot` |
| POST | `/api/portfolio/fair-rate` | `PositionFairRateRequest` | `PositionFairRateResponse` | `portfolio_service.position_fair_rate` |
| GET | `/api/portfolio/historical-quote` | query params | `HistoricalQuoteResponse` | `portfolio_service.historical_spot_rate` |
| POST | `/api/portfolio/price` | `PortfolioPriceRequest` | `PortfolioPriceResponse` (net/payer/receiver NPV + cashflows) | `portfolio_service.price_portfolio` |
| POST | `/api/portfolio/delta` | `PortfolioPriceRequest` | `PortfolioDeltaResponse` | `portfolio_service.price_portfolio_delta` |
| POST | `/api/portfolio/historical-pnl` | `HistoricalPnlRequest` | `HistoricalPnlResponse` | `historical_pnl_service.compute_historical_pnl` |
| POST | `/api/portfolio/historical-pnl/by-trades` | `HistoricalPnlByTradesRequest` | `HistoricalPnlResponse` | `historical_pnl_service.compute_historical_pnl_for_trades` (cached) |
| GET | `/api/calendar/business-days` | query params | `NonBusinessDaysResponse` | `calendar_service.non_business_days` |
| GET | `/api/calendar/tenor-date` | query params | `TenorDateResponse` | `calendar_service.tenor_maturity_date` |
| GET | `/api/calendar/spot-date` | query params | `SpotDateResponse` | `calendar_service.spot_date` |
| GET | `/api/rate-history` | query params | `RateHistoryResponse` | `rate_history_service.get_rate_history` |
| GET | `/api/rate-history/spread` | query params | `RateSpreadResponse` | `rate_history_service.get_rate_spread` |
| GET | `/api/spread-backtest` | query params | `SpreadBacktestResponse` | `spread_backtest_service.run_spread_backtest` |
| GET | `/api/trades` | query params | `list[TradeOut]` | `trade_service.list_active_trades` |
| POST | `/api/trades` | `TradeIn` | `TradeOut` | `trade_service.book_trade_explicit` |
| POST | `/api/trades/by-tenor` | `TradeByTenorIn` | `TradeOut` | `trade_service.book_trade_by_tenor` |
| DELETE | `/api/trades/{trade_id}` | — | `TradeOut` | `trade_service.cancel_trade` (soft delete → CANCELLED) |
| POST | `/api/trades/import-legacy` | `LegacyPositionImportRequest` | `list[TradeOut]` | `trade_service.import_legacy_trades` |
| GET/POST/POST | `/api/db-settings[...]` | `DbConnectionIn` | `DbConnectionStatusOut`/`DbConnectionTestResult` | `db/connection_settings.py` |

### 1.3 Convention verification (file:line-backed)

- **Single-curve** (CD91D discounts *and* projects, no separate projection curve) — confirmed: `engine/curve.py:59-160` builds one `PiecewiseLogLinearDiscount` used for both the `DiscountingSwapEngine` and the `IborIndex`; `engine/mtm_valuation.py:11-16` states explicitly: *"this market (KRW CD91D-vs-CD91D) has one bootstrapped curve used for both discounting and floating-rate projection... `discount_curve` and `projection_curve` are therefore the same `CurveBundle`."*
- **Day count / calendar / roll convention** — `Actual365Fixed`, `ModifiedFollowing`, `ql.SouthKorea()` calendar, `Quarterly` fixed frequency, `Backward` date generation — confirmed: `core/conventions.py:12-17`, `engine/mtm_valuation.py:81-90` (schedule construction).
- **Clean vs. Dirty NPV as separate, correctly-labeled outputs** — confirmed throughout: `MTMResult` dataclass (`clean_npv`, `dirty_npv` as distinct fields, `engine/mtm_valuation.py:53-61`), `MtmResponse` Pydantic model (`api/models.py:96-104`), and `NpvPnlTrace` DB columns (`db/models.py:207-208`) all carry both figures independently, never collapsed into one.
- **Interpolation** — `ql.PiecewiseLogLinearDiscount` (log-linear on discount factors), `engine/curve.py:59-71`. Per §0.1, this is confirmed to be the same convention referred to elsewhere as "ISDA linear interpolation" — just a different name for the same thing. No divergence, no code change needed.

### 1.4 Not safe to port verbatim: `engine/risk.py`

- **No test coverage** under `tests/` — only ad-hoc scripts (`scripts/test_ccp_target.py`, `scripts/test_ccp_target_t.py`) that are not part of the formal suite.
- The project's own `PROGRESS.md` (a detailed work-order postmortem) documents this module **failing its own Definition of Done** as of the last recorded session:
  - 1Y and 2Y delta buckets come out **wrong-signed** (positive where a reference ladder expects negative).
  - 1D and CD91D bucket magnitudes are **85–97% off** a reference ladder.
  - Root cause is identified and explained in detail: the floating leg's PV telescopes to an exact algebraic identity that collapses risk onto only two "anchor" pillars (next reset date, maturity date) rather than distributing smoothly, so intermediate pillars see spurious near-zero or wrong-signed deltas. This is described as *"a methodological decision, not a bug to code-fix,"* explicitly left unresolved pending human input on whether the reference system uses a separate discounting/projection-curve bump convention for risk purposes.
- **Per §0.2, this module is still used** (it's the only DV01/delta calculation in the codebase, and it directly feeds the planned Home tenor-DV01 heatmap — see §3), but its output must carry a visible "Provisional" label until the methodology question above is resolved.

### 1.5 Test coverage gaps

No dedicated test file exists for: `engine/risk.py`, `api/routers/trades.py`, `api/routers/db_settings.py`, `services/rate_history_service.py`. Every other engine/service/repository module (curve bootstrap, MTM valuation, pricing, portfolio pricing "architectural-integrity" suite, historical PnL + its cache, NPV trace + its cache, market-data repository/service, trade/trace repositories, True Data loader, calendar API, CCP-curve tenor-months support, spread-backtest service + API) has direct test coverage.

---

## 2. Target Inventory — UIUX_test

### 2.1 Current state (as found)

Next.js 16 (App Router) + React 19, `dockview-react` for multi-panel workspace layout, `ag-grid-react` for the positions grid, `lightweight-charts` (same library IRS Pricer_Mock's own `web/` uses) + `d3` for charts, Zustand for UI state, `@tanstack/react-query` **installed but not yet used anywhere** (confirmed via grep — zero `fetch`/`useQuery`/API-call sites exist in `src/` today), React Hook Form + Zod for forms, strict TypeScript, pnpm.

Five nav tabs (`src/lib/constants.ts`): Portfolio Management, Backtest, Simulation, Optimal Portfolio, plus Home at `/`. `WORK_ORDER.md` (the project's own original build spec) states the intended MVP scope explicitly: *"Simulation and Optimal Portfolio ship as functional placeholder screens with correct chrome, layout, and inputs wired but no model backend. Home, Portfolio Management, Backtest ship as fully interactive with mock data."*

**Current mock `Position` shape** (`src/types/portfolio.ts`), as originally built: `assetClass: "IRS"|"CRS"|"KTB"|"KTBF"`, `book`, `ticker`, `direction: "Pay"|"Rec"|"Buy"|"Sell"`, `tenor`, `effectiveDate`, `maturityDate`, `notionalKrwEok`, `fixedRate`, `dv01`, `krd1y`/`krd3y`/`krd5y`/`krd10y`, `convexity`. Generated as 520 synthetic rows in `src/mocks/portfolio.ts` via a deterministic PRNG, weighted so CRS/KTB/KTBF make up the majority of the book by design.

Other mocks: `mocks/pricer.ts` (Simulation tab — a naive `notional × tenor × 0.0001 × 0.90` DV01 approximation, explicitly labeled in `WORK_ORDER.md` as *"Do not model actual QuantLib pricing... Add a subtle badge `MOCK PRICING`"*), `mocks/backtest.ts` (scenario-shock stress testing: MPC rate hikes/cuts, curve flatteners/steepeners, FX/CRS basis shocks, and three historical crisis windows — COVID-19, Legoland 2022, SVB 2023 — applied as instant bp shocks to KRD buckets), `mocks/backtest-snapshot.ts` (KTB 10Y benchmark yield series + synthetic order-book depth + probability cone, for a "Historical Snapshot" panel), `mocks/home.ts` (KPI tiles: Total P&L, Daily P&L, Total DV01, Portfolio Duration; a KTB-vs-IRS curve comparison; a Top Movers list).

Design system (`DESIGN.md`): dark "Marquee-dialect" institutional terminal — JetBrains Mono display font, `#0F1419`/`#1A2028`/`#2A323D` dark backgrounds (with parallel light-mode tokens), semantic positive/negative/risk/info colors plus a 4-step heat-map ramp. Fully independent of, and unrelated to, IRS Pricer_Mock's own `web/` design system. **Not changing as part of this migration.**

### 2.2 Scope-adjusted target (per §0 decisions)

- **Asset classes in UI scope:** IRS, KTB, KTBF. **CRS removed from mock data** — deferred, not deleted; may return as its own phase later (§6.7).
- **`krd1y`/`krd3y`/`krd5y`/`krd10y` and `convexity` removed** from the `Position` type — not used anywhere going forward.
- **New Home requirement:** a Tenor × DV01 heatmap for the portfolio (IRS-only at launch, per §1.4/§3 — KTB/KTBF have no DV01 calculation anywhere yet).
- **Home redesigned:** KPI tile row, Top Movers panel, and KTB/IRS curve mini-chart are all removed. Home becomes a minimal overall-status view plus the heatmap — nothing else.
- **Simulation and Optimal Portfolio tabs stay empty placeholders** — no wiring in this migration, consistent with `WORK_ORDER.md`'s original scoping (Optimal Portfolio is separately already documented there, §4.5, as its own deferred "Phase 2": *"Run Optimization currently opens a toast: Optimization engine will be connected in Phase 2"* — that phase belongs to UIUX_test's own roadmap, unrelated to this migration).
- **Backtest tab unchanged** — scenario-shock and historical-snapshot panels stay as designed; no backend engine exists for either (see gap table).
- **`book` and `ticker` become real, persisted columns** on the backend (`trade_specification`), not just frontend display fields (§0.4).

---

## 3. Gap Analysis Table

| UI element | Currently backed by (mock) | Would need engine module | Data-shape mismatch |
|---|---|---|---|
| Portfolio grid (IRS/KTB/KTBF rows) | `mocks/portfolio.ts`, trimmed to 3 asset classes | `services/trade_service.py`, `db/trade_repository.py`, `services/portfolio_service.py` | Engine only prices vanilla KRW IRS. **KTB and KTBF have no pricing model anywhere in IRS Pricer_Mock** — deferred per §0.3, so these rows stay mocked (with a visible mock indicator) until that separate project exists. `book`/`ticker` need the new DB columns from §0.4. |
| Home — Tenor × DV01 heatmap (new) | none (new component) | `engine/risk.py` | `risk.py`'s pillars are curve-bootstrap labels (O/N, CD91D, swap tenors), not a fixed display-tenor grid — needs a small remap/bucketing layer. Output must carry the "Provisional" label per §0.2. IRS-only at launch (KTB/KTBF cells empty/greyed — no DV01 calc exists for them). |
| Home — minimal status view | `mocks/home.ts` (trimmed down; most of it removed per §2.2) | `services/historical_pnl_service.py` (IRS-only) | Cross-asset P&L aggregation (including KTB/KTBF) doesn't exist; only IRS-side P&L is computable today. |
| Simulation tab | `mocks/pricer.ts` naive formula | *(not wired this migration — stays placeholder per §2.2)* | `WORK_ORDER.md` explicitly scoped this as mock-only ("MOCK PRICING" badge); real wiring would need `services/pricing_service.py` + `services/mtm_service.py`, both fully tested and verbatim-safe, whenever this tab is later brought into scope. |
| Backtest — scenario-shock panel | `mocks/backtest.ts` (MPC/FX/historical bp shocks on KRD buckets) | *(none exists)* — closest analog is `engine/risk.py`'s bump-and-reprice, which reprices one swap off a single par-quote bump, not an arbitrary multi-tenor shock applied across a bucketed multi-asset book | Genuine engine gap, not a wiring gap — nothing in IRS Pricer_Mock computes this today. |
| Backtest — historical-snapshot panel | `mocks/backtest-snapshot.ts` (KTB 10Y yield, order-book depth, probability cone) | *(none exists)* | KTB cash-bond market data and order-book depth have zero representation anywhere in IRS Pricer_Mock (closest is `rate_history_service.py`, which serves IRS/CD tenor rates, not KTB bond yields). |
| Optimal Portfolio tab | none (pure UI chrome) | *(none exists)* | Already documented in `WORK_ORDER.md §4.5` as its own deferred "Phase 2," unrelated to this migration. Confirmed fully out of scope. |
| Sandbox trade entry (`stores/simulation-store.ts`) | client-only Zustand state, never persisted | `api/routers/trades.py` (`book_trade_by_tenor`), if sandbox trades are ever meant to become real bookable positions | Backend has no CRS/KTB/KTBF booking model; would work for IRS today once `book`/`ticker` columns land (§0.4). |

**Orphaned backend feature:** `services/spread_backtest_service.py` (a z-score mean-reversion pairs-trade backtest over historical tenor-spread data) has **no UI consumer anywhere in UIUX_test**. UIUX_test's "Backtest" tab means portfolio scenario-shock stress testing — a different concept entirely, despite the name overlap. See §6.8.

---

## 4. Proposed Target Architecture

- **Standalone FastAPI service reachable over HTTP, not vendored into the Next.js repo.** Precedent already exists and works: IRS Pricer_Mock's own `web/` frontend already consumes this exact backend purely over HTTP (thin fetch wrapper + `CORSMiddleware(allow_origins=["*"])` already enabled in `api/app.py`). There's no technical reason to vendor a Python/QuantLib process into a Next.js repo, and every existing consumption pattern in this codebase already assumes an HTTP boundary.
- **New file: `src/lib/api-client.ts`** in UIUX_test, modeled directly on `IRS Pricer_Mock/web/src/lib/api.js` — same FastAPI-`detail`-shape error handling (a Pydantic validation error returns `detail` as an array, not a string; every other error path returns a plain string), same network-error-vs-HTTP-error distinction. Wired through the already-installed-but-unused TanStack Query rather than raw `fetch` call sites.
- **TS types hand-mirrored from `irs_pricer/api/models.py`'s Pydantic models** — no codegen tool exists in either repo today (flagged as non-blocking, §6.6).
- **Verbatim-safe to port** (tested, internally consistent, no open correctness questions): `core/conventions.py`, `core/market_data.py`, `core/errors.py`, `engine/curve.py`, `engine/instruments.py`, `engine/context.py`, `engine/mtm_valuation.py`.
- **Adapted, not verbatim:** `engine/risk.py` (ship with "Provisional" labeling per §0.2, not fixed first); `db/models.py`'s `TradeSpecification` (Alembic migration to add `book: str` and `ticker: str` columns per §0.4); the API layer needs a new lightweight aggregation for the Home status view (nothing currently sums across positions the way that panel will need).
- **Explicitly out of scope for this migration:** KTB/KTBF pricing engines (separate future project, §0.3), CRS pricing (deferred, §2.2), Optimal Portfolio tab (already deferred in UIUX_test's own roadmap), Simulation tab real-pricing wiring (stays placeholder), Backtest's scenario-shock and historical-snapshot panels (would be new engine builds, not migrations), `spread_backtest_service` (orphaned, no consumer, §6.8).

---

## 5. Phased Execution Plan (for a later session)

Each phase is scoped to be independently verifiable before the next starts.

### Phase 1 — Backend as a standalone reachable service
**Scope:** stand up `irs_pricer`'s FastAPI app (`uvicorn irs_pricer.api:app`) so it's reachable from wherever UIUX_test's dev server runs. No UIUX_test code touched.
**Non-goals:** no frontend changes, no new backend features, no DB migration yet.
**Verification gate:** `pytest` in IRS Pricer_Mock still passes (baseline — nothing broken by exposing the service); a manual request (e.g. `GET /api/calendar/spot-date?valuation_date=...`) succeeds from a terminal on the machine that will run UIUX_test's dev server.

### Phase 2 — Typed API client + env wiring, no UI behavior change
**Scope:** add `src/lib/api-client.ts` (per §4) and hand-written TS types mirroring the IRS-relevant subset of `api/models.py`. Wire a `.env.local` var for the API base URL (mirrors `web/src/lib/api.js`'s `VITE_API_BASE_URL` pattern).
**Non-goals:** do not touch any existing page, component, or mock import yet.
**Verification gate:** `pnpm typecheck` passes; a throwaway script (deleted after) successfully calls one GET endpoint through the new client and gets a correctly-typed response back.

### Phase 3 — DB schema + first real vertical slice: IRS positions in Portfolio Management
**Scope:**
  (a) Alembic migration adding nullable `book: str` and `ticker: str` columns to `trade_specification` (per §0.4).
  (b) Wire the Portfolio Management grid's **IRS rows only** to real `GET /api/trades` + `POST /api/portfolio/price`; KTB/KTBF rows stay on mock data with a visible "mock" indicator (reusing the app's existing badge pattern).
**Non-goals:** no risk/DV01 columns yet (that's Phase 4); no KTB/KTBF pricing (deferred per §0.3).
**Verification gate:** booking an IRS trade through the UI creates a real row in `trade_specification` with `book`/`ticker` populated (checked via `GET /api/trades`); the grid's NPV column for IRS rows matches a manual `POST /api/portfolio/price` call for the same position set.

### Phase 4 — Home Tenor × DV01 heatmap (IRS-only, Provisional-labeled)
**Scope:** build the new Home heatmap component, sourced from `engine/risk.py`'s bucketed delta output for IRS positions, remapped from curve-pillar labels to a fixed display-tenor grid. Ships with a visible "Provisional" label per §0.2.
**Non-goals:** no KTB/KTBF cells (leave visibly empty/greyed — no DV01 calc exists for them); do not attempt to fix `risk.py`'s underlying correctness issue as part of this phase — that's a separate, explicit follow-up if/when the user wants it addressed.
**Verification gate:** heatmap renders for a known IRS test book; values are cross-checked against a direct `POST /api/portfolio/delta` call for the same book (matching, not "correct" in an absolute sense — that's exactly what the Provisional label communicates).

### Phase 5 — Home minimal status view
**Scope:** the small IRS-only P&L/status panel that replaces the removed KPI tiles/Top Movers/curve-compare (per §2.2), sourced from `services/historical_pnl_service.py`.
**Non-goals:** no cross-asset (KTB/KTBF) aggregation — not computable until that separate project exists.
**Verification gate:** displayed P&L matches a manual `POST /api/portfolio/historical-pnl` call for the same IRS book and date range.

**Not part of this migration's phases** (per §0.3): KTB and KTBF pricing engines — a separate future project. Backtest tab's scenario-shock and historical-snapshot panels remain unbuilt engine-side; revisit only if/when scoped separately.

---

## 6. Open Questions

### Blocking
None remain — all four originally-blocking questions were resolved this session (§0).

### Non-blocking
1. **Repo layout:** keep `IRS Pricer_Mock` and `UIUX_test` as two separate directories with an HTTP boundary between them (current state), or consolidate into one repo (e.g. `backend/` + `frontend/`)? Neither is required by anything found during inventory — purely a workflow preference.
2. **Type-sync tooling:** continue hand-mirroring TS types from `api/models.py` (the status quo pattern, also used by IRS Pricer_Mock's own `web/` frontend, which has no codegen either), or introduce something like `openapi-typescript` against FastAPI's auto-generated OpenAPI schema?
3. **CRS re-entry:** when Credit/CRS eventually returns (per §2.2, deferred not deleted), should `AssetClass` simply widen back to include `"CRS"`, or should Credit get its own separate type/section given how different its risk profile is from rates products?
4. **`spread_backtest_service` orphan** (§3): leave it unmigrated/unsurfaced indefinitely, or is there appetite to eventually build a UI consumer for this existing, tested, but currently-unused backend feature?
5. **`risk.py`'s `dv01()` definition:** it currently returns fixed-leg-only BPS (`abs(swap.to_ql_swap(curve).fixedLegBPS())`), not a net-of-both-legs swap DV01. Confirm this is the intended figure for the Home heatmap, or whether a net definition should be derived instead — worth settling before Phase 4, though it doesn't block Phases 1-3.
6. **Canonical directory:** duplicate copies of both projects exist at `Projects_AS/...` and `Projects_AS/Rates Portfolio/...` (identical as of this writing). Pick one as canonical so future sessions don't silently diverge.

---

## 7. Summary

- **8** gap-analysis items identified (§3).
- **0** blocking open questions remain (all 4 resolved in §0); **6** non-blocking questions carried forward (§6).
- **Recommended starting phase: Phase 1** (stand up the backend as a reachable service) — it requires no further decisions, touches no UIUX_test code, and every subsequent phase depends on it.
