# features/simulation — isolated migration slice

Vertical slice for the Simulation Screen ported from `rates-simulator-main`
(`ScenarioSimulator` entry). Self-contained per Migration Protocol §1.2; the rest of
the app depends on it only through `index.ts`, and only from the Simulation tab mount
point (Phase 3).

## Layout

| Dir | Contents | Status |
|---|---|---|
| `types/` | `portfolio.ts` (Class B, copied source domain types), `simulation-port.ts` (the `SimulationDataPort` contract) | ✅ ready, type-checked |
| `api/` | `simulate-dto.ts` (request/response DTOs), `simulation-api.ts` (`simulationApi.simulate`) | ✅ ready, type-checked |
| `store/` | `simulation-data-store.ts` (Zustand slice backing the port + cross-screen selectors) | ✅ ready, type-checked |
| `hooks/` | `use-simulation.ts` (`useRunSimulation` mutation + `useSimulationPort`) | ✅ ready, type-checked |
| `components/panels/` | `scenario-config` (S4 full input UI) · `results-grid` · `curve-view` · `distribution-chart` (S5 lightweight-charts) — port-driven | ✅ live |
| `components/charts/` | `lw-line-chart.tsx` (S5 — slice-local lightweight-charts multi-line wrapper) | ✅ |
| `lib/` | `chart-theme.ts` (chart colors from CSS-var tokens), `scenario-curves.ts` (S4 request assembly + tests), `scenario-preview.ts` (S5 preview path) | ✅ type-checked + unit-tested |

**Mount host (app layer, not in slice):** `src/app/(workspace)/simulation/simulation-tab.tsx` composes the
panels into the dockview tab (persistence `simulation.layout.v1`, `next/dynamic ssr:false` charts, min
constraints, registration). The route `page.tsx` flag-switches migrated vs. retained placeholder
(`NEXT_PUBLIC_SIMULATION_V2`, default = migrated).

## State decoupling (non-streaming)

The screen consumes only `SimulationDataPort` (via `useSimulationPort()`), never the
legacy source store or a raw fetch. Client scenario state → Zustand (`store/`); server
state → TanStack Query mutation on `POST /api/simulate` (`hooks/`), keys `['simulation', …]`.
No streaming/websocket — a single request/response (Phase 0 runtime audit).

## Boundary rule (eslint.config.mjs)

- The app may not import `@/features/simulation/**` except through the Simulation route.
- The slice may import from the app only `@/components/ui/*` and `@/lib/*` (+ external pkgs
  like `@tanstack/react-query`). No `@/features/*`, `@/stores/*`, `@/hooks/*`, `@/app/*`.
- Intra-slice imports are relative (`./`, `../`).

## Deferred (NOT done in Phase 1 — by design)

- **Phase 2 (this phase — mapping only):** ✅ token audit sheet at `rates-simulator-main/docs/migration/token-map.md`;
  ✅ `lib/chart-theme.ts`; ✅ Tailwind config exposes `border-dim`/`sem-info-ghost`/`chart-*`; ✅ ESLint
  block C bans hex + arbitrary color in the slice. The actual component restyle (apply the map) happens
  in **S4/S5**, and the recharts → lightweight-charts/d3 rewrite in **S5** — not yet done.
- **Phase 3:** ✅ dockview mount host + 4 panels + persistence (`simulation.layout.v1`) + `next/dynamic
  ssr:false` + min constraints + focus regions; route flag-switch with placeholder retained (§4.3).
- **Phase 4:** ✅ S2/S3 (Vitest + MSW) · ✅ S4 (full Scenario Config input UI) · ✅ S5 (recharts→
  lightweight-charts) · ✅ S6 (input bridge — real bond ledger `useBondPositionsStore` →
  `SimulationInputs` via `app/(workspace)/simulation/position-bridge.ts`; two-backend origin via
  `NEXT_PUBLIC_SIMULATION_API_BASE_URL`) · ✅ S7 (migrated screen is the sole route path; flag retired;
  legacy files orphaned-not-deleted, pending WIP commit) · ✅ S8 (dedup review — no merge; see
  `rates-simulator-main/docs/migration/s8-dedup-review.md`).
  **Still open (needs a running app + backend, which I can't drive here):** the §4.2 **visual/interaction
  validation** (Playwright, deferred) and these fidelity items — 커브형/term-structure toggle + sector
  selector (tenor-axis → d3), rich hover tooltips, and the full source result tables (BOK 분해 / IRS
  정산·대사 sticky grids); swap positions in the bridge (need backend-derived pvbp/duration).
- **Phase 4:** move request-body assembly (incl. `generateShockCurves`) into the port so
  the screen only sets params; wire `<ScenarioSimulator>` to `useSimulationPort()`.
- **S8:** dedup review of this slice's `types/portfolio.ts` vs the app's `@/types/portfolio`.
