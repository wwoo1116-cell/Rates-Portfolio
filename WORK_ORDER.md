# Work Order — KRW FI / Rates Portfolio Management System

**Target executor:** Claude Code (terminal)
**Owner:** Park (KIS 기업금융운용부 / IMA투자부)
**MVP scope:** All 5 tabs implemented. `Simulation` and `Optimal Portfolio` ship as functional placeholder screens with correct chrome, layout, and inputs wired but no model backend. `Home`, `Portfolio Management`, `Backtest` ship as fully interactive with mock data.
**Design reference:** Goldman Sachs Marquee. Do not clone; match the *language*.

---

## 0. Operating Rules for Claude Code

Read this before you touch any file.

1. **Diagnose-first discipline.** Before creating a component, restate in one line: what problem does this component solve, and which spec section does it belong to. If unclear, stop and ask.
2. **Design tokens are law.** No raw hex, no raw px for spacing outside the token file. If you need a new token, add it to `tokens.css` and reference it.
3. **Phase gates.** Do not proceed to the next phase until the current phase passes its acceptance criteria (listed at the end of each phase). Run `pnpm typecheck && pnpm lint && pnpm build` at every gate.
4. **No decorative flourishes.** No gradients, no glass, no glow, no shadows above `md`, no `rounded-full` except for status dots and avatars, no emoji in the UI.
5. **Mock data lives in one place.** `src/mocks/`. Every table/chart consumes from mock adapters that match the shape of the future API.
6. **English identifiers, Korean domain terms preserved.** Variable names in English. UI-facing Korean domain labels (예: `국고3년`, `IRS 3M`) are allowed and expected.
7. **Ask before installing anything not in Phase 0 stack.** Any extra dep needs a one-line justification.

---

## 1. Tech Stack (fixed — do not substitute)

- **Framework:** Next.js 14+ (App Router) + TypeScript strict mode
- **Package manager:** pnpm
- **Styling:** Tailwind CSS + CSS variables for tokens
- **Primitives:** Radix UI (via shadcn/ui, but strip default shadcn styling and re-skin to Marquee tone)
- **Data grid:** TanStack Table v8 (headless) + `@tanstack/react-virtual` for virtualization
- **Charts:**
  - Micro-charts inside KPI cards → Recharts
  - Yield curve, curve shift comparison → D3.js (custom)
  - P&L time series → Lightweight Charts (TradingView OSS)
- **State:** Zustand (workspace layout, filters, sandbox trades) + TanStack Query (data fetching, refetch intervals)
- **Forms:** React Hook Form + Zod
- **Icons:** Lucide React (stroke width 1.5)
- **Fonts:** Inter (UI and all numerics, via `font-variant-numeric: tabular-nums` rather than a separate mono face). Self-hosted via `next/font`.
- **Dates:** date-fns
- **Multi-window workspace:** dockview-react (draggable / resizable / dockable panels). React-Mosaic is fallback if dockview footprint is too large.

---

## 2. Design System — Non-Negotiable

### 2.1 Philosophy

**Information Density with Breathing Room.** Between Bloomberg (extreme density) and Robinhood (extreme minimalism), the target sits in the middle. Every pixel earns its place. Visual noise is the enemy.

Three principles (enforce in code review):

1. **Contrast-driven hierarchy** — hierarchy is created by contrast, not color. Never use color as the primary hierarchy signal.
2. **Semantic color minimalism** — color only appears when it carries meaning: direction (Buy/Sell), state (Risk/Warning), status (Info). Never decorative.
3. **Dual-mode design** — dark mode is the trading/monitoring surface. Light mode is the analysis/reporting surface. They are separate palettes, not one inverted from the other.

### 2.2 Color Tokens — `tokens.css`

Both modes are declared. Switch via `[data-theme="dark"]` on `<html>`. Default to `dark`.

