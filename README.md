# KRW FI / Rates Portfolio Management System

See `WORK_ORDER.md` for full spec, design system, and phase plan.

## Run

```bash
pnpm install
pnpm dev         # http://localhost:3000
pnpm typecheck && pnpm lint && pnpm build
```

## Stack notes (deviations from create-next-app defaults)

- **Tailwind pinned to v3.4**, not the v4 that `create-next-app` installs by
  default. The work order's directory structure and Phase 0 steps assume a
  `tailwind.config.ts` with `theme.extend` — v4's CSS-first `@theme` config
  would drop that file. `postcss.config.mjs` uses the classic
  `tailwindcss`/`autoprefixer` plugin pair accordingly.
- **Next.js 16** (satisfies the work order's "14+" pin) with React 19.

## Phase status

- **Phase 0 — Bootstrap:** done. `tokens.css` (dark/light), extended
  `tailwind.config.ts` (type scale, spacing, radius, color tokens mapped to
  CSS vars), Inter + JetBrains Mono via `next/font`, Zustand theme store with
  `data-theme` sync (no-flash init script + persisted toggle).
- **Phase 1 — Layout Shell:** done. Sidebar (5 nav items, collapse +
  `Cmd/Ctrl+B`, persisted), Top Bar (workspace selector, status dot, live KST
  clock, search/bell/user stubs), dockview shell per tab rendering one empty
  panel. Verified via Playwright: navigation, theme toggle, sidebar
  collapse + reload persistence, no console errors.
- **Phase 2 — Component Library:** done. All `ui/` primitives (Button,
  Input, Select, SegmentedControl, Chip, Badge, Tooltip, Toast) and `data/`
  components (PriceDisplay, DeltaIndicator, Sparkline, HeatmapPill,
  StatusDot, WorkspacePanel) built. Radix used for Select/Tooltip/Toast/
  SegmentedControl per the primitive stack. `/dev/components` gallery route
  renders every component/state for visual review — 404s in production
  builds, reachable only in dev (verified via `pnpm build && pnpm start`).
  Verified via Playwright in both themes: no console errors.
- **Phase 3 — Portfolio Management Tab:** done. Fully virtualized TanStack Table grid rendering 500+ positions. Implemented custom filter chips, Group By aggregates (None, Asset Class, Book, Tenor Bucket, Direction), column resize, reordering, row checkboxes, and localStorage layout persistence.
- **Phase 4 — Home Tab:** done. Implemented high-density KPI cards with Recharts micro-charts, custom D3-based KTB and IRS yield curves rendering benchmark shifts, and a compact Top Movers grid sorted by absolute daily P&L.
- **Phase 5 — Backtest Tab:** done. Interactive scenario selector cards (MPC, FX, Historical Replays), Pre vs Post-Shock metrics comparison grid, and a sign-colored horizontal P&L Recharts bar chart.
- **Phase 6 — Simulation Tab:** done. What-If trade entry form validation (Zod/Hook Form), sandbox trades list, Live Impact comparison matrix (Current vs Post-Sandbox metrics), and a custom Recharts horizontal tenor bucket risk profile overlay chart.
- **Phase 7 — Optimal Portfolio Tab:** done. Grouped constraints form validation (carry/dv01/sharpe objectives, limits, universe checkboxes), Run Optimization toast, and a 3-panel dashboard layout for results (Weights, Frontier, Slack placeholders).
- **Phase 8 — Polish:** done. Global command palette stub (triggered via `Cmd+K` or search buttons), global shortcuts (`Cmd+B` sidebar toggle, `Cmd+1..5` fast tab switches), custom pulse skeleton loading states, and full empty-state grid states. Passed strict typecheck, eslint rules, and production build checks.

## Known gaps

- Simulation and Optimal Portfolio pricing models use naive linear and placeholder calculations (ready for backend model migration).
- §10 items (3) Historical Replay date ranges and (5) multi-window persistence scope (per-user vs per-workspace) are still open; not required for MVP UI.
