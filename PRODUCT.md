# Product

## Register

product

## Users

Institutional fixed-income / rates desk staff at KIS (기업금융운용부 / IMA투자부), led by Park. Power users, not general consumers: they work in this tool for hours during market sessions, already fluent in rates/FI terminology (IRS, KTB, CRS, KTBF, DV01, KRD, big-figure notation) and expect the interface to keep pace with that fluency rather than explain it to them.

Primary jobs to be done:
- Monitor the current portfolio's P&L, risk (DV01, duration, KRD), and market curves in real time (Home dashboard).
- Manage and interrogate live positions — filter, group, and drill into 500+ rows without losing performance (Portfolio Management).
- Stress-test the book against rate/FX/historical scenarios (Backtest).
- Explore hypothetical trades in a sandbox before committing (Simulation).
- Eventually, optimize portfolio construction against constraints (Optimal Portfolio — model pending, UI ships first).

## Product Purpose

An internal KRW rates/FI portfolio management system spanning five workspace tabs (Home, Portfolio Management, Backtest, Simulation, Optimal Portfolio). It exists to give the desk one dockable, multi-panel workspace for monitoring risk and P&L, managing positions, running what-if and historical scenarios, and (in a later phase) optimizing allocations — replacing fragmented spreadsheet/terminal workflows with a single coherent surface. Success looks like: traders leave spreadsheets behind for daily monitoring and scenario work, and the tool holds up under real position counts (500+) and continuous intraday use without becoming another cluttered terminal.

## Brand Personality

Reference: Goldman Sachs Marquee — matched in *language*, not cloned. Sits deliberately between Bloomberg (extreme density) and Robinhood (extreme minimalism): **information density with breathing room**. Every pixel earns its place; visual noise is the enemy.

Three words: **precise, unflashy, trustworthy.** The interface should feel like professional-grade instrumentation — the kind of tool that earns trust by getting out of the way, not by decorating itself.

## Anti-references

- **Bloomberg-terminal density** — cramming to the point that hierarchy collapses; this product uses breathing room deliberately.
- **Robinhood-style consumer minimalism** — too sparse for the information load this desk actually carries.
- **Any decorative flourish**: gradients, glassmorphism, glow, shadows beyond `shadow-md`, `rounded-full` outside status dots/avatars, emoji in the UI.
- **Color as the primary hierarchy signal.** Hierarchy comes from contrast (background luminance steps, type weight), not hue.
- **Color used decoratively.** Semantic color (positive/negative/risk/info) only appears when it carries meaning — direction, state, status — never as a full-panel fill or "visual interest."
- Numbers in a proportional font, uppercase used on values, mixed-case used on category tags — these are inversions of an invariant type rule and should read as bugs, not style choices.

## Design Principles

1. **Contrast-driven hierarchy, not color-driven.** Structure comes from 2–5% luminance steps between background layers and type-weight contrast — never from color.
2. **Semantic color minimalism.** Color is a signal, not a decoration: it marks direction (Buy/Sell, Pay/Rec), state (risk/warning), or status (live/stale/offline) — as dots, badges, thin lines, or emphasized digits, never as large fills.
3. **Dual-mode design, not inverted-mode design.** Dark mode is the trading/monitoring surface; light mode is the analysis/reporting surface. They are two deliberately different palettes serving two different desk activities, not one palette inverted.
4. **Design tokens are law.** No raw hex or raw px for spacing outside the token file — new needs get a new token, not a one-off value.
5. **Every pixel earns its place.** Given the density of real trading data (500+ positions, multi-tenor curves, KRD sub-columns), the discipline is restraint: breathing room is a deliberate counterweight to the data load, not an excuse to under-inform.

## Accessibility & Inclusion

No formal WCAG compliance target (internal desk tool, not public-facing). Baseline bar:
- Never rely on color alone for direction/state/status — this is already enforced by the semantic-color-minimalism principle (icons/arrows/labels accompany every color cue: `▲`/`▼`, Buy/Sell text, uppercase status labels).
- Maintain readable contrast in both dark (trading/monitoring) and light (analysis/reporting) modes, including at dense data-grid text sizes (11–14px).
- Full keyboard navigation for power-user workflows (tab switching, sidebar collapse) — already scoped in WORK_ORDER.md §3 (`Cmd+B`, `Cmd+1..5`). Global search (`Cmd+K`) was removed from the product; no keyboard-nav gap results since it never shipped a working search.