```css
:root[data-theme="dark"] {
  /* Backgrounds — differentiated by 2–5% luminance, no borders needed */
  --bg-primary: #0F1419;
  --bg-secondary: #1A2028;   /* cards, panels */
  --bg-tertiary: #2A323D;    /* input fields, hover */
  --bg-elevated: #1E252F;    /* modal, popover */

  /* Text */
  --fg-primary: #FFFFFF;
  --fg-secondary: #A8B0BC;
  --fg-muted: #6B7280;
  --fg-dim: #4B5563;

  /* Borders — barely visible, used only where absolutely required */
  --border-subtle: rgba(255, 255, 255, 0.06);
  --border-strong: rgba(255, 255, 255, 0.12);

  /* Semantic — used as dots, badges, thin lines, emphasized digits. Never as large fills. */
  --sem-positive: #00C176;
  --sem-negative: #FF4A5C;
  --sem-risk: #F5A623;
  --sem-info: #3B82F6;

  /* Semantic soft (badge backgrounds only) */
  --sem-positive-soft: rgba(0, 193, 118, 0.14);
  --sem-negative-soft: rgba(255, 74, 92, 0.14);
  --sem-risk-soft: rgba(245, 166, 35, 0.14);
  --sem-info-soft: rgba(59, 130, 246, 0.14);
}

:root[data-theme="light"] {
  --bg-primary: #FFFFFF;
  --bg-secondary: #F7F9FC;   /* row alternate, panel */
  --bg-tertiary: #EDF1F7;
  --bg-elevated: #FFFFFF;
  --bg-header-dark: #0A0E14; /* top branding bar */

  --fg-primary: #0A0E14;
  --fg-secondary: #4B5563;
  --fg-muted: #6B7280;
  --fg-dim: #9CA3AF;

  --border-subtle: rgba(0, 0, 0, 0.06);
  --border-strong: rgba(0, 0, 0, 0.12);

  /* Heatmap gradients — hue = direction, saturation = magnitude */
  --heat-pos-1: #DCFCE7;
  --heat-pos-2: #4ADE80;
  --heat-pos-3: #22C55E;
  --heat-pos-4: #16A34A;
  --heat-neg-1: #FEE2E2;
  --heat-neg-2: #FCA5A5;
  --heat-neg-3: #EF4444;
  --heat-neg-4: #DC2626;

  --sem-positive: #16A34A;
  --sem-negative: #DC2626;
  --sem-risk: #D97706;
  --sem-info: #2563EB;

  --sem-positive-soft: #DCFCE7;
  --sem-negative-soft: #FEE2E2;
  --sem-risk-soft: #FEF3C7;
  --sem-info-soft: #DBEAFE;
}
```

**Enforcement rules:**
- Backgrounds separate regions via 2–5% luminance steps. **Do not draw borders to separate cards.** Borders are only allowed for: (a) explicit dividers within a component, (b) input field focus states, (c) table cell separation in dense grids.
- Semantic colors are used as **points, not fills**. Badge, pill, dot, digit, thin line — yes. Full-panel background — no. Only exception: the primary CTA button (single blue submit).
- **Avoid:**
  - Strong shadows (max `shadow-md` on popover/modal only)
  - `rounded-full` except for status dots and avatars (use 4–6px radius by default)
  - Bright accent colors covering large area

### 2.3 Typography

**Fonts:**
- UI and all numerics: Inter, with `font-variant-numeric: tabular-nums` set globally on `body` and any element rendering numbers. Emphasis within a number (price displays, KPI hero numbers) comes from font-weight and color only, never a separate mono face.

**Scale (Tailwind config extension):**

| Token | Size / Weight / Tracking | Use |
|---|---|---|
| `text-display` | 32–40px / 700 / -0.02em / tabular | Hero prices, KPI headline number |
| `text-h1` | 20px / 600 / -0.01em | Page title |
| `text-h2` | 16px / 600 | Section title |
| `text-body` | 13–14px / 400 | Default body |
| `text-body-strong` | 13–14px / 500 | Table cell emphasis |
| `text-label` | 11px / 500 / uppercase / +0.06em tracking | Category tags (RISK, ALGO, IRS, KTB) |
| `text-micro` | 10–11px / 400 / muted color | Percentage markers, timestamps, footnotes |

**Rules:**
- Category tags are **always uppercase, always wide tracking**: `RISK`, `IRS`, `CRS`, `KTB`, `MPC`, `BOOK`, `SHOCK`.
- Values (numbers, dates, names) are **always mixed case**.
- Never mix. This rule is invariant.

### 2.4 "Big Figure Notation" for Rates and Prices

**Convention: 3-digit big figure** (confirmed — KRW rate markets trade tighter spreads than FX, 2-digit loses precision that matters at a glance).

For rates, split the digit string into three visual weights:

```
3.4|567|%     →  3.4 (dim) · 567 (bright/large) · % (dim)
```

Base = 1 digit before + 1 digit after the decimal. Big figure = next 3 digits. Round beyond that (don't truncate silently — a tooltip may later show full unrounded precision).

This applies uniformly across IRS, KTB, and CRS rate displays — no per-asset-class exception.

Implement a `<PriceDisplay value bigFigureDigits={3} />` component that:
- Parses the numeric string
- Renders `[base][big][fractional]` in three spans with three type scales
- Right-aligns inside a fixed-width container so consecutive rows align on the big figure

Use this everywhere a rate or price is the primary datum: KPI hero, top-mover table `Rate` column, backtest pre/post rate cells, sandbox rate input's live display.

### 2.5 Spacing — 8px scale

Tailwind default scale is already 4px-based. Enforce that layout gaps use only these tokens:

- `space-1` (4px) — icon padding
- `space-2` (8px) — label ↔ input, chip inner padding
- `space-3` (12px) — table row padding, form row gap
- `space-4` (16px) — card inner padding
- `space-6` (24px) — section gap
- `space-8` (32px) — panel gap

No `space-5`, `space-7`, `space-9`. No arbitrary values. If something feels wrong, it means hierarchy is wrong, not spacing.

### 2.6 Radius, Shadow, Border

- Radius: `rounded` = 4px, `rounded-md` = 6px. That's it. No `rounded-lg`, no `rounded-full` outside dot/avatar.
- Shadow: only on `popover`, `modal`, `dropdown menu`, `dragged panel`. Use `shadow-sm` (dark) or `shadow-md` (light).
- Border: never for card separation. Only for input focus, table cell separation, and dividers.

---

## 3. Layout & Chrome

### 3.1 Sidebar (collapsible)

- **Width:** 240px expanded, 56px collapsed
- **Position:** fixed left, full height
- **Content order:**
  1. Brand mark (top-left, always visible). Simple triangle or `///.` style mark, monochrome
  2. Nav items: Home, Portfolio Management, Backtest, Simulation, Optimal Portfolio
  3. Bottom: theme toggle, user avatar
- **Nav item anatomy:**
  - Icon (Lucide, stroke 1.5, 18px) + label (13px, weight 500)
  - Active state: 2px vertical accent bar on the left edge in `--sem-info`, background `--bg-secondary`
  - Hover: background `--bg-secondary` only, no color shift
  - Collapsed state: icon only, tooltip on hover
- **Collapse toggle:** small chevron at the bottom-right corner of the sidebar, or bound to `Cmd/Ctrl + B`
- **Persistence:** collapsed state saved to `localStorage` via Zustand persist middleware

### 3.2 Top Bar

- **Height:** 40px
- **Position:** fixed top, right of sidebar
- **Content, left → right:**
  1. Workspace selector (dropdown, "Workspace 1 / 2 / 3 / +")
  2. Market data connection status (dot + label): `● LIVE` (green), `● STALE` (amber), `● OFFLINE` (red). Uppercase label.
  3. Server timestamp, HH:MM:SS KST, tabular-nums, updated every second
  4. Spacer (flex grow)
  5. Notification bell
  6. User menu
- No decorative separator lines between items. Use gap only.

### 3.3 Multi-Window Workspace

Every tab renders inside a **dockview** container. The main content of each tab is a set of dockable panels, not a single fixed grid.

- Users can drag panel headers to split, tab-group, or float
- Panel header height: 32px, dark background even in light mode (Marquee signature)
- Panel header contains: brand mark (small) + title + right-aligned action icons (settings, close, maximize)
- Layout saved per workspace to `localStorage`. Reset button in the workspace selector.

Panels used per tab are defined in Section 4.

---

## 4. Tab Specifications

### 4.1 Home (Dashboard) — fully interactive

**Panels (default layout):**

1. **KPI Row** (top full width, height ~140px)
   - Four cards: `Total P&L`, `Daily P&L`, `Total DV01`, `Portfolio Duration`
   - Card anatomy:
     - Label (uppercase, `text-label`) top-left
     - Hero number (`text-display`, JetBrains Mono, tabular) center-left
     - Delta indicator top-right: `▲ +2.34%` in `--sem-positive` or `▼ -1.20%` in `--sem-negative`
     - Micro-chart bottom (sparkline, 60x28px, Recharts `LineChart` without axes/tooltips). Line color = matching semantic if delta is directional, else neutral gray.
   - No card borders. Backgrounds are `--bg-secondary` in dark, `--bg-secondary` in light. Cards sit next to each other with `space-4` gap.

2. **Market Snapshot** (left, ~60% width)
   - Two curve charts stacked or side-by-side depending on panel size:
     - `KTB Curve` (국고채 커브, 지표물 only): tenors **3Y / 5Y / 10Y / 20Y / 30Y** on x-axis (`KTB_TENORS` constant — do not use the fuller IRS tenor set here). Yield on y-axis. Draw today's curve as a solid line. Overlay yesterday's curve as a dashed line in `--fg-dim`. Highlight shift as thin bars beneath x-axis.
     - `IRS Curve`: uses the fuller `IRS_TENORS` set (3M/6M/1Y/2Y/3Y/5Y/7Y/10Y/20Y/30Y).
   - `KTBCurve` and `IRSCurve` are separate D3 components with separate tenor-axis domains — see §10 for why these must not be conflated.
   - Implement as D3 line chart with custom tenor-based x-axis (categorical-but-ordered). No default D3 axes — style them into Marquee's minimal look.

3. **Top Movers** (right, ~40% width)
   - Compact table (TanStack Table, no virtualization needed at this size)
   - Columns: `Ticker`, `Asset Class` (badge), `Daily P&L`, `DV01 Δ`, mini sparkline
   - Sort by absolute daily P&L descending by default
   - Row height: 32px, `space-3` horizontal padding
   - Numbers right-aligned, tabular
   - Badge for Asset Class uses `text-label` inside a soft-color pill: KTB → info-soft, IRS → risk-soft, CRS → positive-soft, KTBF → negative-soft. Colors here identify *category*, not direction — this is a controlled exception.

**Data:** all mocked in `src/mocks/home.ts`. Include realistic KRW magnitudes (P&L in 억, DV01 in KRW/bp).

**Acceptance:**
- KPI hero numbers use `PriceDisplay` component with big-figure treatment where applicable
- Curve chart rerenders on window resize without jank
- Top Movers table sortable by clicking any header
- All panels dockable — user can drag "Top Movers" to sit below KPI row, etc.

---

### 4.2 Portfolio Management — fully interactive

**Panels (default layout):**

1. **Filter Bar** (top, full width, height 48px)
   - Three-part filter chips: `[LABEL] [value] [×]`
     - Label part: uppercase, `text-label`, background `--bg-tertiary` (slightly darker than chip body)
     - Value part: mixed case, `text-body`
     - Close button: 12px `X` icon
   - Chip examples: `[BOOK] CMA RP ×`, `[ASSET] IRS ×`, `[TENOR] 3Y-10Y ×`
   - "+3" style overflow: when more than 1 value is selected under one label, show first + count. Full list on hover.
   - `+ Add Filter` button on the right opens dropdown of filterable columns
   - `Group By` dropdown next to it (options: None, Asset Class, Book, Tenor Bucket, Direction). Book grouping resolves to exactly three groups: `CMA RP`, `NAVER CMA`, `RP Trading` (see §10 for book-to-asset-class bias in mock data).

2. **Positions Grid** (main, full width below filter bar)
   - TanStack Table, virtualized
   - Row height: 32px (dense) with a toggle to 40px (comfortable). Default dense.
   - Columns (in order):
     1. `Asset Class` — badge (IRS, KTB, CRS, KTBF)
     2. `Position ID` — monospace
     3. `Ticker / Instrument` — mixed
     4. `Direction` — badge. Pay/Rec for IRS/CRS, Buy/Sell for Bond/Futures. Pay/Buy → positive-soft, Rec/Sell → negative-soft. On row hover, badge goes solid.
     5. `Tenor`
     6. `Effective Date`
     7. `Maturity Date`
     8. `Notional (KRW 억)` — right-aligned, tabular
     9. `Fixed / Strike Rate` — uses `PriceDisplay` for big-figure notation
     10. `DV01 (KRW/bp)` — right-aligned, tabular, sign-colored
     11. `KRD (1Y, 3Y, 5Y, 10Y)` — sub-columns under a `Key Rate Duration` group header. Each sub-cell is a small heatmap pill (color pill inside cell, not full-cell fill; opacity encodes magnitude 0.4–1.0).
     12. `Convexity` — right-aligned
   - Alternating row background: even rows use `--bg-primary`, odd use `--bg-secondary`. In light mode: `#FFFFFF` and `#F7F9FC`.
   - Column headers: uppercase, `text-label`, sticky on vertical scroll.
   - Grouping: when active, group rows are collapsible headers spanning the full row width, showing aggregate DV01, Notional, count.
   - Column resize: enabled. Column reorder: enabled (drag header). Persist to localStorage.
   - Row selection: checkbox in first column. Selected row background: `--sem-info-soft`.

3. **Details Panel** (dockable side panel, opens on row click)
   - Empty by default with a "Select a position to view details" placeholder
   - When active: shows full position record, cashflow schedule (table), and small MTM chart. Placeholder OK for cashflow and chart if data model isn't finalized.

**Acceptance:**
- Grid renders 500+ mock positions at 60fps scroll (virtualization verified)
- Filter chip additions/removals reflect immediately in grid
- Group-by rearranges rows correctly and shows aggregates
- Column state (order, width) survives page reload

---

### 4.3 Backtest — fully interactive

**Panels (default layout):**

1. **Scenario Selection** (left, ~280px)
   - Scenario groups as collapsible sections:
     - **MPC Shock**: presets like `+25bp Hike`, `-25bp Cut`, `+50bp Surprise Hike`, `Curve Flattener (2s10s -20bp)`, `Curve Steepener (2s10s +20bp)`. Each is a clickable card.
     - **FX / Basis Shock**: `USDKRW +30원`, `USDKRW +50원`, `CRS Basis Widening -20bp`, `CRS Basis Narrowing +15bp`.
     - **Historical Replay**: `COVID-19 (Mar 2020)`, `Legoland Credit Crunch (Oct 2022)`, `US SVB Contagion (Mar 2023)`. Each shows date range and headline market moves on hover.
   - Selected scenario card: left border 2px `--sem-info`, background `--bg-secondary`.
   - Bottom of panel: `Run Backtest` primary button (single blue). Disabled until a scenario is selected.

2. **Results — Pre vs Post** (right top, main area)
   - Split view. Two vertical columns: `PRE-SHOCK` | `POST-SHOCK`, each with uppercase label header.
   - Under each: KPI mini-cards for Total P&L, Total DV01, Portfolio Duration, VaR (mock).
   - Between them: an arrow with the delta magnitude.
   - Below split: full-width diff table — row per metric, three columns (Pre, Post, Δ). Sign-colored Δ.

3. **P&L Impact Bar Chart** (right bottom)
   - Horizontal bar chart, one bar per asset class (IRS, KTB, CRS, KTBF, Bond)
   - Bars extend right for positive, left for negative from a center zero line
   - Colored by sign, `--sem-positive` / `--sem-negative`
   - Uses Recharts

**Acceptance:**
- All three scenario groups render with at least 3 preset cards each
- `Run Backtest` triggers a mock computation (100–300ms artificial delay via `setTimeout`) and populates results
- Delta signs colored correctly, tabular numerics aligned

---

### 4.4 Simulation (Sandbox) — placeholder, but wired

**Panels (default layout):**

1. **What-If Trade Entry** (left, ~360px)
   - Form (React Hook Form + Zod):
     - Asset Class: select (IRS, KTB, CRS, KTBF)
     - Direction: segmented control (Pay/Rec or Buy/Sell — options change with Asset Class)
     - Notional: number input, `KRW 억` suffix
     - Tenor: select (3M, 6M, 1Y, 2Y, 3Y, 5Y, 7Y, 10Y, 20Y, 30Y) with `+` custom option
     - Rate: number input with big-figure live preview below
   - `Add to Sandbox` secondary button. Sandbox trades accumulate in an inline list below the form.
   - Each sandbox trade row: `[×] IRS Pay 3Y KRW 500억 @ 3.245%`. Remove button on left. Muted style.

2. **Live Impact Grid** (right, main area)
   - Two-column table:
     - Left: `Current Portfolio` metrics (DV01 by tenor bucket 1Y/3Y/5Y/10Y/20Y+, total DV01, total notional)
     - Right: `Post-Sandbox` metrics with delta indicator per row
   - Below: a small curve-risk-profile chart showing DV01 by tenor as a horizontal bar chart, current (solid) vs. post-sandbox (outlined overlay).

**Placeholder state:** metrics update instantly when trades are added/removed — computation is naive summation of hardcoded coefficients per (Asset Class, Tenor) pair. Do not model actual QuantLib pricing. Add a subtle badge `MOCK PRICING` in the top-right of the impact panel.

**Acceptance:**
- Form validates: notional > 0, rate within reasonable bounds, tenor selected
- Adding/removing sandbox trades updates the impact grid live
- `MOCK PRICING` badge visible

---

### 4.5 Optimal Portfolio — placeholder, but wired

**Panels (default layout):**

1. **Constraints Form** (left, ~360px)
   - Grouped form:
     - **Objective**: radio (Maximize Carry / Minimize DV01 / Max Sharpe — with a `MODEL PENDING` note)
     - **Notional Constraints**: Max Notional per Asset Class (four inputs), Max Total Notional
     - **Duration Constraints**: Min Duration, Max Duration
     - **Risk Budget**: Max DV01, Max VaR (mock)
     - **Universe**: multi-select of instruments to consider (default: all)
   - `Run Optimization` primary button. Disabled with tooltip `Model not yet connected` in the placeholder state.

2. **Results Dashboard** (right, main area)
   - Empty state: centered muted text `Configure constraints and run to see optimal allocations`
   - Non-empty state (for future): weight allocation table, efficient frontier chart, constraint slack indicators. Build the containers, leave content as empty state components.

**Acceptance:**
- Form structure complete and validates
- `Run Optimization` currently opens a toast: `Optimization engine will be connected in Phase 2`
- Result panels render their empty states correctly

---

## 5. Component Library — Reusable Building Blocks

Build these first, in `src/components/ui/` and `src/components/data/`.

### 5.1 Primitives (`ui/`)

- `Button` — variants: `primary` (single blue submit style), `secondary` (transparent bg, border-subtle), `ghost` (transparent, no border), `icon` (square). Sizes: `sm` (28px), `md` (32px), `lg` (36px).
- `Input` — filled background `--bg-tertiary`, no visible border by default, focus state = 1px `--sem-info` border. Right-aligned label pattern where appropriate.
- `Select` — Radix Select re-skinned. Dark popover in dark mode.
- `SegmentedControl` — for Buy/Sell, Pay/Rec toggles.
- `Chip` — three-part `[LABEL][value][×]` with close button optional. Overflow shorthand `+N` supported.
- `Badge` — soft-background variant and solid variant. Semantic colors and category colors both supported.
- `Tooltip` — Radix, dark background, `text-micro`.
- `Toast` — top-right, dark, dismissible.

### 5.2 Data Components (`data/`)

- `PriceDisplay` — big-figure notation. Props: `value: string | number`, `precision`, `bigFigureDigits` (default 2). Renders three spans.
- `DeltaIndicator` — `▲` / `▼` + value + optional percentage. Auto-colors. Tabular.
- `Sparkline` — 60x28 default. Props: `data: number[]`, `variant: 'positive' | 'negative' | 'neutral' | 'auto'`.
- `HeatmapPill` — small colored pill for use inside table cells. Props: `value`, `min`, `max`, `direction: 'positive' | 'negative' | 'bidirectional'`. Opacity encodes magnitude, hue encodes direction.
- `DataGrid` — wrapper around TanStack Table with virtualization, column resize, reorder, sticky headers, alt-row backgrounds, sort indicators. Configured for the Marquee tone.
- `StatusDot` — 8px circle with pulse animation when `variant='live'`.
- `WorkspacePanel` — wrapper for dockview panel content. Handles the dark title bar, brand mark, title, and right-aligned actions.

---

## 6. Directory Structure

```
/
├── src/
│   ├── app/
│   │   ├── (workspace)/
│   │   │   ├── layout.tsx           # sidebar + top bar + dockview shell
│   │   │   ├── page.tsx             # → redirect to /home
│   │   │   ├── home/page.tsx
│   │   │   ├── portfolio/page.tsx
│   │   │   ├── backtest/page.tsx
│   │   │   ├── simulation/page.tsx
│   │   │   └── optimal/page.tsx
│   │   ├── globals.css
│   │   └── tokens.css
│   ├── components/
│   │   ├── ui/                       # primitives (Section 5.1)
│   │   ├── data/                     # data components (Section 5.2)
│   │   ├── layout/                   # Sidebar, TopBar, WorkspaceShell
│   │   └── charts/                   # KTBCurve, IRSCurve, PnLBarChart, etc.
│   ├── features/
│   │   ├── home/
│   │   ├── portfolio/
│   │   ├── backtest/
│   │   ├── simulation/
│   │   └── optimal/
│   ├── mocks/                        # seed data
│   ├── stores/                       # Zustand stores
│   ├── lib/                          # utils, formatters (formatKRW, formatBps, etc.)
│   └── types/                        # shared TS types
├── public/fonts/                     # Inter
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## 7. Execution Phases

Do these in order. Do not skip. At each phase gate, run typecheck + lint + build.

### Phase 0 — Bootstrap
- `pnpm create next-app` with TS + Tailwind + App Router + ESLint
- Install fixed stack from Section 1 (only these; ask before adding others)
- Configure `next/font` for Inter
- Set up `tokens.css` from Section 2.2
- Extend `tailwind.config.ts` with type scale (Section 2.3), spacing rules, radius rules
- Add theme toggle stub (Zustand + `data-theme` on `<html>`)
- **Gate:** blank page loads with correct fonts, theme switches, tokens available as CSS vars

### Phase 1 — Layout Shell
- Sidebar (Section 3.1) with all 5 nav items, collapse toggle, active state
- Top Bar (Section 3.2) with workspace selector (mock 3 workspaces), status dot, timestamp
- Dockview integration in workspace layout
- **Gate:** navigation between tabs works, sidebar collapses and persists, dockview renders empty panels

### Phase 2 — Component Library
- Build every primitive in Section 5.1
- Build `PriceDisplay`, `DeltaIndicator`, `Sparkline`, `HeatmapPill`, `StatusDot`, `WorkspacePanel` from Section 5.2
- Build a `/dev/components` route (dev-only) that renders every component in every state for visual review
- **Gate:** every component matches the tone described in Section 2. No decorative flourishes.

### Phase 3 — Portfolio Management Tab
- This is the highest-value surface, do it first among tabs
- Build `DataGrid` component (Section 5.2)
- Mock 500+ positions in `src/mocks/portfolio.ts`
- Wire filter chips, group-by, column resize/reorder, virtualization
- **Gate:** meets acceptance in Section 4.2

### Phase 4 — Home Tab
- KPI cards with micro-charts
- KTB and IRS/CRS curve charts (D3)
- Top Movers grid (reuse `DataGrid` in compact mode)
- **Gate:** meets acceptance in Section 4.1

### Phase 5 — Backtest Tab
- Scenario selection UI, presets from Section 4.3
- Pre/Post split view with mock computation
- P&L impact bar chart (Recharts)
- **Gate:** meets acceptance in Section 4.3

### Phase 6 — Simulation Tab (placeholder-but-wired)
- What-If form with validation
- Naive impact computation
- MOCK PRICING badge
- **Gate:** meets acceptance in Section 4.4

### Phase 7 — Optimal Portfolio Tab (placeholder-but-wired)
- Constraints form
- Empty-state result panels
- Disabled `Run Optimization` with tooltip
- **Gate:** meets acceptance in Section 4.5

### Phase 8 — Polish
- Cmd+K global search stub
- Keyboard shortcuts: `Cmd+B` sidebar, `Cmd+1..5` tab switch
- Empty states everywhere (no bare white areas)
- Loading skeletons for data grids and charts
- Toast system wired
- **Gate:** full walk-through with no visual dead ends

---

## 8. Definition of Done (MVP)

- All 5 tabs navigable and render without console errors
- Dark mode default. Light mode fully working via toggle.
- All acceptance criteria in Section 4 met
- No raw hex or raw px outside `tokens.css` and Tailwind config
- No custom shadows, gradients, or `rounded-full` outside allowed cases
- Typecheck, lint, and build all pass
- README documents: run commands, phase status, known gaps (Simulation/Optimal pricing model)

---

## 9. Anti-Patterns — Reject in Review

If any of these appear, revert and redo:

- A card that looks "designed" (gradient, shadow, thick border, rounded-lg)
- A button with a decorative icon that doesn't communicate an action
- A colored panel background used for "visual interest"
- Numbers in a proportional font (must be tabular)
- Uppercase labels used on values, or mixed-case used on category tags
- A component that hardcodes a hex color
- A layout that uses arbitrary spacing values instead of the 8px scale
- A chart with default library styling (Recharts default tooltip, D3 default axis)

---

## 10. Open Questions — RESOLVED

Items (1), (2), (4) were blocking. Answers below. Items (3) and (5) remain open but are not blockers — resolve before Phase 5 (3) and Phase 1 polish (5) respectively.

### (1) Book / Desk Taxonomy — CONFIRMED

Three books, not the generic Trading/Banking/IMA placeholder. Use exactly:

| Book | Primary Asset Focus |
|---|---|
| `CMA RP` | IG Credit Trading (bonds) |
| `NAVER CMA` | KTBF |
| `RP Trading` | KTBF + IRS |

Implications for implementation:
- `Group By: Book` in Portfolio Management (§4.2) groups into these three, not a generic placeholder set.
- Mock data (`src/mocks/portfolio.ts`) must bias position generation so each book's holdings match its stated focus — e.g. `CMA RP` mock rows should be mostly `Bond` asset class, `NAVER CMA` mostly `KTBF`, `RP Trading` a mix of `KTBF` and `IRS`. Don't generate a uniform random distribution across books; it should look realistic when grouped.
- Book filter chip example in §4.2 should read `[BOOK] CMA RP ×` etc., not `[BOOK] Trading ×`.

### (2) KTB Tenor Set — CONFIRMED (two distinct sets, do not conflate)

Two separate tenor axes exist in this system and must stay separate:

- **KTB cash curve (지표물, on-the-run benchmarks):** `3Y / 5Y / 10Y / 20Y / 30Y` only. Use this set for the `KTB Curve` chart in §4.1 Market Snapshot, and for any KTB-specific instrument selector.
- **IRS/CRS curve and general tenor selectors (Simulation, Backtest, filters):** keep the fuller set `3M / 6M / 1Y / 2Y / 3Y / 5Y / 7Y / 10Y / 20Y / 30Y` as already specified in §4.4 Tenor select and Portfolio filter chips — IRS trades on-the-run at shorter/finer tenors than KTB cash issuance.

Implementation note: the `KTBCurve` D3 chart component takes a distinct, shorter x-axis domain than the `IRSCurve` component. Do not reuse one tenor-axis config for both — build `KTB_TENORS` and `IRS_TENORS` as separate constants in `src/lib/constants.ts`.

### (4) Big Figure Digit Convention — CONFIRMED: 3-digit

Reasoning: KRW rate markets trade tighter spreads than FX, so 2-digit big figure loses precision that matters at a glance.

Format: `3.4|567|%` — base is 1 digit before + 1 digit after the decimal, big figure is the next 3 digits, and any further precision is dropped (round, don't truncate silently — tooltip on hover can show full unrounded value if needed later).

Update to `PriceDisplay` component spec (§5.2 and §2.4):
- Default prop `bigFigureDigits = 3` (was 2 in the draft).
- Parsing logic: given `3.4567%`, split as `base = "3.4"`, `big = "567"`, `unit = "%"`.
- This 3-digit convention applies uniformly across IRS/KTB/CRS rate displays. No per-asset-class exception — reject any earlier suggestion of IRS-vs-KTBF split; keep it uniform for consistency across the grid.

### (3) Historical Replay Date Ranges — still open, not a Phase 0–4 blocker
Confirm exact windows for COVID, Legoland, SVB before starting Phase 5 (Backtest).

### (5) Multi-window persistence scope — still open, not a Phase 0–2 blocker
Per user, per workspace, or both — confirm before Phase 8 polish.

**Phase 1 is now unblocked.** Proceed past Phase 0 into Phase 1 using the confirmed values above.
